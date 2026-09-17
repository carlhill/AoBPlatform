/**
 * The installer's two questions, answered by the program being installed.
 *
 *   node dist/src/install-cli.js check <version> <dataDir>
 *   node dist/src/install-cli.js write <version> <dataDir> <Single|Lan> <queuesJson>
 *
 * WHY POWERSHELL ASKS NODE INSTEAD OF DECIDING FOR ITSELF. Version ordering
 * is the kind of logic that is one line to write and quietly wrong forever
 * ("0.10.0" sorts before "0.9.0" as a string), and PowerShell in this repo has
 * no test runner pointed at it. `install-marker.ts` holds the decision, a unit
 * test holds it to account, and this file is the three lines of glue that let
 * a `.ps1` gate on `$LASTEXITCODE`. Node is not a new dependency: AOBPRINTER
 * does not run at all without it.
 *
 * EXIT CODES ARE THE INTERFACE.
 *   0 — fresh, same or upgrade. The installer proceeds.
 *   1 — refuse_older. The installer STOPS and shows what is on stderr.
 *   2 — this CLI was called wrongly, or the marker could not be read or
 *       written. Also a stop: an installer that cannot establish what is
 *       already here must not proceed as if nothing were.
 *
 * STDOUT IS ONE LINE OF JSON AND NOTHING ELSE, so the caller can parse it
 * without pattern-matching prose. Everything for a human goes to stderr.
 * `process.stdout.write` rather than `console.log` — this repo's lint bans
 * `console.log`, and the two are not equivalent here anyway: the contract is
 * exactly one newline-terminated line.
 *
 * NO PII CROSSES THIS BOUNDARY. A version, a data directory, an install mode,
 * and the queue names and labels — practice-chosen attribution text like
 * "Room 3", which `config.ts` refuses outright if it is shaped like a patient
 * identifier. That is why argv is fine here, where the retention key in
 * `keystore.ts` had to go over stdin: nothing passed on this command line is
 * a secret or a patient's.
 */
import {
  INSTALL_MODES,
  decideInstallAction,
  readInstallMarker,
  writeInstallMarker,
  type InstallMode,
  type InstallQueue,
} from './install-marker';

const USAGE = [
  'Usage:',
  '  node dist/src/install-cli.js check <version> <dataDir>',
  '  node dist/src/install-cli.js write <version> <dataDir> <Single|Lan> <queuesJson>',
  '',
  'queuesJson is a single argument holding a JSON array of {"name":"...","label":"..."}.',
].join('\n');

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseQueuesArgument(raw: string): InstallQueue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(`The queues argument is not valid JSON. Expected a JSON array of {"name":"...","label":"..."}.`, 2);
  }
  if (!Array.isArray(parsed)) fail('The queues argument must be a JSON ARRAY of {"name":"...","label":"..."}.', 2);

  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) fail(`Queue ${index + 1} in the queues argument is not an object.`, 2);
    const doc = entry as Record<string, unknown>;
    if (typeof doc.name !== 'string' || doc.name.trim().length === 0) {
      fail(`Queue ${index + 1} in the queues argument has no "name".`, 2);
    }
    const name = doc.name.trim();
    const label = typeof doc.label === 'string' && doc.label.trim().length > 0 ? doc.label.trim() : name;
    return { name, label };
  });
}

function runCheck(version: string, dataDir: string): never {
  let action: ReturnType<typeof decideInstallAction>;
  let installedVersion: string | null = null;
  try {
    const installed = readInstallMarker(dataDir);
    installedVersion = installed?.version ?? null;
    action = decideInstallAction(installed, version);
  } catch (err) {
    // An unreadable ordering (a version segment that is not a number, either
    // side) is a stop, not a shrug: proceeding would be installing without
    // knowing whether it is an upgrade.
    fail(`AOBPRINTER cannot compare versions: ${err instanceof Error ? err.message : String(err)}`, 2);
  }

  process.stdout.write(`${JSON.stringify({ action, installedVersion })}\n`);

  if (action === 'refuse_older') {
    fail(
      `AOBPRINTER ${installedVersion} is already installed on this desktop and ${version} is OLDER. ` +
        'Installing it would leave an older program reading an outbox a newer one wrote, which it may only ' +
        `half-understand. Uninstall ${installedVersion} first (Install-AobPrinter.ps1 -Uninstall), or install ` +
        `${installedVersion} or newer.`,
      1,
    );
  }
  process.exit(0);
}

function runWrite(version: string, dataDir: string, mode: string, queuesJson: string): never {
  if (!INSTALL_MODES.includes(mode as InstallMode)) {
    fail(`"${mode}" is not an install mode. Use one of: ${INSTALL_MODES.join(', ')}.`, 2);
  }
  const queues = parseQueuesArgument(queuesJson);

  try {
    writeInstallMarker(dataDir, {
      version,
      installedAt: new Date().toISOString(),
      installMode: mode as InstallMode,
      queues,
    });
  } catch (err) {
    fail(`AOBPRINTER could not write its install marker in ${dataDir}: ${err instanceof Error ? err.message : String(err)}`, 2);
  }

  process.stdout.write(`${JSON.stringify({ written: true, version, installMode: mode, queues: queues.length })}\n`);
  process.exit(0);
}

/* istanbul ignore next -- the entry point, exercised by the installer; the decision it calls is unit-tested. */
if (require.main === module) {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === 'check') {
    if (rest.length !== 2) fail(`"check" takes <version> <dataDir>.\n\n${USAGE}`, 2);
    runCheck(rest[0], rest[1]);
  } else if (subcommand === 'write') {
    if (rest.length !== 4) fail(`"write" takes <version> <dataDir> <Single|Lan> <queuesJson>.\n\n${USAGE}`, 2);
    runWrite(rest[0], rest[1], rest[2], rest[3]);
  } else {
    fail(`Unknown subcommand ${subcommand === undefined ? '(none given)' : `"${subcommand}"`}.\n\n${USAGE}`, 2);
  }
}

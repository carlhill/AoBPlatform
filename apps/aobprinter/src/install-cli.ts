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
import { readFileSync } from 'node:fs';
import { looksLikeAnIdentifier } from './log';
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
  '  node dist/src/install-cli.js validate-queues <queuesJson>',
  '',
  'queuesJson is a single argument holding a JSON array of {"name":"...","label":"..."},',
  'or @<path> to read that JSON from a file (what the installer does — see readQueuesArgument).',
].join('\n');

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * `@<path>` READS THE JSON FROM A FILE, and the caller is why.
 *
 * Windows PowerShell 5.1 re-parses a native command's arguments with its own
 * legacy rules, and JSON is nothing but embedded double quotes. Passing the
 * queue list inline is the classic way to have quotes silently eaten on one
 * desktop and survive on another — a difference that would show up as a
 * mangled queue label in a receipt weeks later, not as an error at install
 * time. The installer writes a temp file and passes its path instead.
 *
 * Inline JSON still works: it is what a human types by hand.
 */
export function readQueuesArgument(raw: string): string {
  if (!raw.startsWith('@')) return raw;
  const path = raw.slice(1);
  try {
    /*
     * The BOM is stripped because Windows PowerShell 5.1 puts one there:
     * `Set-Content -Encoding utf8` is UTF-8 WITH a byte order mark, and
     * `JSON.parse` rejects a leading U+FEFF with a bare "Unexpected token".
     * Measured against the real installer on 17 September 2026, where it
     * failed the marker write after the printers had already been created.
     */
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  } catch (err) {
    fail(`The queues file ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`, 2);
  }
}

export function parseQueuesArgument(rawOrPath: string): InstallQueue[] {
  const raw = readQueuesArgument(rawOrPath);
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

    /*
     * THE SAME REFUSAL `config.ts` MAKES, MADE HERE TOO.
     *
     * This file's header says argv is safe because a queue name or label
     * shaped like a patient identifier is refused -- and it was only refused
     * by the runtime config loader, long after the installer had created a
     * Windows printer called '2454232371' and written it into install.json and
     * the console. Defence in depth for hard rule 9: the marker and the
     * installer's own output are places an identifier must not reach either.
     */
    for (const [field, value] of [['name', name], ['label', label]] as const) {
      if (looksLikeAnIdentifier(value)) {
        fail(
          `Queue ${index + 1}: "${field}" looks like a patient identifier. A queue name or label is ` +
            "practice-chosen attribution text (e.g. 'Room 3'), never a patient identifier - it is written to " +
            'the install marker, to logs and to every receipt that queue produces.',
          2,
        );
      }
    }

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

/**
 * ASKED BEFORE ANYTHING IS CREATED, WHICH IS THE ENTIRE POINT.
 *
 * `runWrite` already refuses an identifier-shaped queue name -- but it runs at
 * the END of the installer, after the ports and printers exist. Measured here
 * on 17 September 2026: a queue named '2454232371' became a real Windows
 * printer, and only then did the install stop. The printer stayed.
 *
 * So the installer calls this first and creates nothing until it exits 0.
 */
function runValidateQueues(queuesArgument: string): never {
  const queues = parseQueuesArgument(queuesArgument); // fails with exit 2 on an identifier
  process.stdout.write(`${JSON.stringify({ valid: true, queues: queues.length })}\n`);
  process.exit(0);
}

/* istanbul ignore next -- the entry point, exercised by the installer; the decision it calls is unit-tested. */
if (require.main === module) {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === 'validate-queues') {
    if (rest.length !== 1) fail(`"validate-queues" takes <queuesJson>.\n\n${USAGE}`, 2);
    runValidateQueues(rest[0]);
  } else if (subcommand === 'check') {
    if (rest.length !== 2) fail(`"check" takes <version> <dataDir>.\n\n${USAGE}`, 2);
    runCheck(rest[0], rest[1]);
  } else if (subcommand === 'write') {
    if (rest.length !== 4) fail(`"write" takes <version> <dataDir> <Single|Lan> <queuesJson>.\n\n${USAGE}`, 2);
    runWrite(rest[0], rest[1], rest[2], rest[3]);
  } else {
    fail(`Unknown subcommand ${subcommand === undefined ? '(none given)' : `"${subcommand}"`}.\n\n${USAGE}`, 2);
  }
}

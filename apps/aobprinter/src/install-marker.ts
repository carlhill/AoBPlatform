/**
 * What is installed on this desktop, and whether the thing being installed
 * over it is allowed to be.
 *
 * THE FAILURE THIS PREVENTS. A practice has AOBPRINTER 0.3.0. A technician,
 * holding a USB stick from the last visit, runs the 0.1.0 installer. Nothing
 * in Windows objects: the printer, the port and the share are all idempotent
 * per-object operations that will happily succeed. What changes underneath is
 * the program reading the outbox — and a 0.1.0 binary reading a `pending/`
 * job that 0.3.0 wrote is the downgrade half of the same promise
 * `OUTBOX_FORMAT_VERSION` makes in `outbox.ts`. Refusing the install is the
 * cheap end of that problem; a half-read payload is the expensive end.
 *
 * WHY THE DECISION LIVES IN TYPESCRIPT AND NOT IN THE POWERSHELL. The
 * installer shells out to a Node CLI (`install-cli.ts`) that calls
 * `decideInstallAction` and gates on its exit code. Node is already a hard
 * requirement — this program does not run without it — so this is invoking a
 * runtime the product already needs, not adding a dependency. What it buys is
 * that the compare-and-refuse logic is one unit-tested function rather than
 * PowerShell string arithmetic no test ever runs, where "0.10.0 is older than
 * 0.9.0" is a bug nobody would see until it silently allowed a downgrade.
 *
 * THE MARKER IS NOT A SYSTEM OF RECORD AND HOLDS NO PII. A version, an
 * install time, a mode, and the practice-chosen queue names and labels
 * (`config.ts` refuses a queue name or label shaped like a patient
 * identifier). Deleting it makes the next install look fresh, which is
 * recoverable; it is a guard rail, not evidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** `Single` — one queue on this desktop. `Lan` — this host serves other workstations, each with its own shared queue. */
export type InstallMode = 'Single' | 'Lan';

export const INSTALL_MODES: readonly InstallMode[] = ['Single', 'Lan'];

/** One queue as the installer created it. Attribution only — which physical printer produced a form. */
export interface InstallQueue {
  readonly name: string;
  readonly label: string;
}

export interface InstallMarker {
  readonly version: string;
  readonly installedAt: string;
  readonly installMode: InstallMode;
  readonly queues: readonly InstallQueue[];
}

/**
 * `fresh` — nothing installed here before.
 * `same` — the same version again; the installer is idempotent, so this proceeds.
 * `upgrade` — newer than what is here; proceeds.
 * `refuse_older` — older than what is here; the installer stops and says so.
 */
export type InstallAction = 'fresh' | 'same' | 'upgrade' | 'refuse_older';

export function installMarkerPath(dataDir: string): string {
  return join(dataDir, 'install.json');
}

/**
 * The marker, or null when there is nothing trustworthy to read.
 *
 * NEVER THROWS FOR "NO PRIOR INSTALL", because a fresh desktop is the ordinary
 * case and an installer that crashes on it is useless. A CORRUPT marker also
 * reads as null, which is the one place this is generous rather than strict:
 * it means a damaged marker lets an older build install. That is the honest
 * trade — the alternative is an installer that cannot be run at all until
 * somebody finds and edits a JSON file — and it is why the marker is a guard
 * rail against the ordinary mistake, not a security control.
 */
export function readInstallMarker(dataDir: string): InstallMarker | null {
  const path = installMarkerPath(dataDir);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const doc = parsed as Record<string, unknown>;
  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) return null;

  const installMode = doc.installMode === 'Lan' ? 'Lan' : 'Single';
  const queues = Array.isArray(doc.queues)
    ? doc.queues
        .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
        .map((q) => ({
          name: typeof q.name === 'string' ? q.name : '',
          label: typeof q.label === 'string' ? q.label : '',
        }))
        .filter((q) => q.name.length > 0)
    : [];

  return {
    version: doc.version.trim(),
    installedAt: typeof doc.installedAt === 'string' ? doc.installedAt : 'unknown',
    installMode,
    queues,
  };
}

export function writeInstallMarker(dataDir: string, marker: InstallMarker): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(installMarkerPath(dataDir), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

/**
 * Compare two dotted numeric versions.
 *
 * NUMERICALLY, SEGMENT BY SEGMENT, with missing segments read as zero, so
 * `0.2` and `0.2.0` are equal and `0.10.0` is correctly NEWER than `0.9.0` —
 * the comparison a string sort gets wrong and the reason this is a function
 * with a test rather than a `-lt` in PowerShell.
 *
 * A NON-NUMERIC SEGMENT THROWS. A version string is content this program has
 * to be honest about: `0.3.0-rc1` compared as if the pre-release tag were not
 * there would let a release candidate pass for the release, and silently
 * miscomparing is exactly the failure the whole marker exists to prevent. If
 * this build ever needs pre-release versions, the ordering rule for them is a
 * decision to record, not one to infer here.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = segments(a);
  const right = segments(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

function segments(version: string): number[] {
  const parts = version.trim().split('.');
  return parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error(
        `"${version}" is not a dotted numeric version: the segment "${part}" is not a number. AOBPRINTER ` +
          'compares versions numerically to decide upgrade from downgrade, and will not guess at an ordering ' +
          'for a version it cannot read.',
      );
    }
    return Number(part);
  });
}

/**
 * Should this install proceed, and as what?
 *
 * `same` PROCEEDS ON PURPOSE. The installer is idempotent by design — "run it
 * again" has to stay a safe instruction over a phone call (see
 * `Install-AobPrinter.ps1`) — so re-running the same version must repair a
 * missing port or a lost share rather than refuse.
 */
export function decideInstallAction(installed: InstallMarker | null, incomingVersion: string): InstallAction {
  if (installed === null) return 'fresh';
  switch (compareVersions(incomingVersion, installed.version)) {
    case 0:
      return 'same';
    case 1:
      return 'upgrade';
    default:
      return 'refuse_older';
  }
}

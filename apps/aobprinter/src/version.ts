/**
 * Which build of AOBPRINTER this is — read from the one file that already
 * knows, and never guessed.
 *
 * WHY THIS EXISTS AT ALL. Three separate guard rails in this program are only
 * worth having if the version they quote is true: the instance lock names the
 * version of the process already holding it, the installer refuses to put an
 * older build over a newer one, and every receipt and every post carries the
 * build that produced it. A support call that starts "which version is this
 * desktop on" has to be answerable from the log, the receipt or the request
 * headers, without anyone walking to the machine.
 *
 * IT THROWS RATHER THAN RETURNING `'unknown'`. A version this program cannot
 * establish is a version it must not claim: `'unknown'` would flow straight
 * into a receipt (the only surviving trace of a form once its payload is
 * deleted), into the `x-aobprinter-version` header, and into the install
 * marker that decides whether the next install is an upgrade or a downgrade.
 * A build that cannot read its own `package.json` is broken in its packaging,
 * which is a loud failure at start, not a field to fill in with a shrug.
 *
 * TWO CANDIDATE PATHS BECAUSE THERE ARE TWO PLACES THIS RUNS FROM. Under
 * ts-jest and ts-node the module sits in `src/`, so `package.json` is one
 * directory up. Compiled, it sits in `dist/src/`, so it is two. Both are
 * tried, in that order, and the first that exists and carries a version wins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** This workspace's package name, used to reject a `package.json` that is not ours. */
const PACKAGE_NAME = '@aobplatform/aobprinter';

/*
 * Read once per process. Not an optimisation that matters (this is a few
 * hundred bytes off a local disk) but a guarantee that every caller in one run
 * — banner, receipts, headers, lock file — quotes the same string, even if
 * somebody edits `package.json` while the program is running.
 */
let cached: string | null = null;

export function readPackageVersion(): string {
  if (cached !== null) return cached;

  const candidates = [join(__dirname, '..', 'package.json'), join(__dirname, '..', '..', 'package.json')];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;

    let parsed: { name?: unknown; version?: unknown };
    try {
      parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: unknown; version?: unknown };
    } catch {
      // An unreadable or half-written candidate is not this program's version;
      // keep looking, and fall through to the throw below if nothing answers.
      continue;
    }

    // A `package.json` that names a different package is somebody else's, and
    // its version would be a lie about this build.
    if (typeof parsed.name === 'string' && parsed.name !== PACKAGE_NAME) continue;
    if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) continue;

    cached = parsed.version.trim();
    return cached;
  }

  throw new Error(
    `AOBPRINTER cannot read its own version: no package.json for ${PACKAGE_NAME} was found at ` +
      `${candidates.join(' or ')}. This build is packaged wrongly. It refuses to run rather than stamp ` +
      'an unknown version onto a receipt, a post or the install marker.',
  );
}

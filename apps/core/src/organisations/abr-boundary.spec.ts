import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * WHERE THE NETWORK IS ALLOWED TO BE.
 *
 * The ABR client is the one runtime network dependency in this product, and
 * the argument for having it at all is that it is confined to organisation
 * onboarding: the ABR being down delays a practice joining and cannot stop a
 * single consent being captured (CLAUDE.md hard rule 8, and the header of
 * abr.ts). That argument is only true while the confinement holds, and a
 * comment does not hold anything.
 *
 * So this walks the source of every app and package and fails if any file
 * outside `apps/core/src/organisations` imports the ABR client. It is
 * deliberately a crude string scan rather than a graph: the failure it is
 * guarding against is somebody reaching for a convenient import inside the
 * capture cascade, and a crude scan catches that on the line it is written.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ORGANISATIONS = resolve(__dirname);

const SKIP = new Set(['node_modules', 'dist', '.next', 'build', 'coverage', '.git', 'generated']);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/** Any import specifier whose last segment is the ABR client module. */
const IMPORTS_ABR = /(?:from|require\()\s*['"][^'"]*\/abr['"]|from\s*['"]\.\/abr['"]/;

describe('the ABR client stays inside onboarding', () => {
  it('abr_client_is_not_reachable_from_the_capture_path', () => {
    const roots = [join(REPO_ROOT, 'apps'), join(REPO_ROOT, 'packages')].filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });

    const offenders = roots
      .flatMap((root) => sourceFiles(root))
      .filter((file) => !file.startsWith(ORGANISATIONS + sep))
      /*
       * TESTS MAY IMPORT IT. The rule is about what the RUNNING SYSTEM can
       * reach: a spec importing the client to exercise it ships nothing and
       * reaches nothing at runtime. The live smoke test lives in
       * `apps/core/test/` because that is where e2e specs live, and excluding
       * it here is the honest reading of the rule rather than a hole in it.
       */
      // `.spec.ts`, `.e2e-spec.ts` and `.test.tsx` alike — the separator before
      // the word is a dot in one convention and a hyphen in the other.
      .filter((file) => !/[.-](spec|test)\.tsx?$/.test(file))
      .filter((file) => IMPORTS_ABR.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });

  /**
   * The guard has to be able to fail, or it is decoration. The same regex, run
   * against the module that legitimately does import the client, must match.
   */
  it('would notice an import if there were one', () => {
    const inside = readFileSync(join(ORGANISATIONS, 'organisations.module.ts'), 'utf8');
    expect(IMPORTS_ABR.test(inside)).toBe(true);
  });
});

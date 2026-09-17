/**
 * The version has to be TRUE, not merely present.
 *
 * Three things quote it and each is a promise to somebody outside this
 * program: the instance lock tells a technician which build is holding the
 * machine, the receipt records which build posted a form once the form itself
 * is gone, and the install marker decides whether the next install is an
 * upgrade or a downgrade. A placeholder would satisfy the type and break all
 * three, so the second test here is the one that matters — it asserts the
 * failure mode, not the happy path.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPackageVersion } from './version';

describe('readPackageVersion', () => {
  it("reads this workspace's own package.json version", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
    expect(readPackageVersion()).toBe(pkg.version);
  });

  it('never answers with a placeholder', () => {
    const version = readPackageVersion();
    expect(version).not.toBe('unknown');
    expect(version.trim()).not.toHaveLength(0);
    // Dotted and numeric, which is what `compareVersions` in `install-marker.ts`
    // requires of it — a version this file accepts but that one cannot order
    // would break the downgrade refusal rather than the banner.
    expect(version).toMatch(/^\d+(\.\d+)*$/);
  });

  it('is the same string every time it is asked', () => {
    // Cached on purpose: the banner, the lock file, the receipts and the
    // request header must all quote one string within a single run.
    expect(readPackageVersion()).toBe(readPackageVersion());
  });
});

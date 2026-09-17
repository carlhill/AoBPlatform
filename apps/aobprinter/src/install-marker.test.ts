/**
 * One installed version per machine. Side-by-side installs of a program that
 * claims files from a fixed path are two writers on one spool file; a
 * downgrade over a newer install is worse, because the older build may not
 * understand the outbox it inherits.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, decideInstallAction, readInstallMarker, writeInstallMarker } from './install-marker';

describe('an_older_version_refuses_to_install_over_a_newer_one', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-marker-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses a downgrade, and allows fresh, same and upgrade', () => {
    const installed = {
      version: '1.4.0',
      installedAt: '2026-09-17T00:00:00.000Z',
      installMode: 'Single' as const,
      queues: [{ name: 'AOBPRINTER', label: 'Front desk' }],
    };

    assert.equal(decideInstallAction(null, '1.4.0'), 'fresh');
    assert.equal(decideInstallAction(installed, '1.4.0'), 'same');
    assert.equal(decideInstallAction(installed, '1.5.0'), 'upgrade');
    assert.equal(decideInstallAction(installed, '1.3.9'), 'refuse_older');
  });

  it('orders versions numerically, not as text — 1.10.0 is newer than 1.9.0', () => {
    // String comparison puts '1.10.0' before '1.9.0' and would silently accept
    // a downgrade as an upgrade at exactly the point a product starts shipping
    // double-digit minors.
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
    assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  });

  it('round-trips the marker, so the next install can read what this one did', () => {
    const marker = {
      version: '1.4.0',
      installedAt: '2026-09-17T00:00:00.000Z',
      installMode: 'Lan' as const,
      queues: [
        { name: 'AOBPRINTER-Room3', label: 'Room 3' },
        { name: 'AOBPRINTER-Desk', label: 'Front desk' },
      ],
    };
    writeInstallMarker(dir, marker);
    assert.deepEqual(readInstallMarker(dir), marker);
    assert.equal(readInstallMarker(mkdtempSync(join(tmpdir(), 'aobprinter-empty-'))), null);
  });
});

/**
 * One installed version per machine. Side-by-side installs of a program that
 * claims files from a fixed path are two writers on one spool file; a
 * downgrade over a newer install is worse, because the older build may not
 * understand the outbox it inherits.
 */
import assert from 'node:assert/strict';

/** Built, not written as an escape: a literal U+FEFF in source trips the lint rule. */
const BOM = String.fromCharCode(0xfeff);
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseQueuesArgument } from './install-cli';
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

describe('a_queues_file_written_by_powershell_is_read', () => {
  /*
   * Regression, 17 September 2026, found by running the real installer.
   * `Set-Content -Encoding utf8` on Windows PowerShell 5.1 writes UTF-8 WITH a
   * byte order mark; JSON.parse rejects the leading U+FEFF. The installer had
   * already created both printers by the time the marker write failed, so the
   * machine was left with queues and no record of what version installed them
   * - the exact state the marker exists to prevent.
   *
   * This calls `parseQueuesArgument`, the function the installer actually runs.
   * A first version of this test stripped the BOM with its own inline copy of
   * the expression and parsed that, so it pinned the test's logic rather than
   * the installer's and could not have failed if the real path regressed
   * (found in review the same day).
   */
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-bom-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('parses a queues file that PowerShell wrote with a byte order mark', () => {
    const file = join(dir, 'queues.json');
    writeFileSync(file, BOM + JSON.stringify([{ name: 'AOBPRINTER-Room3', label: 'Room 3' }]), 'utf8');
    assert.deepEqual(parseQueuesArgument('@' + file), [{ name: 'AOBPRINTER-Room3', label: 'Room 3' }]);
  });

  it('reads inline JSON too, which is what a human types', () => {
    assert.deepEqual(parseQueuesArgument('[{"name":"AOBPRINTER","label":"Front desk"}]'), [
      { name: 'AOBPRINTER', label: 'Front desk' },
    ]);
  });

  it('refuses a queue name shaped like a patient identifier, on the installer path too', () => {
    // config.ts refuses it at runtime; by then the installer has already made a
    // Windows printer of that name and written it into the marker (hard rule 9).
    //
    // The CLI refuses by writing to stderr and calling process.exit, which is
    // the right thing for a program whose interface IS its exit code — so the
    // test intercepts both rather than asking the code to be less blunt.
    const file = join(dir, 'queues.json');
    writeFileSync(file, JSON.stringify([{ name: '2454232371', label: 'Room 3' }]), 'utf8');

    const realExit = process.exit;
    const realWrite = process.stderr.write.bind(process.stderr);
    let exitCode: number | undefined;
    let said = '';
    (process as any).exit = (code?: number) => {
      exitCode = code;
      throw new Error('exited');
    };
    (process.stderr as any).write = (chunk: string) => {
      said += chunk;
      return true;
    };
    try {
      assert.throws(() => parseQueuesArgument('@' + file), /exited/);
    } finally {
      process.exit = realExit;
      process.stderr.write = realWrite;
    }

    assert.equal(exitCode, 2);
    assert.match(said, /looks like a patient identifier/);
  });
});

describe('an_unreadable_marker_never_reads_as_nothing_installed', () => {
  /*
   * Regression, 17 September 2026, found by running the real installer and
   * hand-editing its marker with PowerShell. `Set-Content -Encoding utf8`
   * added a BOM, JSON.parse threw, the reader returned null, null means
   * "nothing installed", and the installer cheerfully put 0.1.0 over a marker
   * that said 99.0.0. The guard rail was off and said nothing.
   *
   * Absent is a fact. Unreadable is an unknown, and an unknown fails closed.
   */
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-badmarker-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('throws on a marker that is not valid JSON, rather than reporting nothing installed', () => {
    writeFileSync(join(dir, 'install.json'), '{ this is not json', 'utf8');
    assert.throws(() => readInstallMarker(dir), /could not be read/);
  });

  it('throws on a marker with no version', () => {
    writeFileSync(join(dir, 'install.json'), JSON.stringify({ installMode: 'Lan', queues: [] }), 'utf8');
    assert.throws(() => readInstallMarker(dir), /records no version/);
  });

  it('READS a marker written with a byte order mark, because PowerShell writes one', () => {
    const marker = { version: '99.0.0', installedAt: 'then', installMode: 'Single' as const, queues: [] };
    writeFileSync(join(dir, 'install.json'), '\uFEFF' + JSON.stringify(marker), 'utf8');
    assert.equal(readInstallMarker(dir)?.version, '99.0.0');
    // And the guard rail it feeds still refuses the downgrade.
    assert.equal(decideInstallAction(readInstallMarker(dir), '0.1.0'), 'refuse_older');
  });

  it('still returns null when there is genuinely no marker', () => {
    assert.equal(readInstallMarker(dir), null);
  });
});

/**
 * The single-instance guard rail. Two AOBPRINTER processes on one data
 * directory both claim the same spool file: one form posted twice, or one
 * form lost mid-read. The lock is the only thing standing between an ordinary
 * mistake — a service already installed, plus a technician running the program
 * in a console to see what it does — and that outcome.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireInstanceLock, instanceLockPath } from './instance-lock';
import { makeLogger } from './log';

const quiet = makeLogger(() => undefined);

describe('a_second_instance_refuses_to_start', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('refuses while the first instance is alive, and names the holder', () => {
    const first = acquireInstanceLock(dir, '1.2.3', quiet, { pid: 4242, isAlive: () => true });

    let thrown: Error | undefined;
    try {
      acquireInstanceLock(dir, '1.2.3', quiet, { pid: 5555, isAlive: () => true });
    } catch (err) {
      thrown = err as Error;
    }

    assert.ok(thrown, 'a second instance must not be allowed to start');
    // The refusal has to be actionable: a technician reads it and knows which
    // process to stop. A bare "already running" would not be.
    assert.match(thrown.message, /already running/i);
    assert.match(thrown.message, /4242/);
    assert.match(thrown.message, /1\.2\.3/);

    first.release();
  });

  it('lets the next instance start once the first has released', () => {
    acquireInstanceLock(dir, '1.2.3', quiet, { pid: 4242, isAlive: () => true }).release();
    const second = acquireInstanceLock(dir, '1.2.3', quiet, { pid: 5555, isAlive: () => true });
    assert.ok(second);
    second.release();
    assert.equal(existsSync(instanceLockPath(dir)), false, 'release must remove the lock file');
  });
});

describe('a_stale_lock_from_a_dead_process_is_reclaimed', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aobprinter-lock-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('takes over a lock whose pid is gone, because a power cut must not need a technician', () => {
    // A crash or a power cut leaves the file behind with no process to match.
    // Refusing forever would mean the practice cannot print until somebody
    // deletes a file they have never heard of.
    writeFileSync(
      instanceLockPath(dir),
      JSON.stringify({ pid: 999999, version: '1.0.0', startedAt: '2026-09-17T00:00:00.000Z' }),
      'utf8',
    );

    const lock = acquireInstanceLock(dir, '1.2.3', quiet, { pid: 7777, isAlive: (pid) => pid === 7777 });

    const holder = JSON.parse(readFileSync(instanceLockPath(dir), 'utf8')) as { pid: number; version: string };
    assert.equal(holder.pid, 7777, 'the new owner must be recorded, not the dead one');
    assert.equal(holder.version, '1.2.3');
    lock.release();
  });

  it('does NOT reclaim a lock whose pid is still alive, however old it looks', () => {
    writeFileSync(
      instanceLockPath(dir),
      JSON.stringify({ pid: 4242, version: '1.0.0', startedAt: '2001-01-01T00:00:00.000Z' }),
      'utf8',
    );
    assert.throws(
      () => acquireInstanceLock(dir, '1.2.3', quiet, { pid: 7777, isAlive: () => true }),
      /already running.*4242/s,
    );
  });
});

#!/usr/bin/env node
/**
 * Back up the Keycloak database.
 *
 * WHY THIS EXISTS, AND WHY IT MATTERS MORE THAN AN ORDINARY BACKUP.
 *
 * A password can be reset. A PASSKEY CANNOT BE RE-DERIVED. The private half
 * never leaves the authenticator, and the server holds only the public half
 * and a credential id. Lose those rows and every enrolled person has to be
 * re-invited AND has to be at their own hardware to answer — which for a
 * practitioner population means a support queue, not an afternoon.
 *
 * It has already happened once here. `start-dev` kept the H2 database inside
 * the container's writable layer, and a `docker compose up -d` that only meant
 * to change a port destroyed every user and every passkey. Keycloak now uses
 * the Postgres beside it, which survives a container rebuild — but a volume is
 * not a backup, and nothing yet survived the volume being lost.
 *
 * WHAT IS IN THE FILE. Users, credentials (the public halves), the realm, its
 * clients and roles, and the sessions. Treat it as SECRET: it is not enough to
 * impersonate anybody by itself, but it names every administrator you have and
 * is a map of the identity system. It is written with no world-readable bit
 * where the platform supports one.
 *
 * WHAT THIS IS NOT. It is not the application database. `aobplatform` holds the
 * consent evidence and has its own retention obligations (REQ-OFF-07); backing
 * that up is a separate decision with a legal shape, and doing it silently
 * inside a script named after Keycloak would be the wrong place for it.
 *
 * Usage:
 *   node infra/keycloak/backup-keycloak.mjs
 *   node infra/keycloak/backup-keycloak.mjs --out /path/to/dir
 *   node infra/keycloak/backup-keycloak.mjs --verify <file>   restore-test it
 */

import { execFile } from 'node:child_process';
import { mkdir, chmod, stat, readdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const CONTAINER = process.env.POSTGRES_CONTAINER ?? 'aobplatform-postgres';
const DB = process.env.KEYCLOAK_DB ?? 'keycloak';
const USER = process.env.POSTGRES_USER ?? 'aobplatform';

/**
 * How many to keep.
 *
 * Enough that a problem introduced and noticed a week later can still be
 * stepped back past. Not so many that the directory becomes a second place
 * this data lives in quantity, forgotten.
 */
const KEEP = 14;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/** ISO-ish and sortable, which is the only property a backup filename needs. */
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

async function containerRunning() {
  try {
    const { stdout } = await run('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Take the dump.
 *
 * `--clean --if-exists` so the file can be restored over an existing database
 * without hand-editing it first. A backup you have to edit before you can use
 * it is a backup nobody uses at three in the morning.
 */
async function backup(outDir) {
  if (!(await containerRunning())) {
    die(
      `The Postgres container "${CONTAINER}" is not running, so there is nothing to back up.\n` +
        '  Start it with:  docker compose up -d postgres',
    );
  }

  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `keycloak_${stamp()}.sql`);

  console.log(`\n  Backing up "${DB}" from ${CONTAINER}`);

  await new Promise((ok, fail) => {
    const out = createWriteStream(file);
    const child = execFile('docker', [
      'exec',
      CONTAINER,
      'pg_dump',
      '-U',
      USER,
      '-d',
      DB,
      '--clean',
      '--if-exists',
      '--no-owner',
    ]);
    let stderr = '';
    child.stdout.pipe(out);
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', fail);
    child.on('close', (code) => {
      out.end();
      if (code === 0) ok();
      else fail(new Error(stderr.trim() || `pg_dump exited ${code}`));
    });
  });

  const { size } = await stat(file);

  /*
   * A dump can succeed and be empty — a wrong database name, a role with no
   * rights to the tables. An empty file that looks like a backup is worse than
   * no file, because it stops anybody looking for the real problem.
   */
  if (size < 1024) {
    await unlink(file).catch(() => undefined);
    die(
      `The dump came back at ${size} bytes, which is not a database. Check that "${DB}" exists and that ` +
        `"${USER}" can read it. Nothing has been kept — an empty file that looks like a backup is worse ` +
        'than no file.',
    );
  }

  // Owner-only where the platform honours it. On Windows this is close to a
  // no-op, which is worth knowing rather than assuming.
  await chmod(file, 0o600).catch(() => undefined);

  console.log(`  Written  ${file}`);
  console.log(`  Size     ${(size / 1024).toFixed(0)} KB\n`);

  await prune(outDir);
  return file;
}

async function prune(outDir) {
  const files = (await readdir(outDir))
    .filter((f) => /^keycloak_.*\.sql$/.test(f))
    .sort()
    .reverse();
  const stale = files.slice(KEEP);
  for (const f of stale) await unlink(join(outDir, f)).catch(() => undefined);
  if (stale.length > 0) console.log(`  Removed ${stale.length} older than the last ${KEEP}.\n`);
}

/**
 * RESTORE-TEST IT, into a throwaway database.
 *
 * A backup nobody has restored is a hypothesis. This is the cheap version of
 * testing it: load the file into a scratch database beside the real one and
 * count what came back. It does not touch the live database at any point, and
 * it drops the scratch one afterwards whether it passed or failed.
 */
async function verify(file) {
  if (!(await containerRunning())) die(`The Postgres container "${CONTAINER}" is not running.`);

  const scratch = `keycloak_verify_${Date.now().toString(36)}`;
  console.log(`\n  Restoring ${file} into a throwaway database (${scratch})\n`);

  const psql = (db, sql) => run('docker', ['exec', CONTAINER, 'psql', '-U', USER, '-d', db, '-c', sql]);

  await psql('postgres', `CREATE DATABASE "${scratch}"`);
  try {
    // Piped in rather than mounted, so this works wherever the file is.
    await new Promise((ok, fail) => {
      const child = execFile('docker', ['exec', '-i', CONTAINER, 'psql', '-q', '-U', USER, '-d', scratch]);
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', fail);
      child.on('close', (code) => (code === 0 ? ok() : fail(new Error(stderr.trim() || `psql exited ${code}`))));
      import('node:fs').then(({ createReadStream }) => createReadStream(file).pipe(child.stdin));
    });

    const counts = {};
    for (const table of ['user_entity', 'credential', 'realm', 'client']) {
      const { stdout } = await psql(scratch, `SELECT count(*) FROM ${table}`);
      counts[table] = Number((stdout.match(/\d+/) ?? ['0'])[0]);
    }

    console.log(`    users        ${counts.user_entity}`);
    console.log(`    credentials  ${counts.credential}`);
    console.log(`    realms       ${counts.realm}`);
    console.log(`    clients      ${counts.client}\n`);

    /*
     * The check that matters. Realms and clients come back from the realm
     * import on every start, so a restore that produced only those would look
     * healthy and contain nobody — which is EXACTLY the shape of the failure
     * that destroyed the H2 store: the system looked fine and only the users
     * were gone.
     */
    if (counts.user_entity === 0) {
      die(
        'The restore produced ZERO users. Realms and clients come back from the realm import on every ' +
          'start, so a backup holding only those looks healthy and contains nobody — which is exactly how ' +
          'the H2 store was lost without anyone noticing. This file is not a usable backup.',
      );
    }

    console.log('  The backup restores, and it has people in it.\n');
  } finally {
    await psql('postgres', `DROP DATABASE IF EXISTS "${scratch}"`).catch(() => undefined);
  }
}

async function main() {
  const toVerify = arg('--verify');
  const outDir = resolve(arg('--out') ?? 'backups/keycloak');

  if (toVerify) {
    await verify(resolve(toVerify));
    return;
  }

  const file = await backup(outDir);

  console.log('  Restore-test it now, because a backup nobody has restored is a hypothesis:');
  console.log(`    node infra/keycloak/backup-keycloak.mjs --verify ${file}\n`);
  console.log('  KEEP IT SOMEWHERE ELSE. A backup on the same disk as the database survives a mistake');
  console.log('  and not a disk. It names every administrator you have; treat it as secret.\n');
}

main().catch((err) => die(err.message));

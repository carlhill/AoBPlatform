/**
 * EVERY E2E RUN GETS A DATABASE OF ITS OWN (Carl, 11 Oct 2026).
 *
 * WHAT WENT WRONG WITHOUT THIS. Every worktree's e2e suites pointed at the one
 * `aobplatform_test`, and on 11 October two agents were running
 * `db4-assignment.e2e-spec.ts` against it at the same moment. The suites empty
 * whole tables — some 370 unfiltered `deleteMany({})` and `DELETE FROM` calls
 * across the spec files — so each run deletes the other's rows mid-flight.
 * `maxWorkers: 1` in `jest.e2e.config.js` keeps the files of ONE run serial; it
 * cannot see a run started from another worktree.
 *
 * WHY NOT A PREFIX ON THE TEST DATA. Carl asked whether each agent could tag
 * its rows instead. A tag protects nothing from an unfiltered delete, several
 * suites count whole tables, and the vault outbox is one unscoped table — every
 * spec would need rewriting, and the first unfiltered delete written after that
 * would bring the collision back with nothing to say so. The unique id goes on
 * the DATABASE, where the suites cannot reach past it.
 *
 * WHY NOT A LOCK. A lock makes runs queue. A clone lets them run side by side,
 * and a clone from a template is one `CREATE DATABASE` statement.
 *
 * SO, ONCE PER RUN, BEFORE ANY SUITE: clone `aobplatform_e2e_template` (built by
 * `scripts/dev/test-db.sh`) into `aobplatform_e2e_<UTC stamp>_<random>_test`,
 * point `E2E_DATABASE_URL` at it, and give the run its own artefact folder.
 * `e2e-database.global-teardown.ts` drops both at the end. The name still ends
 * in `_test`, so `test-database.setup.ts` checks it exactly as before, and the
 * suites still connect as `aob_app`, so RLS is still exercised.
 *
 * AN EXPLICIT `E2E_DATABASE_URL` IS LEFT ALONE. CI provisions a fresh database
 * per job and says so; a developer who names a database means that one.
 */
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/** Never connected to and never tested against: `test-db.sh` disallows connections once it is built. */
export const TEMPLATE_DATABASE = 'aobplatform_e2e_template';

/**
 * THE ONLY SHAPE THIS FILE WILL CREATE OR DROP. A database name cannot be a
 * bound parameter, so every name that reaches DDL is generated here and checked
 * against this first — nothing from the environment is ever interpolated.
 */
export const RUN_DATABASE = /^aobplatform_e2e_(\d{14})_[0-9a-f]{8}_test$/;

/** The container's superuser, for CREATE and DROP only. The suites themselves never use it (see test-database.setup.ts). */
const DEFAULT_ADMIN_URL = 'postgresql://aobplatform:aobplatform@127.0.0.1:21020/postgres';

/** Same host and role as `DEFAULT_TEST_URL` in test-database.setup.ts — only the database differs. */
const runDatabaseUrl = (name: string) => `postgresql://aob_app:aob_app@127.0.0.1:21020/${name}?schema=core`;

/**
 * A RUN THAT CRASHED NEVER REACHED ITS TEARDOWN. Its database is dropped by a
 * later run once it is this old and nothing is connected to it. Twelve hours
 * is far longer than any run, so a live one is never touched.
 */
const ABANDONED_AFTER_MS = 12 * 60 * 60 * 1000;

export const adminClient = () =>
  new PrismaClient({ datasourceUrl: process.env.E2E_ADMIN_DATABASE_URL ?? DEFAULT_ADMIN_URL });

export const runArtefactRoot = (name: string) => join(tmpdir(), 'aobplatform-e2e', name);

const stampOf = (at: Date) => at.toISOString().replace(/\D/g, '').slice(0, 14);

const stampToTime = (stamp: string) =>
  Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14));

async function dropAbandoned(admin: PrismaClient): Promise<void> {
  const idle = await admin.$queryRaw<{ datname: string }[]>`
    SELECT d.datname FROM pg_database d
    WHERE NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)`;
  for (const { datname } of idle) {
    const match = RUN_DATABASE.exec(datname);
    if (!match || Date.now() - stampToTime(match[1]) < ABANDONED_AFTER_MS) continue;
    // Housekeeping only: somebody may have connected since the listing, and
    // that must not fail a run that has nothing to do with this database.
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}"`);
    } catch (err) {
      console.warn(`e2e: left abandoned ${datname} in place: ${(err as Error).message}`);
    }
  }
}

export default async function e2eDatabaseSetup(): Promise<void> {
  if (process.env.E2E_DATABASE_URL) return;

  const admin = adminClient();
  try {
    const [template] = await admin.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${TEMPLATE_DATABASE}) AS found`;
    if (!template.found) {
      throw new Error(
        `E2E has no template database to copy: "${TEMPLATE_DATABASE}" does not exist. `
          + 'Build it with: bash scripts/dev/test-db.sh',
      );
    }

    await dropAbandoned(admin);

    const name = `aobplatform_e2e_${stampOf(new Date())}_${randomBytes(4).toString('hex')}_test`;
    if (!RUN_DATABASE.test(name)) throw new Error(`E2E generated a database name it will not use: ${name}`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DATABASE}"`);

    process.env.E2E_RUN_DATABASE = name;
    process.env.E2E_DATABASE_URL = runDatabaseUrl(name);
    // Set before any suite builds a Nest application, so it wins over apps/core/.env
    // (ConfigModule only fills keys that are not already present).
    process.env.ARTEFACT_STORE_ROOT = runArtefactRoot(name);
    console.warn(`\ne2e: this run's database is ${name}`);
  } finally {
    await admin.$disconnect();
  }
}

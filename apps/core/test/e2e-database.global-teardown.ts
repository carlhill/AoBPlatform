/**
 * DROP THE RUN'S OWN DATABASE AND ARTEFACT FOLDER — see
 * e2e-database.global-setup.ts for why each run has them.
 *
 * `WITH (FORCE)` because a suite that forgot to close its Nest application
 * still holds connections, and a teardown that failed on them would leave a
 * database behind for every such run. Only a name this run created, and that
 * matches `RUN_DATABASE`, is ever dropped.
 *
 * `E2E_KEEP_DATABASE=1` keeps both, to look at what a failing run left.
 */
import { rm } from 'node:fs/promises';
import { RUN_DATABASE, adminClient, runArtefactRoot } from './e2e-database.global-setup';

export default async function e2eDatabaseTeardown(): Promise<void> {
  const name = process.env.E2E_RUN_DATABASE;
  if (!name || !RUN_DATABASE.test(name)) return;

  if (process.env.E2E_KEEP_DATABASE === '1') {
    console.warn(`\ne2e: kept ${name} and ${runArtefactRoot(name)} (E2E_KEEP_DATABASE=1)`);
    return;
  }

  const admin = adminClient();
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
  await rm(runArtefactRoot(name), { recursive: true, force: true });
}

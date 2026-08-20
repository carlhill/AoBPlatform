/**
 * The ChainStore contract suite against a REAL immudb (docker compose
 * locally on 21022; a service container in CI). Zero new assertions — the
 * whole point of the contract suite is that the durable store proves itself
 * with the same tests as the verified reference implementation.
 */
import { randomUUID } from 'node:crypto';
import { chainStoreContractTests } from '../src/chain/chain-store.contract';
import { ImmudbChainStore } from '../src/chain/immudb-chain-store';
import { VaultPrismaService } from '../src/prisma/prisma.service';

const HOST = process.env.IMMUDB_HOST ?? 'localhost';
const PORT = process.env.IMMUDB_PORT ?? '21022';

describe('ImmudbChainStore — ChainStore contract against real immudb + Postgres index', () => {
  jest.setTimeout(60_000);
  const prisma = new VaultPrismaService();
  const namespaces: string[] = [];

  afterAll(async () => {
    await prisma.chainEntryIndex.deleteMany({ where: { namespace: { in: namespaces } } });
    await prisma.$disconnect();
  });

  chainStoreContractTests(async () => {
    // One database, a fresh NAMESPACE per test = a fresh, empty chain
    // (immudb-node's client is a singleton; databases don't isolate tests,
    // namespaces do).
    const namespace = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    namespaces.push(namespace);
    const store = new ImmudbChainStore(
      {
        host: HOST,
        port: PORT,
        username: process.env.IMMUDB_USER ?? 'immudb',
        password: process.env.IMMUDB_PASSWORD ?? 'immudb',
        database: process.env.IMMUDB_DATABASE ?? 'aobvaulttest',
        namespace,
        // Fresh state file per test run — stale root state breaks proofs.
        statePath: `${process.env.TEMP ?? '/tmp'}/immudb-root-${process.pid}`,
      },
      prisma,
    );
    await store.init();
    return store;
  });
});

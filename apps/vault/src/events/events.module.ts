import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { CHAIN_STORE } from '../chain/chain-store';
import { InMemoryChainStore } from '../chain/in-memory-chain-store';
import { ImmudbChainStore } from '../chain/immudb-chain-store';
import { VaultPrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [EventsController],
  providers: [
    VaultPrismaService,
    EventsService,
    {
      provide: CHAIN_STORE,
      inject: [ConfigService, VaultPrismaService],
      useFactory: async (config: ConfigService, prisma: VaultPrismaService) => {
        const mode = config.get<string>('CHAIN_STORE', 'memory');
        if (mode === 'immudb') {
          const store = new ImmudbChainStore(
            {
              host: config.get<string>('IMMUDB_HOST', 'localhost'),
              port: config.get<string>('IMMUDB_PORT', '3322'),
              username: config.get<string>('IMMUDB_USER', 'immudb'),
              password: config.get<string>('IMMUDB_PASSWORD', 'immudb'),
              database: config.get<string>('IMMUDB_DATABASE', 'aobvault'),
              namespace: config.get<string>('IMMUDB_NAMESPACE', 'aobvault'),
              statePath: config.get<string>('IMMUDB_STATE_PATH', '.immudb-state/root'),
            },
            prisma,
          );
          await store.init();
          return store;
        }
        console.warn(
          '[vault] CHAIN_STORE=memory — DEV ONLY reference store. Evidence does not survive a restart ' +
            'and is not tamper-evident at rest. Use CHAIN_STORE=immudb for the durable store.',
        );
        return new InMemoryChainStore();
      },
    },
  ],
  exports: [EventsService],
})
export class EventsModule {}

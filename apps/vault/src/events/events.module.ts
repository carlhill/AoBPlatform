import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { CHAIN_STORE } from '../chain/chain-store';
import { InMemoryChainStore } from '../chain/in-memory-chain-store';
import { ImmudbChainStore } from '../chain/immudb-chain-store';

@Module({
  controllers: [EventsController],
  providers: [
    EventsService,
    {
      provide: CHAIN_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const mode = config.get<string>('CHAIN_STORE', 'memory');
        if (mode === 'immudb') return new ImmudbChainStore();
        console.warn(
          '[vault] CHAIN_STORE=memory — DEV ONLY reference store. Evidence does not survive a restart ' +
            'and is not tamper-evident at rest. Production requires the human-authored ImmudbChainStore.',
        );
        return new InMemoryChainStore();
      },
    },
  ],
  exports: [EventsService],
})
export class EventsModule {}

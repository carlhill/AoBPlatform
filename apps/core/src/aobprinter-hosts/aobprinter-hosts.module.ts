import { Module } from '@nestjs/common';
import { AobPrinterHostsController, PlatformAobPrinterHostsController } from './aobprinter-hosts.controller';
import { AobPrinterHostsService } from './aobprinter-hosts.service';
import { AobPrinterHostsSweep } from './aobprinter-hosts.sweep';

/**
 * THE AOBPRINTER HOSTS (PRINTER-HEARTBEAT.md §3, D-2026-10-10-02). Owns
 * `aobprinter_hosts` and nothing else. Below `InboundModule` in the import
 * graph: the heartbeat arrives on the print-jobs door, resolves what it needs
 * from the services that own print jobs and agreements, and records the host
 * through `AobPrinterHostsService`.
 */
@Module({
  controllers: [AobPrinterHostsController, PlatformAobPrinterHostsController],
  providers: [AobPrinterHostsService, AobPrinterHostsSweep],
  exports: [AobPrinterHostsService],
})
export class AobPrinterHostsModule {}

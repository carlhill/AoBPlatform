'use client';

import { AobPrinterHostsOverviewView } from './AobPrinterHostsOverviewView';

/**
 * `/platform/aobprinter-hosts` — every practice's AOBPRINTER host, worst first
 * (PRINTER-HEARTBEAT.md §4, D-2026-10-10-02 decision 10). `platform` in the
 * page-access map; back goes up to the organisation list.
 */
export default function AobPrinterHostsPage() {
  return <AobPrinterHostsOverviewView />;
}

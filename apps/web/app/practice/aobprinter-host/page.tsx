'use client';

import { PracticeGate } from '../PracticeGate';
import { AobPrinterHostView } from './AobPrinterHostView';

/**
 * `/practice/aobprinter-host` — the practice's AOBPRINTER host
 * (PRINTER-HEARTBEAT.md §4, D-2026-10-10-02).
 *
 * `practice_admin` in the domain's page-access map and on the `db4` surface,
 * the same audience as `/practice/devices`: the host is the practice's own
 * capture equipment. Re-baselining is never here (decision 7).
 */
export default function AobPrinterHostPage() {
  return <PracticeGate>{(practiceId) => <AobPrinterHostView practiceId={practiceId} />}</PracticeGate>;
}

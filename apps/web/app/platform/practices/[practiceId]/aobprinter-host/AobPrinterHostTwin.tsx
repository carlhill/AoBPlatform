'use client';

/**
 * THE AOBPRINTER HOST, SEEN AS THE PLATFORM (PRINTER-HEARTBEAT.md §4,
 * D-2026-10-10-02).
 *
 * The practice's OWN view inside `ViewOnly`, like every twin, so what an
 * operator reads is exactly what the practice reads.
 *
 * AND ONE THING THE PRACTICE NEVER HAS: Re-baseline (decision 7). It is the
 * platform's act, not something done "as the practice", so it does not belong
 * inside the read-only region — and inside it, the disabled fieldset would
 * make it inert anyway. It sits below that region, appears only for a host
 * whose chain is regressed, and reads the same `GET /aobprinter-hosts` the
 * view reads (handed up through `onView`, so there is one fetch, not two).
 * While it is in flight the view's poll pauses, as `DevicesView` pauses while
 * an act is in flight; when it lands, every registered loader re-reads.
 */

import { useState } from 'react';
import type { AobPrinterHostsView } from '@aobplatform/contracts';
import { AobPrinterHostView } from '../../../../practice/aobprinter-host/AobPrinterHostView';
import { refreshAll } from '../../../../refresh';
import { ViewOnly } from '../ViewOnly';
import { RebaselinePanel } from './RebaselinePanel';

export function AobPrinterHostTwin({ practiceId }: { practiceId: string }) {
  const [view, setView] = useState<AobPrinterHostsView | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <ViewOnly practiceId={practiceId}>
        <AobPrinterHostView practiceId={practiceId} paused={busy} onView={setView} />
      </ViewOnly>
      <RebaselinePanel hosts={view?.hosts ?? []} onBusy={setBusy} onDone={() => void refreshAll()} />
    </>
  );
}

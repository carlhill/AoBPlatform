'use client';

import { PracticeGate } from '../PracticeGate';
import { TabletView } from './TabletView';

/**
 * `/practice/tablet` — "Send to the tablet".
 *
 * `practice` IN THE PAGE-ACCESS MAP, and NOT `practice_admin` — the difference
 * from `/practice/devices` is the reasoning. Registering a device hands out the
 * credential that opens a practice's waiting list, which is a decision about
 * who may reach patient records and belongs to the administrator. USING a
 * tablet that is already paired is the ordinary work of the front desk,
 * performed dozens of times a morning by whoever is standing at it. An
 * administrator-only page here would mean either that reception cannot do its
 * job, or that every receptionist is an administrator — and the second is how
 * access controls die.
 */
export default function TabletPage() {
  return <PracticeGate>{(practiceId) => <TabletView practiceId={practiceId} />}</PracticeGate>;
}

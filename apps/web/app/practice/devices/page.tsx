'use client';

import { PracticeGate } from '../PracticeGate';
import { DevicesView } from './DevicesView';

/**
 * `/practice/devices` — the practice's paired tablets.
 *
 * `practice_admin` in the domain's page-access map, the same audience as
 * `/practice/users` and for the same reason: registering a device hands out
 * the credential that opens this practice's waiting list, and revoking one
 * takes it back. That is the same class of decision as deciding who may sign
 * in, not a setting.
 */
export default function DevicesPage() {
  return <PracticeGate>{(practiceId) => <DevicesView practiceId={practiceId} />}</PracticeGate>;
}

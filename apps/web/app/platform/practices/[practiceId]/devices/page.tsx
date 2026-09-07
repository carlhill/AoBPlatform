'use client';

/**
 * DevicesView, seen as the platform rather than as the practice.
 *
 * The view is the practice's OWN component — so what an operator reads is
 * exactly what the practice reads, and the two cannot drift into telling
 * different stories about the same tablets.
 *
 * `ViewOnly` wraps it in a disabled fieldset, so Add tablet, Revoke, Rotate
 * and the test-device toggle are all inert rather than merely warned about —
 * that holds regardless of anything below.
 *
 * `GET /devices` is `@PracticeScoped` (the same reasoning as
 * `/practice/users` — handing out the credential that opens a practice's
 * waiting list is the practice's own act), which is enforced against the
 * CALLER'S OWN VERIFIED TOKEN: once a deployment authenticates practice-
 * scoped callers for real, a genuine platform token carries no practice claim
 * and this list is refused, the same as the setup hub's Tablets card
 * anticipates. `DevicesView` shows that refusal in its own load-error state
 * rather than this page working around it — seeing the real list means
 * acting as the practice.
 */

import { use } from 'react';
import { DevicesView } from '../../../../practice/devices/DevicesView';
import { ViewOnly } from '../ViewOnly';

export default function ViewDevicesPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <DevicesView practiceId={practiceId} />
    </ViewOnly>
  );
}

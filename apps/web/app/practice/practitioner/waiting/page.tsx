'use client';

import { Suspense } from 'react';
import { WaitingView } from './WaitingView';

/**
 * `/practice/practitioner/waiting` — WHO IS WAITING, AND IS THEIR PAPERWORK
 * DONE (Carl, 12 Sep 2026; PRACTITIONER-QUEUE-PAGE.md §3).
 *
 * TWO AUDIENCES IN THE PAGE MAP, `practitioner` AND `practice`, and the two
 * see different lists of the same data: a practitioner their own, everybody
 * else every practitioner's, grouped. WHOSE list is decided by the SERVER from
 * the token — the browser has no way to ask for somebody else's, which is what
 * makes §4.2 ("never show another practitioner's list") a property of the
 * query rather than of this component.
 *
 * NOT WRAPPED IN `PracticeGate`, for the reason the landing page gives: a
 * practitioner's token carries no practice claim, and gating on one would
 * close the page to the audience it was written for. `usePractice` is still
 * consulted, because a practice user HAS a claim and it is the right answer
 * for them.
 *
 * `Suspense` BECAUSE OF `useSearchParams`. The optional `?practice=` names
 * which practice a multi-practice practitioner is at today; it grants nothing,
 * and the server checks it against their own affiliations.
 */
export default function PractitionerWaitingPage() {
  return (
    <Suspense>
      <WaitingView />
    </Suspense>
  );
}

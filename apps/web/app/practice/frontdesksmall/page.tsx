'use client';

import { PracticeGate } from '../PracticeGate';
import { SmallDeskView } from './SmallDeskView';

/**
 * `/practice/frontdesksmall` — the front desk on a small screen (Carl, 12
 * September 2026: *"If the Practice has small screens, we will need to go to a
 * different design."*; SESSION-HANDOVER.md, "A proposal for the small-screen
 * version").
 *
 * A SEPARATE ROUTE, AND `/practice/frontdesk` STAYS EXACTLY AS IT IS. The wide
 * desk's five rails buy at-a-glance grouping, which is worth the room on a
 * monitor and is not worth it on a laptop. Both are the same morning; a
 * practice chooses by the screen it has.
 *
 * `practice` IN THE PAGE-ACCESS MAP, the same audience as `/practice/frontdesk`
 * and `/practice/tablet`, and it grants nothing any of them does not — the same
 * practice-scoped reads behind the same RLS, and every act behind it is the
 * same `@PracticeScoped` act it already was. A different audience would mean
 * the same work was reception's on one screen size and somebody else's on
 * another.
 */
export default function FrontDeskSmallPage() {
  return <PracticeGate>{(practiceId) => <SmallDeskView practiceId={practiceId} />}</PracticeGate>;
}

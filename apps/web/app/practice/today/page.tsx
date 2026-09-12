'use client';

import { PracticeGate } from '../PracticeGate';
import { TodayView } from './TodayView';

/**
 * `/practice/today` — THE DAY'S WORK (Carl, 12 Sep 2026;
 * PRACTICE-NAVIGATION.md §2).
 *
 * WRAPPED IN `PracticeGate`, unlike the practitioner's landing page beside it,
 * and the difference is the whole reason there are two landings. A practice
 * user IS a practice claim (ROLES.md §2), so "which practice" is answered
 * before the page renders and the gate is the right shape. A practitioner
 * deliberately carries no such claim, which is why their home resolves the
 * practice from their own affiliations instead.
 *
 * THE LANDING RULE THAT SENDS PEOPLE HERE LIVES IN `landingPath`
 * (`packages/domain/src/landing.ts`), never in a redirect on
 * `/practice/setup`. §5 rule 3: nothing moves — the setup hub still opens from
 * its own URL, and a bookmark to it still works. What changed is where an
 * arrival is put down.
 */
export default function TodayPage() {
  return <PracticeGate>{(practiceId) => <TodayView practiceId={practiceId} />}</PracticeGate>;
}

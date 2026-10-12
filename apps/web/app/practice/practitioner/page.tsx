'use client';

import { PractitionerLandingView } from './PractitionerLandingView';

/**
 * `/practice/practitioner` — WHERE A PRACTITIONER LANDS WHEN THEY SIGN IN AT A
 * PRACTICE (Carl, 12 Sep 2026; PRACTITIONER-QUEUE-PAGE.md §1).
 *
 * NOT WRAPPED IN `PracticeGate`, AND THAT IS THE POINT. The gate answers
 * "which practice is this page about" from a practice CLAIM or a stored
 * selection, and a practitioner's token deliberately carries neither — they
 * work at several practices and which ones changes
 * (`PractitionerAccessService`). Gating this page on a practice claim would
 * close the practitioner's own home to practitioners. The practice is resolved
 * from their own affiliations instead, by the view, and every server read
 * behind it re-checks that they work there.
 *
 * `practitioner` IN THE PAGE-ACCESS MAP, alone: there is nothing on it a
 * practice user needs, and the queue beneath it names its own wider audiences.
 *
 * THE LANDING RULE THAT SENDS PEOPLE HERE LIVES IN `landingPath`
 * (`packages/domain/src/landing.ts`), not in a redirect on `/practice/setup`.
 * ROLES.md §6 rule 5 asks for one obvious home for it; that function already
 * decides where every other audience goes, is asked by the OIDC callback and
 * the root page, and a second copy anywhere would drift.
 */
export default function PractitionerLandingPage() {
  return <PractitionerLandingView />;
}

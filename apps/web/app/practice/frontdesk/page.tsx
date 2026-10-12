'use client';

import { PracticeGate } from '../PracticeGate';
import { FrontDeskView } from './FrontDeskView';

/**
 * `/practice/frontdesk` — Practice Frontdesk (Carl, 12 Sep 2026;
 * FRONT-DESK-PAGE.md §11, "a separate route, linked from the setup hub").
 *
 * A SEPARATE ROUTE, AND THE EXISTING PAGES STAY EXACTLY AS THEY ARE. The
 * tablet desk and the patient work page are expert tools and Carl wants them
 * kept; this is the same work shown so a person on their first shift can do
 * it. Nothing here replaces anything.
 *
 * `practice` IN THE PAGE-ACCESS MAP, the same audience as `/practice/tablet`
 * and for the identical reason: this is reception's ordinary work. It grants
 * nothing the tablet page does not — the same practice-scoped reads, behind
 * the same RLS — so an administrator-only page here would mean either that
 * reception cannot do its job or that every receptionist is an administrator.
 */
export default function FrontDeskPage() {
  return <PracticeGate>{(practiceId) => <FrontDeskView practiceId={practiceId} />}</PracticeGate>;
}

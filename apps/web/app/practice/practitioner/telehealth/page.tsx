'use client';

import { Suspense } from 'react';
import { TelehealthPanel } from './TelehealthPanel';

/**
 * `/practice/practitioner/telehealth` — the practitioner's Telehealth panel
 * (TELEHEALTH-PLAN.md §8 step 2). Practitioner-only in the page map.
 *
 * NOT WRAPPED IN `PracticeGate`, for the reason the waiting list gives: a
 * practitioner's token carries no practice claim. `Suspense` because of
 * `useSearchParams` (`?practice=` for a practitioner at several practices;
 * it grants nothing, and core checks it against their own affiliations).
 */
export default function TelehealthPage() {
  return (
    <Suspense>
      <TelehealthPanel />
    </Suspense>
  );
}

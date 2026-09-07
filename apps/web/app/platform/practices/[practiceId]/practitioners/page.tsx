'use client';

/**
 * A practice's practitioners, VIEW-ONLY, as the platform.
 *
 * This page used to be the register-check working page, on the argument that
 * checking is platform work. Carl overruled it, and his reason is better than
 * the argument: "I want a complete view-only page. We may have users who only
 * have view-only access." A tree that is read-only except for one page is not
 * a read-only tree — it is a rule with an asterisk, and the asterisk is where
 * a view-only user's one working button will someday be.
 *
 * So everything under /platform/practices/{id} is inert, uniformly. The
 * register-check WORK moved next door to ./check, which the organisation
 * list's "Check their practitioners" door points at — the job is unchanged,
 * it simply no longer lives inside the read-only tree.
 */

import { use } from 'react';
import { PractitionersView } from '../../../../practice/practitioners/PractitionersView';
import { ViewOnly } from '../ViewOnly';

export default function ViewPractitionersPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <ViewOnly practiceId={practiceId}>
      <PractitionersView practiceId={practiceId} mode="platform" />
    </ViewOnly>
  );
}

'use client';

/**
 * The register-check WORKING page — the one door in the platform tree that is
 * not view-only, and deliberately outside the read-only route above it.
 *
 * WHY IT EXISTS, in Carl's words from when the route was first cut: "there are
 * things the platform also has to do that are platform-only tasks — like
 * validate the practitioner against the register — in this case there is no
 * acting-as." Doing our check from inside the practice's session would be
 * wrong twice over: the attestation would read as THEIRS (a self-attestation
 * wearing the name of an independent one), and it would force a reapproval —
 * charging the impersonation price because we did our own job.
 *
 * THE SERVER ALWAYS KNEW. `recordRegistration` is PLATFORM_ADMIN and takes no
 * practice scope. This page only gives the browser a door that matches.
 *
 * What an operator may do here is narrow: read the roster, record register
 * checks. Adding a practitioner and inviting one are the practice's acts and
 * still need acting-as.
 */

import { use } from 'react';
import { PractitionersView } from '../../../../../practice/practitioners/PractitionersView';

export default function CheckPractitionersPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return <PractitionersView practiceId={practiceId} mode="platform" />;
}

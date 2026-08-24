'use client';

/**
 * A practice's practitioners, reached AS THE PLATFORM.
 *
 * WHY THIS ROUTE EXISTS, in Carl's words: "there are things the platform also
 * has to do that are platform-only tasks — like validate the practitioner
 * against the register — in this case there is no acting-as."
 *
 * He is right, and the shape was wrong. Every route to this page was
 * practice-scoped, so an operator could only get here by acting as the
 * practice. Doing our own check from inside their session is wrong twice over:
 *
 *   1. THE ATTESTATION WOULD BE THEIRS. A practice recording its own
 *      practitioner as Registered is a self-attestation wearing the name of an
 *      independent one, and in the audit trail it reads identically to a real
 *      one. That is the exact thing `recordRegistration` being PLATFORM_ADMIN
 *      exists to prevent.
 *
 *   2. IT WOULD FORCE A REAPPROVAL. Acting as a practice makes that practice
 *      need approving again — a deliberate cost of impersonation. Charging it
 *      because we did our own job is nonsense, and it would teach operators to
 *      avoid the check rather than pay it.
 *
 * THE SERVER ALWAYS KNEW. `recordRegistration` is `@RequireRoles(PLATFORM_ADMIN)`
 * and takes no practice scope — it operates on the person-level practitioner.
 * Only the browser was missing the door. This adds the door; it changes no
 * permission.
 *
 * WHAT AN OPERATOR MAY DO HERE is therefore narrower, not wider: read the
 * roster, and record register checks. Adding a practitioner and inviting one
 * are the practice's acts, and those still need acting-as.
 */

import { use } from 'react';
import { PractitionersView } from '../../../../practice/practitioners/PractitionersView';

export default function PlatformPractitionersPage({
  params,
}: {
  params: Promise<{ practiceId: string }>;
}) {
  const { practiceId } = use(params);
  return <PractitionersView practiceId={practiceId} mode="platform" />;
}

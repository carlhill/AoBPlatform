'use client';

/**
 * A practice's setup hub, READ-ONLY, as the platform.
 *
 * Carl's words: "just for me to view the setup of XLEVELUP I need to act as this
 * practice. I need the same end page but in view mode, and I should be able to
 * link to the other pages in view mode from the cards."
 *
 * He is right that the price was wrong. Acting as a practice is a recorded
 * impersonation: it tells the practice, it forces a reapproval by a second
 * person, and it is the correct price for DOING something on their behalf. It
 * is far too heavy for looking — and a price that heavy for looking means
 * people stop looking, which is worse for everybody than the thing it protects.
 *
 * IT GRANTS NOTHING. An operator arriving here carries no practice claim, so
 * every mutating endpoint behind these pages already refuses them; that has
 * always been true. What changes is that the console now shows what the server
 * would do, instead of offering controls that fail.
 *
 * WHAT IS STILL FORBIDDEN stays forbidden, and the read-only pages must not
 * become a way around it: provider numbers do not cross a practice boundary,
 * and nothing here may show one.
 */

import { use } from 'react';
import { SetupHub } from '../../../practice/setup/SetupHub';

export default function ViewPracticePage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return <SetupHub practiceId={practiceId} viewOnly />;
}

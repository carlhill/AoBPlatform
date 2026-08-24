'use client';

/**
 * The band that says "you are looking, not working".
 *
 * WHY IT HAS TO BE SAID, and said on every one of these pages.
 *
 * A read-only page that looks exactly like the editable one is a trap. Somebody
 * types into a field, presses save, and is refused by the server — correctly,
 * because they hold no practice claim — and what they learn is that the product
 * is broken, not that they were in the wrong mode. The refusal is right and the
 * lesson is wrong.
 *
 * WHY THE CONTROLS ARE STILL THERE for now. Hiding every mutating control on
 * every practice page means a flag threaded through a dozen views, and doing
 * that badly leaves half a page disabled and half not, which is worse than one
 * honest sentence at the top. So this band is the first move and not the last:
 * the pages that matter most get the flag properly, and this says the truth
 * everywhere meanwhile.
 *
 * The server was never the problem. An operator has no practice claim, so every
 * write behind these pages already refuses them, and always did.
 */

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Notice, ui } from '../../../ui';
import { strings } from '../../../strings';

export function ViewOnly({ practiceId }: { practiceId: string }) {
  return (
    <Notice tone="warn" title={strings.viewOnly.title} data-testid="view-only">
      <p>{strings.viewOnly.body}</p>
      <p className={ui.hint}>
        <Eye size={13} aria-hidden="true" /> {strings.viewOnly.hint}{' '}
        <Link href="/practice">{strings.viewOnly.toList}</Link>
      </p>
      <p className={ui.hint}>
        <Link href={`/platform/practices/${practiceId}`}>{strings.viewOnly.toHub}</Link>
      </p>
    </Notice>
  );
}

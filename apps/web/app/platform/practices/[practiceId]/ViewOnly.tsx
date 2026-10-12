'use client';

/**
 * A practice page opened as the platform: readable, and genuinely inert.
 *
 * THE FIRST VERSION OF THIS WAS A WARNING, AND A WARNING WAS NOT ENOUGH.
 *
 * It said "nothing you do on this page will save" above a page whose forms were
 * fully alive. Carl typed an address into "Add a location", pressed the button
 * and got "Failed to fetch" — which reads as a broken product, not as being in
 * the wrong mode. A sentence at the top does not survive contact with a form
 * that looks ready to use; people read the form, not the banner.
 *
 * SO THE CONTROLS ARE ACTUALLY DISABLED, by a `fieldset[disabled]` around the
 * whole region.
 *
 * That is one wrapper rather than a `readOnly` flag threaded through a dozen
 * views, and it is the more honest of the two: a flag gets added to the
 * controls somebody remembered, and the one they forgot is the one that
 * silently fails a year later. A disabled fieldset disables every nested
 * input, select, textarea and button by definition of the HTML — including the
 * ones added next month by somebody who has never read this file.
 *
 * LINKS STILL WORK, which is exactly right. A disabled fieldset does not
 * disable anchors, so an operator can still move around, follow a gap to the
 * page that explains it, and read everything. Reading was the whole point.
 *
 * The server was never the problem and still is not. An operator carries no
 * practice claim, so every write behind these pages already refuses them. This
 * is about not inviting somebody to try.
 */

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { strings } from '../../../strings';
import styles from './viewOnly.module.css';

export function ViewOnly({ practiceId, children }: { practiceId: string; children: React.ReactNode }) {
  return (
    <>
      {/*
        A STRIP ACROSS THE TOP, above the console's own header, because that is
        what a mode banner is: a statement about the whole window rather than a
        notice inside one page. Sticky, so scrolling to a form further down does
        not scroll away the reason it is disabled.
      */}
      <div className={styles.strip} role="status" data-testid="view-only">
        <Eye size={15} aria-hidden="true" />
        <span>
          <strong>{strings.viewOnly.title}</strong> {strings.viewOnly.body}
        </span>
        <Link href="/practice" className={styles.stripLink}>
          {strings.viewOnly.toList}
        </Link>
        <Link href={`/platform/practices/${practiceId}`} className={styles.stripLink}>
          {strings.viewOnly.toHub}
        </Link>
      </div>

      {/*
        `disabled` does the work. The class only removes the border and margin a
        fieldset brings with it, so the page below looks like itself.
      */}
      <fieldset className={styles.region} disabled>
        {children}
      </fieldset>
    </>
  );
}

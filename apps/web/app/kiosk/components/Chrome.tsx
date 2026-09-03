'use client';

/**
 * The chrome every kiosk screen wears, and the blueprint treatment the design
 * handoff's hi-fi frames are built from: a 1px divider border, square corners,
 * and four `+` registration marks.
 *
 * IT IS NOT `Shell`, DELIBERATELY. The console's shell carries a main menu, a
 * back link and a refresh button; none of them belongs on a tablet a patient is
 * holding in a waiting room. A back control on a ceremony screen is an
 * invitation to re-answer a step that has already been recorded, and a menu is
 * a door into the console.
 *
 * WIDTH DECIDES THE COLUMNS, ORIENTATION DECIDES NOTHING ON ITS OWN — and that
 * lesson is carried over from the Expo build, where branching on orientation
 * alone gave a 670px-wide "landscape" window a two-column layout with a form
 * squeezed to ~330px. The breakpoint lives in `kiosk.module.css` as a media
 * query rather than in JavaScript, so the layout is right on first paint
 * instead of after a measurement.
 *
 * PORTRAIT STACKS, IT DOES NOT REDUCE. The same field set appears at every
 * width; only the column count changes. A turned tablet must not be a different
 * consent form.
 */

import type { ReactNode } from 'react';
import { strings } from '../strings';
import { kioskBuildId } from '../session';
import styles from '../kiosk.module.css';

export function Registration(): ReactNode {
  return (
    <>
      <span className={`${styles.corner} ${styles.cornerTl}`} aria-hidden="true" />
      <span className={`${styles.corner} ${styles.cornerTr}`} aria-hidden="true" />
      <span className={`${styles.corner} ${styles.cornerBl}`} aria-hidden="true" />
      <span className={`${styles.corner} ${styles.cornerBr}`} aria-hidden="true" />
    </>
  );
}

export function Blueprint({
  children,
  className,
  accented = false,
  testId,
}: {
  children: ReactNode;
  className?: string;
  accented?: boolean;
  testId?: string;
}): ReactNode {
  return (
    <div
      className={`${styles.blueprint} ${accented ? styles.blueprintAccented : ''} ${className ?? ''}`}
      data-testid={testId}
    >
      <Registration />
      {children}
    </div>
  );
}

export function Tag({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }): ReactNode {
  return <span className={`${styles.tag} ${tone === 'accent' ? styles.tagAccent : ''}`}>{label}</span>;
}

export function Kicker({ label }: { label: string }): ReactNode {
  return <span className={styles.kicker}>{label}</span>;
}

/**
 * Header, content and footer. `stepTag` is the "Step 2 of 4" chip; `context`
 * is the one line of footer context the handoff puts bottom-right.
 */
export function Screen({
  practiceName,
  locationLine,
  stepTag,
  context,
  onLeave,
  children,
}: {
  practiceName: string;
  locationLine?: string | null;
  stepTag?: string;
  context?: string;
  /**
   * THE WAY OUT (Carl, 3 Sep 2026; REQ-REC-04, hard rule 8).
   *
   * Every screen of the ceremony passes this, and the control it draws sits in
   * the header — a SIBLING of the scrolling content, never inside it, so no
   * amount of content can push it off screen or behind a scroller.
   *
   * IT IS AN EXIT, NOT A SKIP. The handler behind it changes local screen state
   * and nothing else: it calls no endpoint, advances no agreement, completes no
   * capture request and bypasses neither verification nor signing. A patient
   * who walks away leaves the record exactly as they found it. If a walk-away
   * is ever worth recording it belongs in the vault as an ordinary event —
   * never as a decline or a refusal, which are different things with different
   * consequences for the practice.
   *
   * AND IT DOES NOT COMPETE. 44px, quiet, outline only, beside the step tag —
   * the ceremony's own actions are 56 and 72px and filled. It is the calm
   * option, not a second call to action.
   */
  onLeave?: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.practiceName}>{practiceName}</p>
          {locationLine ? <p className={styles.locationLine}>{locationLine}</p> : null}
        </div>
        <div className={styles.headerActions}>
          {onLeave ? (
            <button
              type="button"
              className={styles.leave}
              aria-label={strings.chrome.leaveAction}
              data-testid="leave-for-reception"
              onClick={onLeave}
            >
              {strings.chrome.leaveAction}
            </button>
          ) : null}
          {stepTag ? <Tag label={stepTag} tone="accent" /> : null}
        </div>
      </header>
      <main className={styles.content}>{children}</main>
      <footer className={styles.footer}>
        <div>
          <p className={styles.platformMark}>{strings.appName}</p>
          {/*
            THE VERSION BANNER SUPPORT CAN READ (TODO.md "Zero-footprint
            kiosk"). It is on a patient-facing screen for one reason: when a
            practice rings up, the first question is which build that tablet is
            running, and the alternative is talking somebody through a browser
            menu on a device in a waiting room. Quiet enough that nobody else
            notices it; the forced reload is the half that acts on it.
          */}
          <p className={styles.buildMark} data-testid="kiosk-build">
            {strings.build(kioskBuildId())}
          </p>
        </div>
        {context ? <p className={styles.footerContext}>{context}</p> : null}
      </footer>
    </div>
  );
}

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

import { useEffect, useState, type ReactNode } from 'react';
import { strings } from '../strings';
import { kioskBuildId } from '../session';
import { readPairingCredential } from '../pairing';
import { fetchKioskMe } from '../api';
import styles from '../kiosk.module.css';

/**
 * WHICH TABLET IS THIS — asked of the server, never remembered (Carl, 4 Sep
 * 2026, "which tablet am I?"). `GET /kiosk/me` already carries `deviceLabel`
 * and `deviceId`; nothing before this asked for them, so a support call had
 * to talk somebody through a browser menu to find out which physical tablet
 * they were holding.
 *
 * IN MEMORY ONLY, and that is not a detail — it is CLAUDE.md §7. The zero-
 * footprint lint rule bans every storage surface under `app/kiosk/**`, and
 * this hook writes to none of them: `useState` here is a React render, not a
 * write to disk, and the identity is asked for again on every reload exactly
 * like the practice name already is (`Ceremony.tsx`'s own `GET /kiosk/me`
 * call). No credential, no request: an unpaired tablet has nothing to ask
 * with, so this stays silent on the pairing and unpaired screens rather than
 * adding a 401 to a log nobody benefits from reading.
 *
 * A FAILURE HERE IS COSMETIC, on the same reasoning `loadIdentity` in
 * `Ceremony.tsx` already applies to the practice name: the footer simply says
 * nothing rather than the ceremony refusing to render (REQ-REC-04, hard rule
 * 8 — nothing here may block care).
 */
function useDeviceIdentity(): { label: string; idPrefix: string } | null {
  const [identity, setIdentity] = useState<{ label: string; idPrefix: string } | null>(null);

  useEffect(() => {
    if (!readPairingCredential()) return;
    let cancelled = false;
    fetchKioskMe()
      .then((me) => {
        if (cancelled) return;
        setIdentity({ label: me.deviceLabel, idPrefix: me.deviceId.slice(0, 8) });
      })
      .catch(() => {
        /* Cosmetic only — see the comment above. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return identity;
}

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
  sessionId,
  patientId,
  onLeave,
  children,
}: {
  practiceName: string;
  locationLine?: string | null;
  stepTag?: string;
  context?: string;
  /**
   * THE PUSHED SESSION'S OWN ID, AN AUDIT/TESTING AID — passed only on the
   * screens a pushed ceremony can show (K-P1, K-3, K-4, done), and only while
   * `Ceremony.tsx` holds a live session. Reception sees the same id on the
   * console row that pushed it, so a support call or a test run can match
   * what is on the tablet to what reception is looking at. An opaque id, not
   * a name or a value — never withheld for that reason, unlike everything
   * else this footer stays quiet about.
   */
  sessionId?: string | null;
  /**
   * WHICH PATIENT RECORD THIS SESSION IS ABOUT (Carl, 7 Sep 2026) — "every page
   * must have the patient GUID from AoBPlatform somewhere, so we can see which
   * record has the issue. Also helps with testing."
   *
   * PUSHED SESSIONS ONLY, and that is a rule rather than an accident of
   * plumbing: before verification a walk-up tablet knows nothing about any
   * person and there is no record to name, so the walk-up screens pass nothing
   * and the line is not drawn. Named test:
   * `kiosk_footer_shows_the_patient_id_during_a_pushed_session_only`.
   *
   * IN FULL, UNLIKE THE SESSION ID ABOVE IT. Eight characters are for matching
   * by eye across a desk; this is for matching a record EXACTLY, which is what
   * a support ticket and a test run both do with it.
   *
   * AN OPAQUE ID IS NOT A DISCLOSURE. It is a value this platform minted, it
   * names the same row the vault events name, and it is not a Medicare number —
   * there is no column for one anywhere in this system and it would not be an
   * identity identifier if there were (hard rule 1, REQ-VER-02).
   */
  patientId?: string | null;
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
  const identity = useDeviceIdentity();
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
          {/*
            WHICH TABLET THIS IS (Carl, 4 Sep 2026). Same treatment as the
            build mark right above it — quiet, muted, and answering the second
            question a support call asks straight after the first.
          */}
          {identity ? (
            <p className={styles.buildMark} data-testid="kiosk-device-identity">
              {strings.chrome.deviceIdentity(identity.label, identity.idPrefix)}
            </p>
          ) : null}
          {/*
            THE SESSION'S OWN LINE — separate from the device identity above
            rather than appended to it, so it still appears if the device
            identity fetch has failed (cosmetic-only, see `useDeviceIdentity`)
            and disappears the instant `sessionId` does, independent of that
            fetch's own timing.
          */}
          {sessionId ? (
            <p className={styles.buildMark} data-testid="kiosk-session-identity">
              {strings.chrome.sessionIdentity(sessionId.slice(0, 8))}
            </p>
          ) : null}
          {/*
            AND WHICH RECORD IT IS ABOUT — its own line, after the session's,
            for the reason the session's is its own line: each fact appears and
            disappears on its own, independent of whether the one above it
            resolved. Monospace, `text-transform: none`, selectable, and never
            shortened (`.recordMark`).
          */}
          {patientId ? (
            <p className={`${styles.buildMark} ${styles.recordMark}`} data-testid="kiosk-patient-identity">
              {strings.chrome.patientIdentity(patientId)}
            </p>
          ) : null}
        </div>
        {context ? <p className={styles.footerContext}>{context}</p> : null}
      </footer>
    </div>
  );
}

'use client';

/**
 * THE PATIENT'S OWN PAGE — C8, one route, ten cards (REQ-PORT-01..08). The
 * tenth is "Sign-in and security", added with FR-8.2's passkey half on
 * 4 September 2026.
 *
 * INDEPENDENT READS, NOT ONE. Each card fetches its own endpoint and holds
 * its own loading, error and empty state, so a failing agreements service does
 * not blank the page a patient opened to check whether a text message was
 * genuine. A single page-level load would have made every card as reliable as
 * the least reliable one, and this page's whole value is that it can be trusted
 * when something is going wrong.
 *
 * THE SIGNED-OUT STATE IS THE ORDINARY ONE. Portal access is never a
 * precondition of signing (REQ-PORT-08), so most patients have no account and
 * the screen says so plainly rather than treating a 401 as a failure. It also
 * says the thing a worried person most needs to hear: you never have to sign in
 * to sign an agreement.
 *
 * NOTHING IS PERSISTED IN THE BROWSER. No storage API is touched here, and no
 * payload is logged — every one of these responses carries a date of birth, an
 * address, or both. The session is the server's httpOnly cookie and nothing
 * this code can read.
 *
 * HEADINGS RUN IN ORDER. `Shell` renders the `h1`; every card is an `h2` and
 * every group inside one an `h3`, so the page is navigable by heading, which is
 * how a screen-reader user reads a page of nine sections.
 */

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '../../ui';
import { strings } from '../../strings';
import { useRefreshable } from '../../refresh';
import {
  fetchAccessLog,
  fetchAgreements,
  fetchAssignors,
  fetchDetails,
  fetchEnduring,
  fetchMessages,
  fetchNotices,
  fetchPasskeys,
  fetchSession,
  fetchVisits,
  isSignedOut,
  openDevPortalSession,
  passkeysAvailable,
  registerPasskey,
  requestDetailCorrection,
  revokeAssignor,
  revokePasskey,
  signInWithPasskey,
  terminateEnduring,
  type PortalAccessEntry,
  type PortalAgreement,
  type PortalAssignors,
  type PortalDetails,
  type PortalEnduring,
  type PortalMessage,
  type PortalNotice,
  type PortalPasskey,
  type PortalVisit,
} from './api';
import type { Loadable } from './portal-ui';
import { AgreementsCard } from './cards/AgreementsCard';
import { ComingLaterCard } from './cards/ComingLaterCard';
import { DataCard } from './cards/DataCard';
import { DetailsCard } from './cards/DetailsCard';
import { EnduringCard } from './cards/EnduringCard';
import { MessagesCard } from './cards/MessagesCard';
import { NoticesCard } from './cards/NoticesCard';
import { PasskeysCard } from './cards/PasskeysCard';
import { PeopleCard } from './cards/PeopleCard';
import { VisitsCard } from './cards/VisitsCard';
import { PortalButton } from './portal-ui';
import styles from './portal.module.css';

/**
 * The development escape hatch, OFF unless the build was made with the flag —
 * the same guard the console's own bypass uses (`AuthGate`). A build without it
 * has no control here at all, which is the only safe default for a seam that
 * mints a session.
 */
const DEV_SEAM_ALLOWED = process.env.NEXT_PUBLIC_DEV_UNAUTHENTICATED_CONSOLE === 'true';

const LOADING = { status: 'loading' } as const;

type Cards = {
  details: Loadable<readonly PortalDetails[]>;
  agreements: Loadable<readonly PortalAgreement[]>;
  enduring: Loadable<readonly PortalEnduring[]>;
  notices: Loadable<readonly PortalNotice[]>;
  visits: Loadable<readonly PortalVisit[]>;
  messages: Loadable<readonly PortalMessage[]>;
  people: Loadable<PortalAssignors>;
  access: Loadable<readonly PortalAccessEntry[]>;
  passkeys: Loadable<readonly PortalPasskey[]>;
};

const ALL_LOADING: Cards = {
  details: LOADING,
  agreements: LOADING,
  enduring: LOADING,
  notices: LOADING,
  visits: LOADING,
  messages: LOADING,
  people: LOADING,
  access: LOADING,
  passkeys: LOADING,
};

export function PortalView() {
  const [session, setSession] = useState<'checking' | 'in' | 'out' | 'unreachable'>('checking');
  const [cards, setCards] = useState<Cards>(ALL_LOADING);

  /**
   * ONE CARD'S READ. Resolved into `ready`, or into `error` and nothing else —
   * the server's sentence is never carried into a patient-facing surface, and
   * it is never logged either.
   */
  const load = useCallback(
    async <K extends keyof Cards>(key: K, read: () => Promise<Cards[K] extends Loadable<infer T> ? T : never>) => {
      setCards((prev) => ({ ...prev, [key]: LOADING }));
      try {
        const data = await read();
        setCards((prev) => ({ ...prev, [key]: { status: 'ready', data } as Cards[K] }));
      } catch {
        setCards((prev) => ({ ...prev, [key]: { status: 'error' } as Cards[K] }));
      }
    },
    [],
  );

  const loadAll = useCallback(() => {
    void load('details', fetchDetails);
    void load('agreements', fetchAgreements);
    void load('enduring', fetchEnduring);
    void load('notices', fetchNotices);
    void load('visits', fetchVisits);
    void load('messages', fetchMessages);
    void load('people', fetchAssignors);
    void load('access', fetchAccessLog);
    void load('passkeys', fetchPasskeys);
  }, [load]);

  const checkSession = useCallback(async () => {
    try {
      await fetchSession();
      setSession('in');
      loadAll();
    } catch (err) {
      // A 401 is a STATE. Anything else is the server being unreachable, which
      // is a different sentence — and neither ever blocks care (hard rule 8).
      setSession(isSignedOut(err) ? 'out' : 'unreachable');
    }
  }, [loadAll]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // "Ask the server again" without an F5 — see `refresh.ts`.
  useRefreshable(checkSession);

  if (session === 'checking') {
    return (
      <Shell title={strings.portal.title}>
        <p role="status">{strings.portal.loading}</p>
      </Shell>
    );
  }

  if (session !== 'in') {
    return <SignedOut unreachable={session === 'unreachable'} onSignedIn={checkSession} />;
  }

  return (
    <Shell title={strings.portal.title} lead={strings.portal.lead}>
      <div className={styles.page}>
        <DetailsCard state={cards.details} onRequestCorrection={requestDetailCorrection} />
        <AgreementsCard state={cards.agreements} />
        <EnduringCard state={cards.enduring} onTerminate={terminateEnduring} />
        <NoticesCard state={cards.notices} />
        <VisitsCard state={cards.visits} />
        <MessagesCard state={cards.messages} />
        <PeopleCard state={cards.people} onRevoke={revokeAssignor} />
        <DataCard state={cards.access} />
        <PasskeysCard
          state={cards.passkeys}
          supported={passkeysAvailable()}
          onAdd={async (label) => {
            await registerPasskey(label);
            await load('passkeys', fetchPasskeys);
          }}
          onRemove={async (passkeyId) => {
            await revokePasskey(passkeyId);
            await load('passkeys', fetchPasskeys);
          }}
        />
        <ComingLaterCard />
      </div>
    </Shell>
  );
}

/**
 * NOT SIGNED IN — and the sentence that matters is the third one.
 *
 * Somebody arriving here having been sent a link, or having heard that they
 * "need an account", must be told immediately that they do not: signing an
 * agreement never requires this page (REQ-PORT-08). Saying it here, on the
 * screen that could imply otherwise, is the only place it does any work.
 *
 * THERE IS NOW A SIGN-IN BUTTON, and only where it can work. FR-8.2's passkey
 * half landed on 4 September 2026, so a patient who added one can get back in
 * from here with their face, fingerprint or PIN — no username, nothing typed.
 * It renders only when the browser can actually do WebAuthn: a control that
 * explains itself after being pressed is worse than none on a page somebody
 * opened because they were worried.
 *
 * THE REQ-PORT-08 SENTENCE STAYS ABOVE IT, and that ordering is deliberate.
 * Adding a way IN must not turn this into a screen that implies a way in is
 * needed. Signing an agreement has never required this page, and the sentence
 * that says so is read first.
 */
function SignedOut({ unreachable, onSignedIn }: { unreachable: boolean; onSignedIn: () => void }) {
  const [failed, setFailed] = useState(false);
  const [patientIds, setPatientIds] = useState<readonly string[]>([]);
  const [practiceIds, setPracticeIds] = useState<readonly string[]>([]);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyFailed, setPasskeyFailed] = useState(false);

  /*
   * READ ONCE, AFTER MOUNT. `passkeysAvailable()` touches `window`, and calling
   * it during render would make this component disagree with itself between the
   * server pass and the client one.
   */
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => setCanPasskey(passkeysAvailable()), []);

  const signIn = async () => {
    setPasskeyFailed(false);
    setPasskeyBusy(true);
    try {
      await signInWithPasskey();
      onSignedIn();
    } catch {
      // Never the server's sentence, and never logged. A cancelled prompt and a
      // refused assertion are the same thing to the person holding the phone.
      setPasskeyFailed(true);
    } finally {
      setPasskeyBusy(false);
    }
  };

  useEffect(() => {
    if (!DEV_SEAM_ALLOWED) return;
    // Read from the address bar rather than `useSearchParams`, which would put
    // this whole page behind a Suspense boundary for one dev-only control.
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('patientIds') ?? '';
    setPatientIds(raw.split(',').map((id) => id.trim()).filter(Boolean));
    // WHICH PRACTICES TO LOOK IN: RLS is live in dev and the seam refuses to
    // guess (`?practiceIds=…`, comma-separated, alongside `patientIds`).
    const rawPractices = params.get('practiceIds') ?? '';
    setPracticeIds(rawPractices.split(',').map((id) => id.trim()).filter(Boolean));
  }, []);

  const openDev = async () => {
    setFailed(false);
    try {
      await openDevPortalSession(patientIds, practiceIds);
      onSignedIn();
    } catch {
      setFailed(true);
    }
  };

  return (
    <Shell title={strings.portal.signedOut.heading}>
      <div className={styles.signedOut}>
        <p>{unreachable ? strings.portal.signedOut.unreachable : strings.portal.signedOut.body}</p>
        <p>
          <strong>{strings.portal.signedOut.neverNeeded}</strong>
        </p>

        {canPasskey && (
          <div className={styles.signInWithPasskey}>
            <PortalButton variant="primary" onClick={signIn} disabled={passkeyBusy}>
              {passkeyBusy ? strings.portal.passkeys.signInBusy : strings.portal.passkeys.signInAction}
            </PortalButton>
            {passkeyFailed && (
              <p className={styles.cardError} role="alert">
                {strings.portal.passkeys.signInFailed}
              </p>
            )}
          </div>
        )}

        {DEV_SEAM_ALLOWED && (
          <div className={styles.devSeam}>
            <p className={styles.devSeamHeading}>{strings.portal.signedOut.devHeading}</p>
            <p>{strings.portal.signedOut.devHint}</p>
            <PortalButton onClick={openDev} disabled={patientIds.length === 0}>
              {strings.portal.signedOut.devAction}
            </PortalButton>
            {failed && (
              <p className={styles.cardError} role="alert">
                {strings.portal.signedOut.devFailed}
              </p>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

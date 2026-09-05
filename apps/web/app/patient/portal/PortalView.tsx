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
import { LogIn, LogOut } from 'lucide-react';
import { portalRecordId } from '@aobplatform/contracts';
import { Shell, ui } from '../../ui';
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
  signOut,
  terminateEnduring,
  type PortalAccessEntry,
  type PortalAgreement,
  type PortalAssignors,
  type PortalDetails,
  type PortalEnduring,
  type PortalLink,
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
import { PracticeFilter } from './cards/PracticeFilter';
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

/**
 * NARROWING ONE CARD'S ROWS. Loading, failed and empty pass straight through —
 * a filter must never turn a failure into an empty list, because "we could not
 * load this" and "there is nothing here" are different answers and a patient
 * checking whether something exists needs to be told which one they got.
 */
function narrow<T>(state: Loadable<readonly T[]>, keep: (row: T) => boolean): Loadable<readonly T[]> {
  if (state.status !== 'ready') return state;
  return { status: 'ready', data: state.data.filter(keep) };
}

export function PortalView() {
  const [session, setSession] = useState<'checking' | 'in' | 'out' | 'unreachable'>('checking');
  // THE PORTAL ACCOUNT'S OWN ID, shown in the session bar beside Sign out so
  // the page can be checked against a message that quoted it (Carl, 4 Sep 2026).
  const [accountId, setAccountId] = useState<string | null>(null);
  const [cards, setCards] = useState<Cards>(ALL_LOADING);
  /**
   * THE PRACTICES THIS ACCOUNT IS LINKED TO, and which one the page is showing
   * (Carl, 5 Sep 2026). `null` is all of them, and it is the default: the page
   * answers "what does anybody hold about me" before it answers "what does this
   * one hold".
   *
   * COMPONENT STATE, NOT STORAGE. The choice dies with the tab. Nothing on this
   * page is written to the browser and a remembered filter would be the first
   * thing that was — and the first way a shared phone could show one person's
   * page in another person's shape.
   */
  const [links, setLinks] = useState<readonly PortalLink[]>([]);
  const [practiceId, setPracticeId] = useState<string | null>(null);
  /**
   * ONE LINE, ONCE, AFTER AN ACTIVATION (Carl, 5 Sep 2026).
   *
   * The activation page lands here with `?welcome=1`. The line points at the
   * passkey card, which is the next thing worth doing and the only thing that
   * stops the next visit needing another invitation from the practice.
   *
   * STATE, NOT STORAGE. Nothing is written to the browser — the parameter is
   * read once and then removed from the address bar with `replaceState`, so a
   * reload or a shared link does not re-announce it. This page persists nothing
   * and this line is not the exception.
   */
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('welcome') !== '1') return;
    setWelcome(true);
    url.searchParams.delete('welcome');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

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
      const current = await fetchSession();
      setAccountId(current.accountId);
      setLinks(current.links);
      // A CHOSEN PRACTICE THAT IS NO LONGER LINKED falls back to all of them,
      // rather than leaving the page showing an empty version of itself.
      setPracticeId((chosen) =>
        chosen && current.links.some((link) => link.practiceId === chosen) ? chosen : null,
      );
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

  /**
   * WHAT THE PAGE IS SHOWING — every card narrowed to the chosen practice, or
   * all of them (Carl, 5 Sep 2026).
   *
   * BY NAME FOR EIGHT OF THE NINE, BY ID FOR DETAILS. Only `PortalDetails`
   * carries a practice id on the wire; the rest carry the name the card
   * displays, which is also what the patient is choosing between. Matching on
   * the name the server itself sent for the link keeps the two sides of the
   * comparison from being two different strings — and two practices sharing a
   * display name would be a problem this page could not paper over anyway.
   *
   * PASSKEYS ARE NOT NARROWED. A passkey belongs to the account, not to a
   * practice: hiding somebody's only credential because they were looking at
   * one practice would be hiding the one thing that gets them back in.
   *
   * NEITHER IS "PEOPLE WHO ACT FOR ME". The authority is held against the
   * patient, and the payload has no practice on it — filtering by a field that
   * is not there would quietly empty the list. "People I act for" does carry a
   * practice, and is narrowed.
   */
  const chosen = practiceId ? links.find((link) => link.practiceId === practiceId) : undefined;
  const shown: Cards = !chosen
    ? cards
    : {
        details: narrow(cards.details, (row) => row.practiceId === chosen.practiceId),
        agreements: narrow(cards.agreements, (row) => row.practiceName === chosen.practiceName),
        enduring: narrow(cards.enduring, (row) => row.practiceName === chosen.practiceName),
        notices: narrow(cards.notices, (row) => row.practiceName === chosen.practiceName),
        visits: narrow(cards.visits, (row) => row.practiceName === chosen.practiceName),
        messages: narrow(cards.messages, (row) => row.practiceName === chosen.practiceName),
        people:
          cards.people.status !== 'ready'
            ? cards.people
            : {
                status: 'ready',
                data: {
                  actsForMe: cards.people.data.actsForMe,
                  iActFor: cards.people.data.iActFor.filter(
                    (row) => row.practiceName === chosen.practiceName,
                  ),
                },
              },
        access: narrow(cards.access, (row) => row.practiceName === chosen.practiceName),
        passkeys: cards.passkeys,
      };

  // THE PERSON'S NAME IN THE HEADER, from the first shown practice's record once
  // the details card has loaded; the generic title until then, and if it failed.
  const first = shown.details.status === 'ready' ? shown.details.data[0] : undefined;
  const displayName = first ? `${first.givenNames} ${first.familyName}`.trim() : '';

  return (
    <Shell
      title={displayName ? strings.portal.titleFor(displayName) : strings.portal.title}
      lead={strings.portal.lead}
      right={
        // THE SESSION BAR, IN THE CONSOLE'S OWN STYLE: audience, the account's
        // record id in full, and Sign out. Sign out is a server-side revoke;
        // the page then re-asks the server and shows the signed-out screen (a
        // failed revoke still re-checks, so a dead cookie shows as signed out
        // rather than as a stale page).
        <span className={ui.sessionBar}>
          <span className={ui.sessionAudience}>{strings.portal.session.audience}</span>
          {accountId && (
            <span className={ui.sessionIdentity} data-testid="portal-record-id">
              <span className={styles.recordId}>{strings.portal.session.recordId(portalRecordId(accountId))}</span>
            </span>
          )}
          <button
            type="button"
            className={ui.sessionButton}
            data-testid="portal-sign-out"
            onClick={async () => {
              try {
                await signOut();
              } finally {
                checkSession();
              }
            }}
          >
            <LogOut size={13} aria-hidden="true" />
            {strings.portal.signOut}
          </button>
        </span>
      }
    >
      <div className={styles.page}>
        {/*
          UNDER THE LEAD, ABOVE EVERYTHING ELSE, and only where the account has
          more than one practice — `PracticeFilter` renders nothing otherwise.
        */}
        <PracticeFilter links={links} selected={practiceId} onSelect={setPracticeId} />
        {welcome && (
          <div className={styles.welcome} data-testid="portal-welcome">
            {/*
              `role="status"` rather than `alert`: this is good news arriving,
              not a problem, and it should be announced without interrupting
              whatever a screen reader is already saying.
            */}
            <p className={styles.welcomeText} role="status">
              {strings.portal.welcome}
            </p>
            <PortalButton variant="quiet" onClick={() => setWelcome(false)}>
              {strings.portal.welcomeDismiss}
            </PortalButton>
          </div>
        )}
        <DetailsCard state={shown.details} onRequestCorrection={requestDetailCorrection} />
        <AgreementsCard state={shown.agreements} />
        <EnduringCard state={shown.enduring} onTerminate={terminateEnduring} />
        <NoticesCard state={shown.notices} />
        <VisitsCard state={shown.visits} />
        <MessagesCard state={shown.messages} recordId={accountId ? portalRecordId(accountId) : null} />
        <PeopleCard state={shown.people} onRevoke={revokeAssignor} />
        <DataCard state={shown.access} />
        <PasskeysCard
          state={shown.passkeys}
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
    <Shell
      title={strings.portal.signedOut.heading}
      right={
        // THE SAME SESSION BAR AS THE CONSOLE'S, so the sign-in looks like
        // every other AoBPlatform sign-in (Carl, 4 Sep 2026). Only where the
        // browser can do WebAuthn — a button that explains itself after being
        // pressed is worse than none on a page somebody opened because they
        // were worried.
        canPasskey ? (
          <span className={ui.sessionBar}>
            <span className={ui.sessionAudience}>{strings.portal.session.audience}</span>
            <button
              type="button"
              className={ui.sessionButton}
              onClick={signIn}
              disabled={passkeyBusy}
              data-testid="portal-sign-in"
            >
              <LogIn size={13} aria-hidden="true" />
              {passkeyBusy ? strings.portal.passkeys.signInBusy : strings.portal.passkeys.signInAction}
            </button>
          </span>
        ) : undefined
      }
    >
      <div className={styles.signedOut}>
        <p>{unreachable ? strings.portal.signedOut.unreachable : strings.portal.signedOut.body}</p>
        <p>
          <strong>{strings.portal.signedOut.neverNeeded}</strong>
        </p>

        {passkeyFailed && (
          <p className={styles.cardError} role="alert">
            {strings.portal.passkeys.signInFailed}
          </p>
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

'use client';

/**
 * The ceremony: verify → (who is signing) → locked particulars → sign → done.
 * `episodic_pre` only, in practice only, and nothing else — no enduring (that
 * is build-plan item 10), no offline queue (withdrawn with the zero-footprint
 * decision), no portal activation.
 *
 * THE LIST IS GONE FROM THE FRONT OF IT (Carl, 4 Sep 2026): "Remove the 'x
 * people ready to sign' text — this is a security feature. Then on the next
 * page do not show the list. Go straight to 'Confirm your details', match
 * these details to the list on AoBPlatform and then go to the next page. The
 * list page is only for testing purposes."
 *
 * So Begin opens K-2, the patient types the three details they were going to
 * type anyway, and `POST /kiosk/claim` finds the ONE waiting row of this
 * practice that matches all of them — verifying in the same call. A bystander
 * sees no names and no count. The list survives only on a device the CONSOLE
 * has flagged as a test device, under a permanent banner.
 *
 * AND K-5 IS SKIPPED ON A LOCKED AGREEMENT (Carl, 4 Sep 2026). Who signs is
 * one of the locked particulars, so on a locked agreement there is nothing to
 * choose — verification goes straight to K-3, which states who signs and adds
 * a line saying it was set at reception. The screen that used to render an
 * explanation box in the second option's slot is not shown at all.
 *
 * THE SUB-STEPS ARE COMPONENT STATE, NOT ROUTES, and that is a requirement
 * rather than a preference. One `/kiosk` URL, one history entry: there is no
 * back button on this device that could walk the next patient into the
 * previous one's verification screen, and no address a browser could restore
 * after a reload (C2 — no residual patient data).
 *
 * ORDER IS THE PRODUCT HERE. Every step below happens against an endpoint that
 * already existed; what this file contributes is the sequence and the refusal
 * to skip a step:
 *
 *   1. `GET /kiosk/waiting-list` — polled at the SERVER's cadence, with an
 *      ETag, so a quiet morning costs 304s. On an ordinary tablet it answers
 *      `hidden: true` with no rows and no count: what still rides on it is the
 *      forced reload and the tablet's own health signal.
 *   2. `POST /kiosk/claim` — the walk-up door: three stated details in, one
 *      matched row out, verified in the same step. (On a TEST device the old
 *      pair still runs: `POST /verification/challenges` then `/attempt`,
 *      against the row somebody tapped.) The identifier TYPES come from
 *      `/kiosk/me`; the values are sent once and dropped.
 *   3. `POST /agreements/:id/transition` to `awaiting_signature`.
 *   4. `POST /agreements/:id/assignor` when somebody other than the patient is
 *      signing. NEW since the Expo build, and it is what turns that build's
 *      hand-over into a continuation.
 *   5. `POST /agreements/:id/particulars` — the server assembles, validates,
 *      renders and hashes. Only then can the signature control enable.
 *   6. `POST /agreements/:id/sign`, then `POST /capture/:id/complete`.
 *
 * IT BEGINS BEFORE THE CEREMONY, AT PAIRING. `/kiosk` is a public URL, and
 * its practice scope used to come from a build-time environment variable — so
 * anybody who reached the address saw a practice's waiting list. A tablet now
 * holds one opaque credential, the server resolves the practice from it, and
 * this component will not show a name to anybody until it has one. No
 * credential means the pairing screen; a credential the server refuses means
 * the unpaired screen, and no retry.
 *
 * NOTHING PERSISTS ON THE DEVICE BUT THAT CREDENTIAL. No token, no identifier
 * value, no patient record, no practice name: every piece of ceremony state
 * lives in this component and is dropped on reset. There is no
 * `localStorage`, `sessionStorage`, `indexedDB`, cookie or service worker
 * anywhere under `app/kiosk/**` except the single sanctioned read/write in
 * `pairing.ts`, and the root ESLint config fails the build if one appears
 * elsewhere (CLAUDE.md §7).
 *
 * EVERY FAILURE ROUTES TO THE DESK, never to a dead end (REQ-REC-04).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS,
  kioskIdleTimeoutOrDefault,
  type AgreementType,
} from '@aobplatform/domain';
import {
  attemptChallenge,
  changeAssignor,
  claimWaitingRow,
  completeCapture,
  confirmSessionDetails,
  fetchAgreement,
  fetchKioskMe,
  fetchPracticeStaffNames,
  isUnpaired,
  KioskApiError,
  pairDevice,
  lockParticulars,
  setTabletSessionState,
  signAgreement,
  startChallenge,
  transitionAgreement,
  type AgreementResponse,
  type KioskWaitingRow,
  type TabletSessionPayload,
} from './api';
import { useWaitingList } from './useWaitingList';
import { useTabletSession } from './useTabletSession';
import { useInactivityReset } from './useInactivityReset';
import { useOutageState } from './useOutageState';
import { clearPairingCredential, readPairingCredential, writePairingCredential } from './pairing';
import { challengeIsComplete, identifierFieldsFor, type IdentifierField } from './rules/identifiers';
import { composeSignRequest } from './rules/signature-payload';
import { trimStatedValues } from './rules/verify-fields';
import {
  assignorRequestFrom,
  decideAssignor,
  evaluateAssignorGate,
  EMPTY_CHOICE,
  type AssignorChoice,
  type AssignorGate,
} from './rules/assignor';
import { evaluateSignatureGate, type SignatureValidation } from './rules/signature-gate';
import { afterAttempt, firstAttempt, retryAfterMismatch, type VerificationState } from './rules/verification';
import {
  allAnswered,
  answerSignature,
  answeredTypes,
  anyDisputed,
  detailRowsFor,
  type DetailAnswer,
  type DetailAnswers,
} from './rules/pushed-details';
import { IdleScreen } from './screens/IdleScreen';
import { CheckDetailsScreen } from './screens/CheckDetailsScreen';
import { VerifyScreen } from './screens/VerifyScreen';
import { AssignorScreen } from './screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { SignatureScreen } from './screens/SignatureScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import { PairingScreen, type PairedOutcome, type PairingFailure } from './screens/PairingScreen';
import { UnpairedScreen } from './screens/UnpairedScreen';
import { OutageScreen } from './screens/OutageScreen';
import type { SignaturePadHandle } from './components/SignaturePad';
import { InactivityWarning } from './components/InactivityWarning';
import { strings } from './strings';

/**
 * `booting` IS A REAL STATE, not a loading spinner nobody thought about. On
 * the very first paint the tablet does not yet know whether it is paired, and
 * the two wrong answers are both visible: flashing the pairing screen at a
 * paired tablet every morning teaches staff that the pairing was lost, and
 * flashing the idle screen at an unpaired one shows a practice's chrome to a
 * device that has no practice.
 */
type Step =
  | 'booting'
  | 'pairing'
  | 'unpaired'
  | 'idle'
  | 'list'
  /**
   * K-P1, and the ONLY step the pushed ceremony adds. Everything after it —
   * K-3, K-4, done, hand-over — is the walk-up's own screens with the pushed
   * session's agreement in them, which is the point: one ceremony, two front
   * doors (TODO.md, Carl 4 Sep 2026).
   */
  | 'check-details'
  | 'verify'
  | 'assignor'
  | 'particulars'
  | 'signature'
  | 'complete'
  | 'handover';

export function Ceremony(): ReactNode {
  const [step, setStep] = useState<Step>('booting');
  const [practiceName, setPracticeName] = useState('');
  const [locationLine, setLocationLine] = useState<string | null>(null);
  /**
   * WHICH FRONT DOOR BEGIN OPENS, answered by `/kiosk/me` before the screen is
   * drawn. False — the walk-up flow — is the default and stays the default
   * through every failure: a tablet that could not read its own identity must
   * not fall back to showing patient names (Carl, 4 Sep 2026).
   */
  const [meShowsWaitingList, setMeShowsWaitingList] = useState(false);
  /**
   * HOW LONG THIS TABLET WAITS BEFORE IT RETURNS TO THE START (Carl, 4 Sep
   * 2026) — the PRACTICE'S number, read off `/kiosk/me` with everything else
   * the tablet asks about itself.
   *
   * The default stands until the server answers, and stands again if it never
   * does. An absent setting must never mean "no timeout": a tablet that does
   * not clear itself is the disclosure this feature exists to close.
   */
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS);
  /**
   * TYPES, NEVER VALUES (REQ-VER-04) — from `/kiosk/me`, because the waiting
   * list no longer answers on an ordinary tablet and K-2 is now the FIRST
   * screen a patient sees. The list's copy is the fallback for a test device
   * whose identity read failed.
   */
  const [identifierTypes, setIdentifierTypes] = useState<readonly string[]>([]);
  const [staffNames, setStaffNames] = useState<readonly string[]>([]);
  const [row, setRow] = useState<KioskWaitingRow | null>(null);
  const [agreement, setAgreement] = useState<AgreementResponse | null>(null);

  /**
   * THE PUSHED SESSION, IN MEMORY AND NOWHERE ELSE (CLAUDE.md §7).
   *
   * This is the only place on the device a patient's date of birth and address
   * exist, it is React state rather than storage, and `reset` drops it. A
   * tablet found in a taxi holds one revocable credential and nothing about
   * anybody.
   */
  const [pushed, setPushed] = useState<TabletSessionPayload | null>(null);
  /**
   * THE PATIENT'S ANSWER TO EACH ROW ON K-P1 — a tick or a cross, keyed by
   * TYPE. Never the values behind them (REQ-VER-04), and never a suggested
   * replacement: a cross says "that is wrong" and the screen has no field to
   * say what is right (Carl, 3 Sep 2026 — the tablet presents no field a
   * patient or a passer-by could fill on the practice's behalf).
   *
   * AN ABSENT KEY IS "NOT ANSWERED YET" and is what keeps Continue dead. That
   * is a different thing from a cross, which is the whole reason the screen
   * has two buttons rather than one toggle.
   */
  const [answers, setAnswers] = useState<DetailAnswers>({});
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  /**
   * WHAT WAS LAST SENT, so the same answers are never sent twice.
   *
   * A cross is posted the moment every row has an answer — reception must not
   * have to wait for the patient to press anything, and there is nothing left
   * for the patient to press. So the same set of answers can be arrived at
   * more than once: flip a cross to a tick and back, or come back from K-3
   * with Back. Re-posting would write a second identical event into the vault
   * for nothing.
   */
  const postedAnswersRef = useRef('');

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [fields, setFields] = useState<readonly IdentifierField[]>([]);
  const [stated, setStated] = useState<Record<string, string>>({});
  const [verification, setVerification] = useState<VerificationState>(firstAttempt());
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [startError, setStartError] = useState(false);
  /** The last attempt did not match. Shown INLINE on K-2; the form keeps its values. */
  const [mismatch, setMismatch] = useState(false);

  const [choice, setChoice] = useState<AssignorChoice>(EMPTY_CHOICE);
  const [assignorBusy, setAssignorBusy] = useState(false);
  const [assignorError, setAssignorError] = useState(false);

  const [lockBusy, setLockBusy] = useState(false);

  /**
   * THE SESSION THIS TABLET HAS FINISHED WITH — and why a ref is needed at all.
   *
   * `walked_away` is fire and forget, and the pushed-session poll keeps
   * answering with the session it last saw. So the instant the tablet returns
   * to idle — after the exit, after the inactivity reset, after the thank-you
   * screen's Done — the takeover effect below sees a live session on an idle
   * screen and puts the ceremony straight back up, with the details of somebody
   * who has left on it. Carl's timeout would have appeared not to work at all.
   *
   * So the id is remembered and skipped until the SERVER agrees it is gone: a
   * `{ session: null }`, or a different session, clears it. The tablet never
   * asserts the session has ended — it declines to re-enter one it has already
   * released, which is a different and much smaller claim.
   */
  const releasedSessionRef = useRef<string | null>(null);
  /** The live session's id, readable from callbacks that must not depend on it. */
  const pushedIdRef = useRef<string | null>(null);

  /** Which agreement the automatic lock has already been attempted for. */
  const autoLockedRef = useRef<string | null>(null);
  const padRef = useRef<SignaturePadHandle | null>(null);
  const [inkPresent, setInkPresent] = useState(false);
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const [handover, setHandover] = useState<{ heading: string; body: string }>({
    heading: strings.verify.lockedHeading,
    body: strings.errors.generic,
  });

  /*
   * PAIRING STATE, and every field of it is in memory. The code somebody types
   * is never stored; the credential it earns goes to `pairing.ts`, which is
   * the one module permitted to persist anything on this device.
   */
  const [pairingCode, setPairingCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingFailure, setPairingFailure] = useState<PairingFailure | null>(null);
  const [paired, setPaired] = useState<PairedOutcome | null>(null);

  /**
   * A FORCED RELOAD HAPPENS ONCE PER TAB, and the ref is the reason it is
   * safe.
   *
   * The server answers `reload: true` while this tab is below the practice's
   * build floor. If the reload does not actually change the build — a cached
   * bundle, a CDN that has not caught up, a floor set above anything that was
   * ever deployed — the next poll says `reload: true` again, and a tablet that
   * reloads every two seconds is unusable and is exactly the kind of device
   * somebody has to physically visit. So: one attempt, then leave the tablet
   * working on the build it has. A stale kiosk is a worse tablet; a looping
   * one is no tablet at all.
   */
  const reloadedRef = useRef(false);

  // The list is polled only while the tablet is between patients. Mid-ceremony
  // the screen is not showing it, and a poll that nobody can see is noise.
  const list = useWaitingList(step === 'idle' || step === 'list');

  /**
   * THE PUSHED-SESSION POLL, AND WHEN IT RUNS.
   *
   * A SECOND POLL RATHER THAN A FIELD ON THE FIRST, because the waiting list
   * does not carry a session and giving it one would be a change to
   * `apps/core`. It runs at the cadence the waiting list was told, so the
   * server still owns the number (see `useTabletSession`).
   *
   * BETWEEN PATIENTS, so a push can arrive — and THROUGHOUT the pushed
   * ceremony, so a RECALL can arrive. Those are the two things that must reach
   * a tablet nobody is touching and a tablet somebody is standing at
   * respectively. It stops on `complete` and `handover`: by then this tablet
   * ended the session itself, and a `{ session: null }` answering our own
   * signature must not yank the thank-you screen away.
   */
  const pushedCeremony = step === 'check-details' || (pushed !== null && (step === 'particulars' || step === 'signature'));
  const tabletSession = useTabletSession(
    step === 'idle' || step === 'list' || pushedCeremony,
    list.pollMs,
  );

  /**
   * IS THIS A TEST DEVICE — ANSWERED BY THE POLL, NOT BY START-UP (Carl, 4 Sep
   * 2026, watching the toggle live).
   *
   * `/kiosk/me` answers it once, at boot, which is what the very first render
   * has to go on. But the console toggle has to REACH a tablet already sitting
   * on its idle screen — Carl flips "Test device" on `/practice/devices` and
   * expects the next poll to change what Begin opens, with no re-pairing and
   * no reload. So the poll's own `hidden` wins as soon as there is one, and it
   * is inside the ETag, so a quiet morning cannot answer 304 and swallow it.
   *
   * FAIL CLOSED IN BOTH DIRECTIONS. `hidden === null` (no answer yet) falls
   * back to the start-up value; anything that is not an explicit "the server
   * sent rows" is a walk-up tablet, and a walk-up tablet shows nobody's name.
   */
  const testDevice = list.hidden === null ? meShowsWaitingList : list.hidden === false;

  /**
   * THE TOGGLE WAS TURNED OFF WHILE THE LIST WAS ON SCREEN.
   *
   * A tablet sitting on the list when a staff member revokes its test status
   * must not keep showing the names it already has. The poll answers `hidden`
   * within its cadence, the rows empty out on their own — and this drops the
   * screen back to idle so what is left is not a bannerless empty list that
   * looks like a broken morning.
   */
  useEffect(() => {
    if (step === 'list' && !testDevice) setStep('idle');
  }, [step, testDevice]);

  /**
   * WHO IS THIS TABLET — asked before anything else is shown.
   *
   * NO CREDENTIAL, NO REQUEST. An unpaired tablet does not call the server at
   * all: there is nothing to ask with, and a 401 on every load is noise in a
   * log that somebody will one day have to read.
   *
   * A 401 CLEARS THE CREDENTIAL. It means revoked or rotated, and it will mean
   * that on every future attempt — so the dead value is dropped rather than
   * re-offered forever (TODO.md: "no retry loop hammering the server"). This
   * is the ONLY place the kiosk clears it: there is deliberately no un-pair
   * control on the device, because a tablet that can un-pair itself is a
   * tablet a passer-by can un-pair.
   *
   * ANY OTHER FAILURE IS COSMETIC and the ceremony carries on with an empty
   * header. A tablet that refuses to work because it could not read a practice
   * name would be blocking care over a caption (REQ-REC-04).
   */
  const loadIdentity = useCallback(async (): Promise<boolean> => {
    if (!readPairingCredential()) {
      setStep('pairing');
      return false;
    }
    try {
      const me = await fetchKioskMe();
      setPracticeName(me.practiceName);
      setLocationLine(me.state ?? null);
      // FAIL CLOSED. Anything but an explicit `true` is a walk-up tablet.
      setMeShowsWaitingList(me.showsWaitingList === true);
      // Out of range, absent, or a server too old to carry it — all three
      // answer the domain default rather than leaving the clock unset.
      setIdleTimeoutSeconds(kioskIdleTimeoutOrDefault(me.kioskIdleTimeoutSeconds));
      setIdentifierTypes(me.identifierTypes ?? []);
      setStep((current) => (current === 'booting' || current === 'unpaired' ? 'idle' : current));
      return true;
    } catch (err) {
      if (isUnpaired(err)) {
        clearPairingCredential();
        setPracticeName('');
        setLocationLine(null);
        setMeShowsWaitingList(false);
        setStep('unpaired');
        return false;
      }
      setStep((current) => (current === 'booting' ? 'idle' : current));
      return true;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const usable = await loadIdentity();
      if (!usable) return;
      try {
        setStaffNames(await fetchPracticeStaffNames());
      } catch {
        /*
         * THE BLOCK CANNOT FIRE WITHOUT THE LIST, and that is survivable only
         * because it is not the only place it fires: the server runs the same
         * REQ-VUL-04 refusal inside `buildAssignorForAnother` before it will
         * re-point an agreement. A tablet that cannot read the staff list ends
         * up asking the server, which refuses, and the patient is handed to
         * the desk with our own sentence rather than let through.
         */
        setStaffNames([]);
      }
    })();
  }, [loadIdentity]);

  /**
   * THE TABLET WAS REVOKED WHILE IT WAS SITTING THERE.
   *
   * The poll reports it, the poll has already stopped itself, and the screen
   * drops here. Everything the ceremony was holding goes with it: this is the
   * one transition that must not leave a previous patient's name in a header.
   */
  useEffect(() => {
    // EITHER POLL CAN BE THE ONE THAT HEARS IT. The session poll runs where the
    // list poll does not — throughout a pushed ceremony — so a tablet revoked
    // while a patient is reading finds out from that one, and lands here.
    if (!list.unpaired && !tabletSession.unpaired) return;
    clearPairingCredential();
    setPracticeName('');
    setLocationLine(null);
    setMeShowsWaitingList(false);
    setPushed(null);
    setAnswers({});
    postedAnswersRef.current = '';
    setStep('unpaired');
  }, [list.unpaired, tabletSession.unpaired]);

  /**
   * A ROLLBACK REACHES A TAB THAT HAS BEEN OPEN SINCE EIGHT IN THE MORNING.
   *
   * `location.reload()` rather than a router refresh, because the thing that
   * must change is the BUNDLE — a client-side navigation would re-render the
   * same broken build. Only between patients: reloading a tab mid-signature
   * would throw away the ceremony somebody is standing at, and a build floor
   * is never urgent enough to justify that. The next reset lands on idle and
   * the reload happens a few seconds later.
   */
  useEffect(() => {
    if (!list.reload || reloadedRef.current) return;
    if (step !== 'idle' && step !== 'list') return;
    reloadedRef.current = true;
    window.location.reload();
  }, [list.reload, step]);

  /**
   * THE EXCHANGE: a code in, a credential out, once.
   *
   * The credential is handed straight to `pairing.ts` and never held here.
   * `writePairingCredential` reports whether the browser actually kept it — a
   * private window or a locked-down profile silently refuses — and the screen
   * says so, because the person standing at the desk is the only one who can
   * do anything about it.
   */
  const submitPairing = useCallback(async () => {
    setPairingBusy(true);
    setPairingFailure(null);
    try {
      const result = await pairDevice(pairingCode);
      const remembered = writePairingCredential(result.credential);
      setPairingCode('');
      setPaired({ practiceName: result.practiceName, remembered });
    } catch (err) {
      /*
       * A REFUSED CODE AND AN UNREACHABLE SERVER ARE DIFFERENT PROBLEMS with
       * different fixes — ask for a new code, or check the network — and the
       * screen says which. Beyond that the refusal never explains itself:
       * wrong, expired, spent and revoked are one sentence, because telling
       * somebody their code was right but stale is telling them their guess
       * was right.
       */
      setPairingFailure(err instanceof KioskApiError ? 'refused' : 'unreachable');
    } finally {
      setPairingBusy(false);
    }
  }, [pairingCode]);

  /** Leaving the confirmation: ask who we are now, and start the morning. */
  const finishPairing = useCallback(() => {
    setPaired(null);
    setStep('booting');
    void (async () => {
      if (await loadIdentity()) {
        try {
          setStaffNames(await fetchPracticeStaffNames());
        } catch {
          setStaffNames([]);
        }
      }
    })();
  }, [loadIdentity]);

  /** A staff member choosing to pair again from the unpaired screen. */
  const startPairing = useCallback(() => {
    setPairingCode('');
    setPairingFailure(null);
    setPaired(null);
    setStep('pairing');
  }, []);

  /**
   * EVERY IN-MEMORY CEREMONY STATE, WALK-UP AND PUSHED — the one clearing
   * routine behind both `reset()` and outage recovery (TODO.md "Outage screen
   * on the tablet"), so the two can never quietly drift apart on what "the
   * tablet holds nothing" means.
   *
   * `releaseSession` IS THE ONE THING THAT DIFFERS. An ordinary reset has
   * either told the server the session is over (`leave`, `resetForInactivity`)
   * or is closing one this tablet itself completed (`sign`, `CompleteScreen`)
   * — in every one of those cases a still-live session with the same id must
   * NOT be re-entered from a stale poll, so `releasedSessionRef` is set.
   * Recovering from an outage has told the server nothing at all — the tablet
   * could not reach it — so a pushed session that is still live must be free
   * to reappear on this device's own next successful poll (TODO.md: "a pushed
   * session re-appears on its own from the session poll"), and setting the
   * guard here would lock it out for no reason this device ever earned.
   */
  const clearCeremonyState = useCallback((options: { releaseSession: boolean }) => {
    // Whatever session was up, read from a ref so this stays dependency-free
    // — it is itself a dependency of the recall effect, and recreating it on
    // every poll would churn that effect.
    if (options.releaseSession && pushedIdRef.current) {
      releasedSessionRef.current = pushedIdRef.current;
    }
    pushedIdRef.current = null;
    setStep('idle');
    setRow(null);
    setAgreement(null);
    /*
     * THE PUSHED SESSION GOES WITH EVERYTHING ELSE. It is the only patient
     * data this device ever holds, and this is the moment the tablet is
     * handed to the next person — a name, a date of birth or an address that
     * survived this line would be exactly the residual patient data C2 forbids.
     */
    setPushed(null);
    setAnswers({});
    postedAnswersRef.current = '';
    setConfirmBusy(false);
    setConfirmError(false);
    setChallengeId(null);
    setFields([]);
    setStated({});
    setVerification(firstAttempt());
    setMismatch(false);
    setChoice(EMPTY_CHOICE);
    setAssignorBusy(false);
    setAssignorError(false);
    autoLockedRef.current = null;
    padRef.current?.clear();
    setInkPresent(false);
    setSignError(null);
    setIncomplete(false);
    setStartError(false);
  }, []);

  const reset = useCallback(
    () => clearCeremonyState({ releaseSession: true }),
    [clearCeremonyState],
  );

  /**
   * OUTAGE RECOVERY'S OWN CLEARING CALL — same state, session left claimable.
   * See the doc comment on `clearCeremonyState` for why this must not be
   * `reset()`.
   */
  const clearForOutageRecovery = useCallback(
    () => clearCeremonyState({ releaseSession: false }),
    [clearCeremonyState],
  );

  const toHandover = useCallback((heading: string, body: string) => {
    setHandover({ heading, body });
    setStep('handover');
  }, []);

  /**
   * THE WAY OUT (Carl, 3 Sep 2026; REQ-REC-04, hard rule 8).
   *
   * Look at what this function does, because what it does NOT do is the rule.
   * It sets two pieces of local state and stops. No fetch. No transition. No
   * `completeCapture`, no `signAgreement`, no `lockParticulars`, no
   * `changeAssignor`. The agreement the patient walked away from is in exactly
   * the status it was in before they touched the tablet, the capture request is
   * still open, and the next person — or the same person, at the desk — picks
   * it up unchanged.
   *
   * It is deliberately NOT `reset()`. Resetting would drop somebody who asked
   * for help back at "Checking in?" with no explanation, which is a dead end
   * wearing a friendly face. They get a screen that says a person will help
   * them and that nothing has been signed; that screen resets the device.
   *
   * A walk-away is not a decline. `declined` is a status with consequences —
   * it ends the agreement and stops the chase ladder — and a patient who
   * wanted to ask a question has declined nothing.
   */
  const leave = useCallback(() => {
    /*
     * ON THE PUSHED PATH IT TELLS THE SERVER, AND THAT IS THE ONLY DIFFERENCE.
     * `POST /kiosk/session/:id/state { walked_away }` ends the SCREEN: it
     * releases the tablet so reception can push the next patient to it, and it
     * writes a vault event saying what happened. It changes NOTHING on the
     * agreement — the particulars stay locked, the capture request stays open,
     * the status does not move — so the patient is still seen and reception
     * still chooses a private bill or an episodic agreement after the service
     * (hard rule 8, REQ-REC-04).
     *
     * FIRE AND FORGET, DELIBERATELY. A patient asking for a person must not be
     * made to wait on a request, and a failed one costs nothing: the session
     * expires on its own after thirty minutes (`TABLET_SESSION_IDLE_MS`), and
     * reception can recall it from the console in the meantime.
     */
    if (pushed) {
      void setTabletSessionState(pushed.id, 'walked_away').catch(() => undefined);
      releasedSessionRef.current = pushed.id;
      setPushed(null);
      setAnswers({});
      postedAnswersRef.current = '';
    }
    toHandover(strings.chrome.leaveHeading, strings.chrome.leaveBody);
  }, [pushed, toHandover]);

  /**
   * NOBODY HAS TOUCHED THIS TABLET FOR THE PRACTICE'S N MINUTES (Carl, 4
   * September 2026).
   *
   * A patient is called in part-way through, or reads two lines and wanders
   * off. What is left is a device on a counter in a waiting room with
   * somebody's name, date of birth and address on it, and the next person to
   * pick it up is a stranger. So the tablet drops EVERYTHING and goes back to
   * idle — `reset()`, the same clearing the done screen performs, which is the
   * point: there is one place that says what "the tablet holds nothing" means.
   *
   * IT IS NOT `leave()`. The hand-over screen exists to tell a person standing
   * there that somebody will help them; there is nobody standing here, and a
   * tablet left on "our reception staff can help" is a tablet still saying
   * something to a room. Idle is the honest screen for an empty counter.
   *
   * A PUSHED SESSION IS ENDED FIRST, and only a pushed session, with
   * `timed_out` — NOT `walked_away` (Carl's ruling, 4 Sep 2026). The two have
   * the identical effect on the record: the session ends, the agreement is
   * untouched, the device is released so reception can push the next patient
   * to it. But this is the CLOCK ending the session, not a press on "See
   * reception", and the console's status column needs to say which — a
   * receptionist who sees "asked for help" goes and looks for someone who
   * isn't there. It changes NOTHING on the agreement either way (hard rule 8,
   * REQ-REC-04). A WALK-UP ceremony posts nothing, because nothing was started
   * server-side beyond a verification event, and that event stands: it records
   * an identity check that genuinely happened, and deleting it because nobody
   * finished the ceremony would be falsifying the record.
   *
   * FIRE AND FORGET, like the exit. The tablet is going back to idle whether
   * or not the request lands; a failed one costs nothing, because the session
   * expires on its own and reception can recall it in the meantime.
   */
  const resetForInactivity = useCallback(() => {
    if (pushed) {
      void setTabletSessionState(pushed.id, 'timed_out').catch(() => undefined);
    }
    reset();
  }, [pushed, reset]);

  /**
   * THE OUTAGE HEARTBEAT (TODO.md "Outage screen on the tablet"). Runs on
   * every screen but the three with no patient standing at them — see
   * `useOutageState`'s own comment for the mechanics, and `clearCeremonyState`
   * for why recovery is not `reset()`. `list.pollMs` is read here rather than
   * re-derived, so this obeys the exact cadence the server already settled on
   * for the waiting list and the pushed-session poll.
   */
  const outageEnabled = step !== 'booting' && step !== 'pairing' && step !== 'unpaired';
  const outage = useOutageState(outageEnabled, list.pollMs, clearForOutageRecovery);

  /**
   * THE CLOCK, ON EVERY SCREEN BUT THE ONES WITH NOBODY'S DETAILS ON THEM.
   *
   * `idle` is excluded because it holds nothing and is already where this
   * sends the tablet. `booting`, `pairing` and `unpaired` are excluded because
   * they are STAFF screens with no patient on them — and because "return to
   * the start" has no meaning on a tablet that has no start to return to. The
   * test device's `list` IS included: it is the one screen in the product that
   * shows other patients' names, so it is the last one that should sit there
   * unattended.
   *
   * AND NOT WHILE THE OUTAGE SCREEN IS UP. Nothing is visible for a countdown
   * to warn about, and firing `timed_out` at a server this tablet cannot
   * reach would be a pointless request racing the recovery poll.
   */
  const inactivity = useInactivityReset({
    enabled:
      step !== 'idle' && step !== 'booting' && step !== 'pairing' && step !== 'unpaired' && !outage.active,
    timeoutSeconds: idleTimeoutSeconds,
    onExpire: resetForInactivity,
  });

  /**
   * BACK ON K-2, ON THE WALK-UP PATH (Carl, 4 September 2026, from the live
   * screen).
   *
   * NAVIGATION, AND IT CLEARS. Every value the patient typed is dropped on the
   * way out — the composed identifiers here, and the sub-fields inside
   * `VerifyScreen`'s own form, which go with it because returning to idle
   * unmounts the screen. Somebody who pressed Begin by mistake, or who is
   * handing the tablet back, must not leave three identifiers on it for the
   * next person to find (C2 — no residual patient data).
   *
   * IT CALLS NOTHING. No challenge is abandoned server-side, no attempt is
   * spent, and the DEVICE'S OWN attempt counter — which lives on the server,
   * per device, precisely so a failed claim cannot be reset by whoever failed
   * it — is untouched. What resets here is the local display of it, because
   * the next person to press Begin is a new person at a fresh screen.
   */
  const backFromVerify = useCallback(() => {
    setStated({});
    setFields([]);
    setChallengeId(null);
    setRow(null);
    setMismatch(false);
    setIncomplete(false);
    setStartError(false);
    setVerification(firstAttempt());
    setStep('idle');
  }, []);

  /**
   * A PUSHED SESSION TAKES OVER THE TABLET — from the IDLE screen, or
   * SUPERSEDES THE ONE ALREADY ON GLASS (Carl, 4 Sep 2026; the second half
   * added the same day after a live bug: a patient crossed "Mobile number" on
   * K-P1, reception corrected it and pressed Re-send, and the tablet stayed on
   * the old, disputed screen).
   *
   * RE-SEND IS A RECALL AND A NEW PUSH, and the two can land inside one poll
   * interval — this device's poll then never sees `{ session: null }` in
   * between, only a DIFFERENT session id where the old one was. The id is
   * what this effect keys on, not "is there a session": whenever the polled
   * id differs from the one this screen is showing, that screen is stale,
   * whatever step it is on, and everything about it — the ticks, the cached
   * agreement, who was chosen to sign — is dropped in favour of the new
   * session's own. THE NEW AGREEMENT ID IS PART OF THAT. Reception may have
   * re-sent the very same agreement, corrected, or superseded it with a new
   * one entirely; either way `setPushed(session)` below replaces the whole
   * payload, and K-P1 reads from it fresh rather than from anything this
   * effect does not explicitly clear.
   *
   * IT WILL NOT INTERRUPT A WALK-UP CEREMONY. Somebody standing at this
   * tablet proving who they are, with no push behind them (`pushed === null`),
   * is on `verify` or `assignor` — screens the poll does not even run on (see
   * `pushedCeremony`, above) — or is on `particulars`/`signature` with
   * `pushed` still null, which `pushedCeremony` also reads as false. So the
   * eligible steps are exactly `idle`, `list`, and `pushedCeremony`'s own
   * screens: the ordinary take-over from idle, PLUS every screen a pushed
   * ceremony can be showing when it is superseded.
   *
   * `reading` IS POSTED HERE, as K-P1 first renders for the new session,
   * which is what reception's status column is watching for.
   */
  useEffect(() => {
    const session = tabletSession.session;
    /*
     * THE SERVER SAYS THERE IS NOTHING, or there is something else: either way
     * whatever this tablet released is genuinely behind it, and the guard is
     * dropped. This is the only place it is cleared, so a released session can
     * never be re-entered on the strength of a poll that has not caught up.
     */
    if (releasedSessionRef.current !== null && releasedSessionRef.current !== session?.id) {
      releasedSessionRef.current = null;
    }
    if (!session) return;
    if (releasedSessionRef.current === session.id) return;
    // THE SAME SESSION THIS SCREEN ALREADY SHOWS — not a supersede, and
    // re-running this block would wipe out ticks the patient has already made.
    if (pushed?.id === session.id) return;
    if (step !== 'idle' && step !== 'list' && !pushedCeremony) return;

    setRow(null);
    setAgreement(null);
    setChallengeId(null);
    setFields([]);
    setStated({});
    setVerification(firstAttempt());
    setMismatch(false);
    setChoice(EMPTY_CHOICE);
    autoLockedRef.current = null;
    setAnswers({});
    postedAnswersRef.current = '';
    setConfirmBusy(false);
    setConfirmError(false);
    setPushed(session);
    pushedIdRef.current = session.id;
    setStep('check-details');
    if (session.state === 'pushed') {
      void setTabletSessionState(session.id, 'reading').catch(() => undefined);
    }
  }, [tabletSession.session, pushed, step, pushedCeremony]);

  /**
   * THE SESSION WENT AWAY — recalled from the console, expired after thirty
   * minutes, or signed somewhere else. All three mean the same thing to this
   * tablet: it is nobody's screen any more, so it clears everything and goes
   * back to idle. That is the screen-hygiene half of the push model — a tablet
   * in a waiting room must never be left showing somebody's particulars after
   * they have gone.
   *
   * ONLY ON AN EXPLICIT ANSWER. `answered` guards the first render, and the
   * poll keeps the last session through a failed request, so one timed-out
   * poll cannot tear down a ceremony somebody is standing at.
   */
  useEffect(() => {
    if (!pushed) return;
    if (!tabletSession.answered || tabletSession.session !== null) return;
    if (!pushedCeremony) return;
    reset();
  }, [pushed, tabletSession.answered, tabletSession.session, pushedCeremony, reset]);

  /** The rows K-P1 draws — the domain's five types, minus the ones we hold nothing for. */
  const detailRows = useMemo(
    () => (pushed ? detailRowsFor(pushed.patient) : []),
    [pushed],
  );

  /**
   * ONE TAP, ONE ANSWER — and pressing the same button again does NOT clear
   * it.
   *
   * A toggle was right when there was one control per row and an untouched row
   * meant "not yet". With a tick and a cross the answer is always one of two
   * things, and a stray double-tap that quietly returned a row to unanswered
   * would disable Continue with no visible cause. Changing your mind means
   * pressing the OTHER button, which is what somebody would do anyway.
   */
  const answerDetail = useCallback((type: string, answer: DetailAnswer) => {
    setConfirmError(false);
    setAnswers((prev) => (prev[type] === answer ? prev : { ...prev, [type]: answer }));
  }, []);

  const rowsAllAnswered = allAnswered(detailRows, answers);
  const rowsDisputed = anyDisputed(detailRows, answers);

  /**
   * SEND THE ANSWERS. TYPES ON THE WIRE, VALUES NOWHERE.
   *
   * `answeredTypes` maps the answered rows to the five words the domain
   * allows, and the request body is those two arrays and nothing else — no
   * name, no date of birth, no address, and no replacement value for a crossed
   * row (REQ-VER-04, hard rule 9). Named test:
   * `details_confirmation_sends_types_not_values`.
   *
   * IT IS IDEMPOTENT AGAINST THE ANSWER SET, so Continue after an automatic
   * post does not write the same event twice.
   */
  const sendAnswers = useCallback(async (): Promise<boolean> => {
    if (!pushed) return false;
    if (!allAnswered(detailRows, answers)) return false;
    const signature = answerSignature(detailRows, answers);
    if (postedAnswersRef.current === signature) return true;

    setConfirmBusy(true);
    setConfirmError(false);
    try {
      const { confirmed, disputed } = answeredTypes(detailRows, answers);
      await confirmSessionDetails(pushed.id, confirmed, disputed);
      postedAnswersRef.current = signature;
      return true;
    } catch (err) {
      if (isUnpaired(err)) {
        clearPairingCredential();
        setStep('unpaired');
        return false;
      }
      // Never a dead end (REQ-REC-04): the message offers the desk, the
      // answers stay on screen, and nothing about the agreement has moved.
      setConfirmError(true);
      return false;
    } finally {
      setConfirmBusy(false);
    }
  }, [pushed, detailRows, answers]);

  /**
   * A CROSS REACHES RECEPTION WITHOUT THE PATIENT DOING ANYTHING FURTHER
   * (Carl, 4 Sep 2026).
   *
   * This is the half of the ruling that is easy to miss. The patient has just
   * been told a detail is wrong and that reception will fix it — if they then
   * had to press a button to SEND that, the ones who did not press it would be
   * standing at a desk explaining something the screen already knew. So the
   * moment every row has an answer and at least one is a cross, the set goes.
   *
   * ONLY WHEN THERE IS A CROSS. An all-ticks answer is the patient saying
   * "yes, carry on", and carrying on is Continue — posting it before they
   * press anything would record a ceremony step they had not taken yet.
   */
  useEffect(() => {
    if (step !== 'check-details') return;
    if (!rowsAllAnswered || !rowsDisputed) return;
    void sendAnswers();
  }, [step, rowsAllAnswered, rowsDisputed, sendAnswers]);

  /**
   * K-P1 → K-3, and only on an all-ticks answer.
   *
   * THE AGREEMENT IS FETCHED AND K-3 IS THE WALK-UP'S OWN SCREEN. There is no
   * K-5 on this path and there could not be: who signs was settled at the desk
   * before the push, and the push locked the particulars, so there is nothing
   * to choose. K-3 states who signs and carries the one-line note under it
   * exactly as it does for a locked walk-up agreement.
   */
  const confirmDetails = useCallback(async () => {
    if (!pushed) return;
    if (!allAnswered(detailRows, answers)) return;
    // Dead as well as disabled: a crossed row means the particulars on screen
    // are not the ones to sign, and the control that would carry the patient
    // past them must not work even if something presses it.
    if (anyDisputed(detailRows, answers)) return;
    if (!(await sendAnswers())) return;
    try {
      const current = await fetchAgreement(pushed.agreementId);
      setAgreement(current);
      setStep('particulars');
    } catch (err) {
      if (isUnpaired(err)) {
        clearPairingCredential();
        setStep('unpaired');
        return;
      }
      setConfirmError(true);
    }
  }, [pushed, detailRows, answers, sendAnswers]);

  /**
   * ONCE VERIFICATION HAS PASSED, WHATEVER DOOR IT CAME THROUGH.
   *
   * Both front doors converge here: the walk-up claim, which found the row by
   * what the patient typed, and the test device's list, where somebody tapped
   * a name and then proved it. From this point the ceremony is identical, and
   * writing it once is what keeps it identical.
   *
   * K-5 IS SKIPPED ON A LOCKED AGREEMENT (Carl, 4 Sep 2026). Who signs is one
   * of the locked particulars, so there is nothing to choose — and the screen
   * that used to render an explanation in the second option's slot read as an
   * option. K-3 states who signs and adds one line saying it was set at
   * reception.
   */
  const afterVerified = useCallback(
    async (verifiedRow: KioskWaitingRow) => {
      const current = await fetchAgreement(verifiedRow.agreementId);
      const moved =
        current.status === 'awaiting_signature'
          ? current
          : await transitionAgreement(verifiedRow.agreementId, 'awaiting_signature');
      setAgreement(moved);
      setStep(moved.particularsLockedAt != null ? 'particulars' : 'assignor');
    },
    [],
  );

  /**
   * BEGIN, ON AN ORDINARY TABLET: straight to K-2 (Carl, 4 Sep 2026).
   *
   * No row is chosen, because choosing one would mean showing the list. The
   * fields come from `/kiosk/me`'s identifier TYPES, and `challengeId` stays
   * null — which is what tells `submitAttempt` this is a claim rather than an
   * attempt against a challenge somebody already opened.
   *
   * A CHALLENGE SET THE DOMAIN GUARD REFUSES ENDS AT THE DESK, not at a blank
   * screen: `identifierFieldsFor` throws on anything outside the approved six
   * or on fewer than the statutory floor of three (REQ-VER-02).
   */
  const beginClaim = useCallback(() => {
    setRow(null);
    setAgreement(null);
    setChallengeId(null);
    setStated({});
    setVerification(firstAttempt());
    setMismatch(false);
    setStartError(false);
    setStep('verify');
    try {
      setFields(identifierFieldsFor(identifierTypes.length > 0 ? identifierTypes : list.identifierTypes));
    } catch {
      setStartError(true);
      setFields([]);
    }
  }, [identifierTypes, list.identifierTypes]);

  /**
   * BEGIN OPENS ONE OF TWO DOORS, and the device decides which. An ordinary
   * tablet goes to K-2 and never shows a name; a test device gets the old list
   * under its banner, which is the path the ceremony spec drives.
   */
  const begin = useCallback(() => {
    if (testDevice) {
      setStep('list');
      return;
    }
    beginClaim();
  }, [testDevice, beginClaim]);

  /** TEST DEVICE ONLY — the staff member taps the arriving patient. */
  const pick = useCallback(
    async (picked: KioskWaitingRow) => {
      setRow(picked);
      setStated({});
      setVerification(firstAttempt());
      setMismatch(false);
      setStartError(false);

      /*
       * UNSIGNABLE, ALREADY KNOWN (TODO.md, "Two rulings from pairing day", 4
       * Sep 2026). `signable` is computed server-side on every poll —
       * `computeSignability` in `packages/domain/src/kiosk.ts` — so the
       * tablet already knows, before this tap, that nothing done here will
       * change the outcome: Carl chose Jamie, passed all three identifiers,
       * and only then found out a detail was missing, on a hand-over screen
       * that named nobody. So the row goes STRAIGHT to the hand-over, naming
       * the patient — the name is not a new disclosure; it is what this same
       * screen already showed on the list a moment ago — and NOTHING is
       * called: no verification challenge, no transition, no lock. The
       * agreement is exactly as untouched as `leave` leaves it.
       */
      if (picked.signable === false) {
        toHandover(strings.particulars.needsReceptionHeading(picked.patientName), strings.particulars.needsReceptionBody);
        return;
      }

      setStep('verify');
      try {
        const built = identifierFieldsFor(
          identifierTypes.length > 0 ? identifierTypes : list.identifierTypes,
        );
        setFields(built);
        const challenge = await startChallenge({
          patientId: picked.patientId,
          identifierTypes: built.map((field) => field.type),
        });
        setChallengeId(challenge.challengeId);
      } catch (err) {
        /*
         * REVOKED MID-CEREMONY. Rare, and it has to be handled here rather
         * than left to the poll, because the poll is stopped while a patient
         * is being served — otherwise the tablet would sit on a verification
         * screen that can never succeed.
         */
        if (isUnpaired(err)) {
          clearPairingCredential();
          setStep('unpaired');
          return;
        }
        // A challenge set the domain guard refuses, or a core that did not
        // answer. Either way the patient is not stuck at a tablet.
        setStartError(true);
        setFields([]);
      }
    },
    [identifierTypes, list.identifierTypes, toHandover],
  );

  /**
   * K-2's ONE SUBMIT, AND IT SERVES BOTH DOORS.
   *
   * `challengeId === null` means nobody has been chosen: this is the walk-up
   * claim, and `POST /kiosk/claim` finds the row and verifies in one call. A
   * challenge id means a test device's list picked somebody first, and the
   * ordinary attempt runs against that challenge.
   *
   * THE FAILURE BEHAVIOUR IS IDENTICAL EITHER WAY, and it has to be: the
   * screen does not move, the values stay on it, the message is the one
   * generic sentence, and the third failure hands over. A patient who mistyped
   * one letter must not be told which door they came through, let alone which
   * detail was wrong (REQ-SEC-07).
   */
  const submitAttempt = useCallback(async () => {
    if (!challengeId && row) return;
    if (!challengeIsComplete(fields, stated)) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    setVerifyBusy(true);
    try {
      // Trimmed at the point it leaves the device, never on a keystroke — see
      // `trimStatedValues`.
      const values = trimStatedValues(stated);
      /*
       * ONE CALL OR THE OTHER, AND THE SHAPE COMING BACK IS THE SAME.
       * `claimWaitingRow` answers the verify path's own `{ outcome,
       * verificationEventId, message }` plus the row it matched, so the ladder
       * below does not need to know which door this was.
       */
      const claimed = challengeId === null ? await claimWaitingRow(values) : null;
      const result = claimed ?? (await attemptChallenge(challengeId as string, values));
      const next = afterAttempt(verification, result);

      /*
       * A MISMATCH DOES NOT MOVE THE SCREEN (Carl, 3 Sep 2026 live test).
       * `afterAttempt` reports the attempt just spent; the ladder is advanced
       * here so K-2 re-renders as "asking, attempt 2" with the one-line message
       * inline and EVERYTHING THE PATIENT TYPED STILL ON IT. The old flow
       * navigated away and came back to an empty form, so one mistyped letter
       * cost all three identifiers.
       *
       * The values stay in component state and nowhere else — the
       * zero-footprint rule is about persistence, and this is neither
       * persisted nor shared. The exit, the lockout and the reset all drop it.
       */
      if (next.kind === 'mismatch') {
        setMismatch(true);
        setVerification(retryAfterMismatch(next));
        return;
      }

      setVerification(next);
      setMismatch(false);
      // Passed or locked out, the stated values leave this device's memory now.
      setStated({});
      if (next.kind === 'passed') {
        /*
         * THE ROW THE CLAIM FOUND, or the row somebody tapped on a test
         * device. On the walk-up path this is the FIRST moment a name exists
         * on this tablet, and it is a name the person standing here has just
         * proved is theirs.
         */
        const verifiedRow = claimed?.row ?? row;
        if (!verifiedRow) {
          // A pass with no row is not a state the server produces; treating it
          // as a fault rather than pressing on is the only safe reading.
          toHandover(strings.particulars.serverFaultHeading, strings.particulars.serverFault);
          return;
        }
        setRow(verifiedRow);

        /*
         * UNSIGNABLE, AND NOW WE KNOW WHO (TODO.md, "Two rulings from pairing
         * day"). On the list path this was checked before the patient did any
         * work; on the walk-up path it cannot be — finding the row IS the
         * work — so the check lands here instead, before any transition or
         * lock is attempted. The hand-over names them, which is safe for the
         * same reason K-3's does: they have just proved who they are.
         */
        if (verifiedRow.signable === false) {
          toHandover(
            strings.particulars.needsReceptionHeading(verifiedRow.patientName),
            strings.particulars.needsReceptionBody,
          );
          return;
        }
        await afterVerified(verifiedRow);
      }
    } catch (err) {
      if (isUnpaired(err)) {
        clearPairingCredential();
        setStep('unpaired');
        return;
      }
      toHandover(strings.verify.lockedHeading, strings.errors.generic);
    } finally {
      setVerifyBusy(false);
    }
  }, [afterVerified, challengeId, fields, row, stated, verification, toHandover]);

  const particularsLocked = agreement?.particularsLockedAt != null;
  const patientName = row?.patientName ?? '';

  /**
   * WHICH CAPTURE REQUEST THIS SIGNATURE CLOSES, whichever door it came
   * through. The walk-up takes it from the waiting row; the push takes it from
   * the session, where the server put the `in_practice` request it opened. K-4
   * does not know or care which — one signing step, one contract with
   * `POST /agreements/:id/sign`, and no fork in the code that produces a
   * signature (FR-2.7).
   */
  const captureRequestId = pushed?.captureRequestId ?? row?.captureRequestId ?? null;

  /**
   * THE NAME K-3 AND K-6 USE ON THE PUSHED PATH, composed from the session's
   * own two fields. It is only ever a fallback: the locked particulars carry
   * `patientName` and the agreement's own copy wins wherever it exists, which
   * keeps the words on the reading screen the words that were rendered and
   * hashed (rule 13).
   */
  const pushedPatientName = pushed
    ? [pushed.patient.givenNames, pushed.patient.familyName]
        .map((part) => (part ?? '').trim())
        .filter((part) => part.length > 0)
        .join(' ')
    : '';

  /**
   * THE LIVE GATE BEHIND K-5's CONTINUE (Carl, 3 Sep 2026 live test).
   * Recomputed on every change to the choice or the staff list, so the
   * `GuardedButton` is disabled — with its reason — before anybody presses it,
   * not only after (CLAUDE.md §6). `decideAssignor`, below, uses the same
   * function, so the two can never disagree about what counts as blocked.
   *
   * IT NO LONGER HAS A LOCKED BRANCH (Carl, 4 Sep 2026). It used to answer
   * `valid` on a locked agreement, because K-5 was still rendered there with
   * its choice disabled and a Continue that simply returned to K-3. K-5 is now
   * SKIPPED on a locked agreement, so the only gate this has to compute is the
   * real one.
   */
  const guard: AssignorGate = useMemo(
    () => evaluateAssignorGate({ choice, practiceStaffNames: staffNames, patientName }),
    [choice, staffNames, patientName],
  );

  /**
   * Step 3: who is signing. Takes the choice explicitly rather than reading
   * `choice` from closure, so the self-assign shortcut below can advance on
   * the SAME tap that sets `assignorIsPatient: true`, without waiting a
   * render for state to catch up.
   */
  const advanceAssignor = useCallback(
    async (candidate: AssignorChoice) => {
      /*
       * DEFENCE IN DEPTH, AND IT SHOULD NEVER FIRE. The ceremony does not
       * route a locked agreement to K-5 at all any more; if some future path
       * did, the right answer is still to move on rather than to POST a change
       * the server will refuse (REQ-REG-06 — who signs is a locked
       * particular).
       */
      if (particularsLocked) {
        setStep('particulars');
        return;
      }
      const decision = decideAssignor({
        choice: candidate,
        practiceStaffNames: staffNames,
        patientName,
        // Not on this device by design — the waiting row carries no date of
        // birth, so the self-assign gate is the server's to make.
        patientAgeYears: null,
      });
      // Defence in depth, not the primary gate: the button that calls this is
      // already disabled while blocked, so `allowed` is false here only if
      // this is ever wired up wrong — never as the patient's own experience.
      if (!decision.allowed) return;

      if (candidate.assignorIsPatient) {
        /*
         * BACK TO THE PATIENT. Reached by somebody who chose "someone else",
         * changed their mind, and tapped themselves — the agreement may
         * already be pointed elsewhere, so the revert is sent rather than
         * assumed. `{ assignorIsPatient: true }` on its own is the whole body.
         */
        if (agreement && !agreement.assignorIsPatient) {
          setAssignorBusy(true);
          setAssignorError(false);
          try {
            setAgreement(await changeAssignor(agreement.id, { assignorIsPatient: true }));
          } catch {
            setAssignorError(true);
            return;
          } finally {
            setAssignorBusy(false);
          }
        }
        setStep('particulars');
        return;
      }

      if (!agreement) return;
      setAssignorBusy(true);
      setAssignorError(false);
      try {
        /*
         * THE WRITE THE EXPO BUILD COULD NOT MAKE. It ran these same gates and
         * then handed over to the desk, because nothing re-pointed a draft at
         * a new assignor. A 201 carries the updated agreement and the ceremony
         * continues to K-3; a 400 names the rule and never echoes the name, so
         * the screen shows its own sentence rather than the server's.
         */
        const body = assignorRequestFrom(candidate);
        // Null only if the gate were ever bypassed. A body the server would
        // refuse is not composed at all, rather than sent and refused.
        if (!body) {
          setAssignorError(true);
          return;
        }
        const updated = await changeAssignor(agreement.id, body);
        setAgreement(updated);
        setStep('particulars');
      } catch {
        setAssignorError(true);
      } finally {
        setAssignorBusy(false);
      }
    },
    [agreement, particularsLocked, staffNames, patientName],
  );

  const continueAssignor = useCallback(() => void advanceAssignor(choice), [advanceAssignor, choice]);

  /** Step 4: lock, validate, render, hash — all server-side. */
  const runLock = useCallback(async () => {
    if (!row || !agreement) return;
    if (agreement.particularsLockedAt) return;
    setLockBusy(true);
    try {
      const serviceDate = row.appointmentDate ?? new Date().toISOString().slice(0, 10);
      const locked = await lockParticulars(agreement.id, { serviceDate });
      setAgreement(locked);
    } catch (err) {
      /*
       * EVERY FAILURE ON K-3 HANDS OVER (Carl, 3 Sep 2026 — this replaced the
       * staff-entry box and the numbered failure list).
       *
       * A rules refusal means a particular is missing or wrong. D6a comes from
       * the PMS appointment type through the practice's versioned mapping
       * (CONSULTATION-CAPTURE-PLAN section 2.4), and the other C-rules concern
       * records the tablet cannot see either — so there is nothing the person
       * standing here can do, and offering them a field only invited a guess at
       * a validated particular of a contract. A fault on our side is even less
       * theirs. Both say what has happened, hand over, and change nothing: no
       * retry, no second POST. Staff fix it on a staff surface, where the
       * mapping, the booking and the audit trail are.
       *
       * The server's own words never reach the screen in either case.
       */
      const read = readLockFailure(err);
      if (read.kind === 'rules') {
        // NAMES THE PATIENT (TODO.md, "Two rulings from pairing day", 4 Sep
        // 2026) — `patientName` is already in scope from the row this
        // ceremony started on, and the hand-over is the second of the two
        // places that ruling requires it.
        toHandover(strings.particulars.needsReceptionHeading(patientName), strings.particulars.needsReceptionBody);
      } else {
        toHandover(strings.particulars.serverFaultHeading, strings.particulars.serverFault);
      }
    } finally {
      setLockBusy(false);
    }
  }, [agreement, row, toHandover, patientName]);

  /**
   * THE AUTOMATIC LOCK FIRES ONCE PER AGREEMENT, and the ref is the reason it
   * is safe.
   *
   * The first version of this guarded on `particularsLockedAt` and `lockBusy`
   * alone, which looked sufficient and was not: a FAILED lock re-reads the
   * agreement, the new object is a new reference, the effect re-runs, and the
   * tablet posts to `/particulars` several times a second for as long as the
   * screen is open. It was caught against the running core, where the rules
   * service was unreachable — a hundred 500s in the network log for one
   * patient standing at a desk. A retry after a refusal must be a person
   * pressing a button, never an effect.
   */
  useEffect(() => {
    if (step !== 'particulars' || !agreement) return;
    if (agreement.particularsLockedAt || lockBusy) return;
    /*
     * A PUSHED AGREEMENT IS ALREADY LOCKED, AND IF IT IS NOT, THE TABLET DOES
     * NOT LOCK IT.
     *
     * The push validates and locks on the SERVER before any device sees the
     * payload — that is the whole reason the push is stronger on REQ-REG-06
     * than a pull would be, because a tablet structurally cannot hold a draft.
     * So an unlocked agreement arriving here is not a state to recover from by
     * locking it from a waiting-room device; it is a fault on our side, and it
     * says so and hands over.
     */
    if (pushed) {
      toHandover(strings.particulars.serverFaultHeading, strings.particulars.serverFault);
      return;
    }
    if (autoLockedRef.current === agreement.id) return;
    autoLockedRef.current = agreement.id;
    void runLock();
  }, [step, agreement, lockBusy, runLock, pushed, toHandover]);

  /** Step 5: sign, then close the capture request. */
  const sign = useCallback(
    async (method: 'drawn' | 'tap_to_approve') => {
      if (!agreement || !captureRequestId) return;
      setSignBusy(true);
      setSignError(null);
      /*
       * BOTH REPRESENTATIONS NOW GO WITH THE CALL (REQ-SIG-01/-02). The gap
       * this used to document is closed: `SignDto` carries a `signature`, and
       * the server stores the strokes and the image as artefacts of the
       * agreement and binds both hashes into the signature event.
       *
       * A DRAWN SIGNATURE WITH NOTHING TO SEND IS NOT DOWNGRADED TO A TAP.
       * `composeSignRequest` answers null, and the ceremony stops and says the
       * signature failed rather than filing a tap-to-approve under `drawn`.
       * Nobody is blocked from being seen or billed (rule 8): tap-to-approve
       * is still on screen, is still a real signature, and the way out to
       * reception never moved.
       */
      const body = composeSignRequest(
        method,
        captureRequestId,
        method === 'drawn' ? (padRef.current?.capture() ?? null) : null,
      );
      if (!body) {
        // Never rendered — K-4 shows its own copy for any failure — so this
        // string is for a developer, and names no patient detail either way.
        setSignError('The signature pad produced nothing to send.');
        setSignBusy(false);
        return;
      }
      try {
        await signAgreement(agreement.id, body);
        // `sign` already completes the capture request when it is given one;
        // this is the belt-and-braces close for the case where it was not.
        await completeCapture(captureRequestId).catch(() => undefined);
        /*
         * ON THE PUSHED PATH THE SERVER ENDS THE SESSION AS `signed` — the
         * tablet never asserts that state itself, because a device that could
         * assert it could assert a contract. The next poll would answer
         * `{ session: null }`; the poll is off on this screen, so the thank-you
         * is not yanked away by our own success.
         */
        setStep('complete');
      } catch (err) {
        setSignError((err as Error).message);
      } finally {
        setSignBusy(false);
      }
    },
    [agreement, captureRequestId],
  );

  const validation: SignatureValidation = useMemo(() => {
    if (!agreement) return { state: 'validating' };
    if (lockBusy) return { state: 'validating' };
    return evaluateSignatureGate({
      status: agreement.status,
      particulars: agreement.particulars,
      particularsLockedAt: agreement.particularsLockedAt,
      ruleSetVersion: agreement.ruleSetVersion,
      renderedArtefactHash: agreement.renderedArtefactHash,
    });
  }, [agreement, lockBusy]);

  const view: ParticularsView = useMemo(() => {
    const p = (agreement?.particulars ?? {}) as Record<string, unknown>;
    const str = (key: string) => (typeof p[key] === 'string' ? (p[key] as string) : null);
    return {
      /*
       * THE ROW'S OWN FIELD FIRST (TODO.md, 4 Sep 2026 copy follow-up) — it
       * is on the waiting-list row precisely so K-3 need not wait on a fresh
       * agreement fetch to know which heading to show. `agreement.type`
       * (already fetched by this point in the ceremony) is the fallback, and
       * `episodic_pre` — the only type the kiosk ever lists — is the last
       * one, so this can never be `undefined` and force a component to guess.
       */
      /*
       * THE PUSHED SESSION'S TYPE FIRST, then the row's, then the agreement's.
       * The session states it explicitly ("so the ceremony picks its own
       * heading" — `TabletSessionPayload`), and on the pushed path there is no
       * waiting row at all, so without this K-3 and K-4 would fall through to
       * the `episodic_pre` default and an enduring agreement would be read
       * under an episodic heading.
       */
      agreementType:
        pushed?.agreementType
        ?? row?.agreementType
        ?? (agreement?.type as AgreementType | undefined)
        ?? 'episodic_pre',
      patientName: str('patientName') ?? row?.patientName ?? pushedPatientName,
      providerName: str('providerName') ?? row?.providerName ?? null,
      providerAddress: str('providerAddress'),
      serviceDate: str('serviceDate'),
      agreementDate: str('agreementDate'),
      basicServiceDescription: str('basicServiceDescription'),
      assignorIsPatient: agreement?.assignorIsPatient ?? true,
      assignorName: str('assignorName'),
      assignorRelationship: str('assignorRelationship'),
      /*
       * WHY K-3 IS TOLD (Carl, 4 Sep 2026). On a locked agreement K-5 was
       * skipped, so the "Signing" line here is the only place the patient is
       * told who signs — and one line under it says where that was decided and
       * who can change it. It never draws a control.
       */
      particularsLocked: agreement?.particularsLockedAt != null,
      ruleSetVersion: agreement?.ruleSetVersion ?? null,
      mappingVersion: agreement?.mappingVersion ?? null,
      artefactHash: agreement?.renderedArtefactHash ?? null,
    };
  }, [agreement, row, pushed, pushedPatientName]);

  /**
   * THE OUTAGE SCREEN REPLACES EVERYTHING BELOW IT (TODO.md "Outage screen on
   * the tablet"). Every hook above this line has already run unconditionally,
   * so returning here is safe; nothing after it is a hook. Whatever step the
   * ceremony was on stays in state, untouched and unseen, until
   * `clearForOutageRecovery` runs on the first successful poll.
   */
  if (outage.active) {
    return <OutageScreen practiceName={practiceName} locationLine={locationLine} />;
  }

  /**
   * THE SCREEN, AND THEN THE ONE THING THAT SITS OVER IT.
   *
   * The switch is unchanged; what wraps it is the inactivity warning, which
   * has to be able to appear on ANY of these screens and therefore cannot
   * live inside one. It is drawn last so it is over the ceremony, and it does
   * not intercept a tap — see `InactivityWarning` — so the touch that
   * dismisses it is still the touch the patient meant to make.
   */
  const screen = ((): ReactNode => {
    switch (step) {
      /*
       * BEFORE ANYTHING ELSE. Deliberately blank rather than a spinner or a
       * skeleton of the idle screen: this lasts one request, and showing a
       * practice's chrome to a tablet that may not belong to a practice — even
       * for a moment — is the thing pairing exists to stop.
       */
      case 'booting':
        return null;
      case 'pairing':
        return (
          <PairingScreen
            code={pairingCode}
            busy={pairingBusy}
            failure={pairingFailure}
            paired={paired}
            onChangeCode={(next) => {
              setPairingFailure(null);
              setPairingCode(next);
            }}
            onPair={() => void submitPairing()}
            onContinue={finishPairing}
          />
        );
      case 'unpaired':
        return <UnpairedScreen onPair={startPairing} />;
      case 'idle':
      case 'list':
        return (
          <IdleScreen
            practiceName={practiceName}
            locationLine={locationLine}
            mode={step}
            rows={list.rows}
            /*
              THE HEALTH SIGNAL IS THE POLL ANSWERING, NOT THE POLL RETURNING
              NAMES (Carl, 4 Sep 2026). On an ordinary tablet the response is
              `hidden: true` with no rows — an empty list is now the normal
              answer, so it can no longer mean "something is wrong". `error` is
              the only thing that does, and it still hides Begin over a server
              nobody can reach.
            */
            error={list.error}
            anyoneWaiting={list.anyoneWaiting}
            online={list.error === null}
            testDevice={testDevice}
            onStart={begin}
            onBack={() => setStep('idle')}
            onPick={(picked) => void pick(picked)}
            onRetry={list.refresh}
          />
        );
      /*
       * K-P1 — THE PUSHED CEREMONY'S ONLY NEW SCREEN.
       *
       * No verification form and no list: reception did the checking, and the
       * patient neither searches nor types. No K-5 either — who signs was set at
       * the desk before the push and the particulars are locked, so there is
       * nothing to choose and K-3 states it read-only, exactly as it does for a
       * locked walk-up agreement (Carl, 4 Sep 2026: never render an
       * option-shaped box that is not an option).
       */
      case 'check-details':
        return (
          <CheckDetailsScreen
            practiceName={practiceName}
            locationLine={locationLine}
            agreementType={pushed?.agreementType ?? 'episodic_pre'}
            rows={detailRows}
            answers={answers}
            disputed={rowsDisputed}
            saving={confirmBusy}
            saveError={confirmError}
            sessionId={pushed?.id ?? null}
            onAnswer={answerDetail}
            onContinue={() => void confirmDetails()}
            onSeeReception={leave}
          />
        );
      case 'verify':
        return (
          <VerifyScreen
            practiceName={practiceName}
            locationLine={locationLine}
            fields={fields}
            stated={stated}
            state={verification}
            busy={verifyBusy}
            incomplete={incomplete}
            startError={startError}
            mismatch={mismatch}
            onChange={(t, v) => {
              setStated((prev) => ({ ...prev, [t]: v }));
              /*
               * THE MISMATCH MESSAGE CLEARS THE MOMENT A FIELD CHANGES (Carl,
               * 4 Sep 2026). Leaving "Some details don't match" up while the
               * patient is correcting a value read as though the correction
               * had already failed too. The attempt counter in the footer
               * (`strings.verify.attemptOf`) is untouched — it is still true —
               * and the message returns only if the NEXT Continue fails again.
               */
              setMismatch(false);
            }}
            onContinue={() => void submitAttempt()}
            /*
              BACK TO IDLE, CLEARING EVERY TYPED VALUE (Carl, 4 Sep 2026, from
              the live screen). Navigation, not the way out: it calls nothing,
              spends no attempt, and leaves the device's server-side attempt
              counter exactly where it was.
            */
            onBack={backFromVerify}
            blueprintPanels={testDevice}
            onSeeReception={leave}
          />
        );
      case 'assignor':
        return (
          <AssignorScreen
            practiceName={practiceName}
            locationLine={locationLine}
            patientName={patientName}
            choice={choice}
            guard={guard}
            saveError={assignorError}
            saving={assignorBusy}
            onChoose={(isPatient) => {
              const next = { ...choice, assignorIsPatient: isPatient };
              setChoice(next);
              setAssignorError(false);
              // Self-assign is never blocked from this device (see
              // `advanceAssignor`), so the tap itself advances — fewest taps,
              // no Continue needed for the common case. "Someone else" only
              // reveals the form; it still has real gates to pass.
              if (isPatient) void advanceAssignor(next);
            }}
            onChangeOther={(patch) => {
              setAssignorError(false);
              setChoice((prev) => ({ ...prev, ...patch }));
            }}
            onContinue={continueAssignor}
            blueprintPanels={testDevice}
            onSeeReception={leave}
          />
        );
      case 'particulars':
        return (
          <ParticularsScreen
            practiceName={practiceName}
            locationLine={locationLine}
            view={view}
            validation={validation}
            onContinue={() => setStep('signature')}
            /*
              NAVIGATION, NOT AN EXIT — one `setStep` and nothing else — AND NOT
              OFFERED AT ALL ON A LOCKED AGREEMENT (Carl, 4 Sep 2026). K-5 was
              skipped, so there is nothing behind Back; a control that leads to a
              screen offering a choice the server will refuse is worse than no
              control.
            */
            /*
              AND ON THE PUSHED PATH IT GOES BACK TO K-P1 (Carl, 4 Sep 2026).
              There IS something behind it there — "Please check your details" —
              and the ticks are held in this component's state, so nobody has to
              re-tick five rows to look at their address again. One `setStep`,
              no fetch, and `confirm-details` is not re-posted on the way back.
            */
            onBack={
              pushed
                ? () => setStep('check-details')
                : particularsLocked
                  ? undefined
                  : () => setStep('assignor')
            }
            blueprintPanels={testDevice}
            sessionId={pushed?.id ?? null}
            onSeeReception={leave}
          />
        );
      case 'signature':
        return (
          <SignatureScreen
            practiceName={practiceName}
            locationLine={locationLine}
            heading={strings.particulars.headingByAgreementType[view.agreementType]}
            validation={validation}
            padRef={padRef}
            inkPresent={inkPresent}
            submitting={signBusy}
            error={signError}
            onInkChange={setInkPresent}
            onClear={() => {
              padRef.current?.clear();
              setInkPresent(false);
            }}
            onSignDrawn={() => void sign('drawn')}
            onSignTap={() => void sign('tap_to_approve')}
            // NAVIGATION, NOT AN EXIT — and offered only while nothing has been
            // signed; the screen hides it once a signature is in flight.
            onBack={() => setStep('particulars')}
            sessionId={pushed?.id ?? null}
            onSeeReception={leave}
          />
        );
      case 'complete':
        return (
          <CompleteScreen
            practiceName={practiceName}
            locationLine={locationLine}
            // The push has no waiting row; its session carries the given names
            // directly, which is a better source than splitting a display name.
            givenName={
              (pushed?.patient.givenNames ?? row?.patientName ?? '').trim().split(' ')[0] ?? ''
            }
            sessionId={pushed?.id ?? null}
            onDone={reset}
          />
        );
      case 'handover':
      default:
        return (
          <HandoverScreen
            practiceName={practiceName}
            locationLine={locationLine}
            heading={handover.heading}
            body={handover.body}
            onDone={reset}
          />
        );
    }
  })();

  return (
    <>
      {screen}
      {inactivity.warningSecondsLeft !== null ? (
        <InactivityWarning secondsLeft={inactivity.warningSecondsLeft} />
      ) : null}
    </>
  );
}

/**
 * WHOSE FAULT WAS IT — the distinction the Expo build did not draw, and Carl
 * found it on a live tablet.
 *
 * A 400 from `/particulars` carries the rules engine's NAMED failures ("C6:
 * D6a: a pre-agreement requires…"): real outstanding particulars, written to
 * be read, which a staff member can act on. Anything else — a 500, a timeout,
 * a body that is not JSON — is ours. Rendering the second as the first put
 * "Internal server error" in a numbered list of details the patient was being
 * asked to fix.
 *
 * The raw message never leaves this function on the fault path. It is not
 * written for a patient, and nobody has checked that it is free of detail we
 * would not want on a waiting-room screen.
 */
export type LockFailure =
  | { readonly kind: 'rules'; readonly failures: readonly string[] }
  | { readonly kind: 'fault' };

export function readLockFailure(err: unknown): LockFailure {
  if (!(err instanceof KioskApiError)) return { kind: 'fault' };
  if (err.status !== 400) return { kind: 'fault' };
  try {
    const parsed = JSON.parse(err.message) as { message?: string; failures?: string[] };
    if (Array.isArray(parsed.failures) && parsed.failures.length > 0) {
      return { kind: 'rules', failures: parsed.failures };
    }
    if (typeof parsed.message === 'string' && parsed.message.length > 0) {
      return { kind: 'rules', failures: [parsed.message] };
    }
  } catch {
    /* not JSON — a 400 we cannot read is no more actionable than a 500 */
  }
  return { kind: 'fault' };
}

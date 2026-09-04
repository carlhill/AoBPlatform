'use client';

/**
 * The ceremony: list → verify → who is signing → locked particulars → sign →
 * done. `episodic_pre` only, in practice only, and nothing else — no enduring
 * (that is build-plan item 10), no offline queue (withdrawn with the
 * zero-footprint decision), no portal activation.
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
 *      ETag, so a quiet morning costs 304s.
 *   2. `POST /verification/challenges` then `/attempt` — the identifier TYPES
 *      come from that same response; the values are sent once and dropped.
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
import type { AgreementType } from '@aobplatform/domain';
import {
  attemptChallenge,
  changeAssignor,
  completeCapture,
  fetchAgreement,
  fetchKioskMe,
  fetchPracticeStaffNames,
  isUnpaired,
  KioskApiError,
  pairDevice,
  lockParticulars,
  signAgreement,
  startChallenge,
  transitionAgreement,
  type AgreementResponse,
  type KioskWaitingRow,
} from './api';
import { useWaitingList } from './useWaitingList';
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
import { IdleScreen } from './screens/IdleScreen';
import { VerifyScreen } from './screens/VerifyScreen';
import { AssignorScreen } from './screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { SignatureScreen } from './screens/SignatureScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import { PairingScreen, type PairedOutcome, type PairingFailure } from './screens/PairingScreen';
import { UnpairedScreen } from './screens/UnpairedScreen';
import type { SignaturePadHandle } from './components/SignaturePad';
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
  const [staffNames, setStaffNames] = useState<readonly string[]>([]);
  const [row, setRow] = useState<KioskWaitingRow | null>(null);
  const [agreement, setAgreement] = useState<AgreementResponse | null>(null);

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
      setStep((current) => (current === 'booting' || current === 'unpaired' ? 'idle' : current));
      return true;
    } catch (err) {
      if (isUnpaired(err)) {
        clearPairingCredential();
        setPracticeName('');
        setLocationLine(null);
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
    if (!list.unpaired) return;
    clearPairingCredential();
    setPracticeName('');
    setLocationLine(null);
    setStep('unpaired');
  }, [list.unpaired]);

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

  const reset = useCallback(() => {
    setStep('idle');
    setRow(null);
    setAgreement(null);
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
    toHandover(strings.chrome.leaveHeading, strings.chrome.leaveBody);
  }, [toHandover]);

  /** Step 1 → 2: the staff member taps the arriving patient. */
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
        const built = identifierFieldsFor(list.identifierTypes);
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
    [list.identifierTypes, toHandover],
  );

  /** Step 2: one attempt. Values go out once and are not kept here. */
  const submitAttempt = useCallback(async () => {
    if (!challengeId || !row) return;
    if (!challengeIsComplete(fields, stated)) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    setVerifyBusy(true);
    try {
      // Trimmed at the point it leaves the device, never on a keystroke — see
      // `trimStatedValues`.
      const result = await attemptChallenge(challengeId, trimStatedValues(stated));
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
        const current = await fetchAgreement(row.agreementId);
        const moved =
          current.status === 'awaiting_signature'
            ? current
            : await transitionAgreement(row.agreementId, 'awaiting_signature');
        setAgreement(moved);
        setStep('assignor');
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
  }, [challengeId, fields, row, stated, verification, toHandover]);

  const particularsLocked = agreement?.particularsLockedAt != null;
  const patientName = row?.patientName ?? '';

  /**
   * THE LIVE GATE BEHIND K-5's CONTINUE (Carl, 3 Sep 2026 live test).
   * Recomputed on every change to the choice or the staff list, so the
   * `GuardedButton` is disabled — with its reason — before anybody presses it,
   * not only after (CLAUDE.md §6). `decideAssignor`, below, uses the same
   * function, so the two can never disagree about what counts as blocked.
   *
   * ONCE THE PARTICULARS ARE LOCKED THE GATE IS MOOT. Nothing on the screen
   * can change who signs any more (REQ-REG-06 — who signs is one of them, and
   * the server refuses), so K-5 is reachable by Back purely to read that
   * sentence, and Continue simply returns to K-3.
   */
  const guard: AssignorGate = useMemo(
    () =>
      particularsLocked
        ? { state: 'valid' }
        : evaluateAssignorGate({ choice, practiceStaffNames: staffNames, patientName }),
    [choice, staffNames, particularsLocked, patientName],
  );

  /**
   * Step 3: who is signing. Takes the choice explicitly rather than reading
   * `choice` from closure, so the self-assign shortcut below can advance on
   * the SAME tap that sets `assignorIsPatient: true`, without waiting a
   * render for state to catch up.
   */
  const advanceAssignor = useCallback(
    async (candidate: AssignorChoice) => {
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
    if (autoLockedRef.current === agreement.id) return;
    autoLockedRef.current = agreement.id;
    void runLock();
  }, [step, agreement, lockBusy, runLock]);

  /** Step 5: sign, then close the capture request. */
  const sign = useCallback(
    async (method: 'drawn' | 'tap_to_approve') => {
      if (!row || !agreement) return;
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
        row.captureRequestId,
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
        await completeCapture(row.captureRequestId).catch(() => undefined);
        setStep('complete');
      } catch (err) {
        setSignError((err as Error).message);
      } finally {
        setSignBusy(false);
      }
    },
    [agreement, row],
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
      agreementType: row?.agreementType ?? (agreement?.type as AgreementType | undefined) ?? 'episodic_pre',
      patientName: str('patientName') ?? row?.patientName ?? '',
      providerName: str('providerName') ?? row?.providerName ?? null,
      providerAddress: str('providerAddress'),
      serviceDate: str('serviceDate'),
      agreementDate: str('agreementDate'),
      basicServiceDescription: str('basicServiceDescription'),
      assignorIsPatient: agreement?.assignorIsPatient ?? true,
      assignorName: str('assignorName'),
      assignorRelationship: str('assignorRelationship'),
      ruleSetVersion: agreement?.ruleSetVersion ?? null,
      mappingVersion: agreement?.mappingVersion ?? null,
      artefactHash: agreement?.renderedArtefactHash ?? null,
    };
  }, [agreement, row]);

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
          error={list.error}
          online={list.error === null}
          onStart={() => setStep('list')}
          onBack={() => setStep('idle')}
          onPick={(picked) => void pick(picked)}
          onRetry={list.refresh}
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
          particularsLocked={particularsLocked}
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
          // NAVIGATION, NOT AN EXIT. One `setStep` and nothing else.
          onBack={() => setStep('assignor')}
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
          onSeeReception={leave}
        />
      );
    case 'complete':
      return (
        <CompleteScreen
          practiceName={practiceName}
          locationLine={locationLine}
          givenName={(row?.patientName ?? '').split(' ')[0] ?? ''}
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

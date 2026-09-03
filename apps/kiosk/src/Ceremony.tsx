/**
 * The ceremony: list → verify → who is signing → locked particulars → sign →
 * done. `episodic_pre` only, in practice only, and nothing else — no enduring
 * (that is item 10), no offline sync engine, no portal activation.
 *
 * ORDER IS THE PRODUCT HERE. Every step below happens against an endpoint that
 * already existed; what this file contributes is the sequence and the refusal
 * to skip a step:
 *
 *   1. `GET /kiosk/waiting-list` — polled at the SERVER's cadence, with an
 *      ETag, so a quiet morning costs 304s.
 *   2. `POST /verification/challenges` then `/attempt` — the identifier TYPES
 *      come from that same response; the values are sent once and dropped.
 *   3. `POST /agreements/:id/transition` to `awaiting_signature`. The remote
 *      link path does this inside `capture.verifyLink`; the in-practice path
 *      has no server-side equivalent, so the kiosk asks — through the domain
 *      transition map, which refuses anything the lifecycle disallows.
 *   4. `POST /agreements/:id/particulars` — the server assembles, validates,
 *      renders and hashes. Only then can the signature control enable.
 *   5. `POST /agreements/:id/sign`, then `POST /capture/:id/complete`.
 *
 * NOTHING PERSISTS ON THE DEVICE. No token, no identifier value, no patient
 * record: the ceremony state lives in component state and is dropped on reset
 * (C2 — no residual patient data after submission; CONVENTIONS.md §9b).
 *
 * EVERY FAILURE ROUTES TO THE DESK, never to a dead end (REQ-REC-04).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  attemptChallenge,
  completeCapture,
  fetchAgreement,
  fetchPractice,
  fetchPracticeStaffNames,
  lockParticulars,
  signAgreement,
  startChallenge,
  transitionAgreement,
} from './api/client';
import { KioskApiError, type AgreementResponse, type KioskWaitingRow } from './api/types';
import { useWaitingList } from './hooks/useWaitingList';
import { identifierFieldsFor, challengeIsComplete, type IdentifierField } from './rules/identifiers';
import { trimStatedValues } from './rules/verify-fields';
import { decideAssignor, evaluateAssignorGate, type AssignorChoice } from './rules/assignor';
import { evaluateSignatureGate, type SignatureValidation } from './rules/signature-gate';
import { afterAttempt, firstAttempt, retryAfterMismatch, type VerificationState } from './rules/verification';
import { IdleScreen } from './screens/IdleScreen';
import { VerifyScreen } from './screens/VerifyScreen';
import { AssignorScreen } from './screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { SignatureScreen } from './screens/SignatureScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import type { Stroke } from './components/SignaturePad';
import { strings } from './strings';

type Step = 'idle' | 'list' | 'verify' | 'assignor' | 'particulars' | 'signature' | 'complete' | 'handover';

const EMPTY_CHOICE: AssignorChoice = {
  assignorIsPatient: true,
  otherName: '',
  otherRelationship: '',
  otherDeclaredOfAge: false,
};

export function Ceremony(): ReactNode {
  const [step, setStep] = useState<Step>('idle');
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

  const [choice, setChoice] = useState<AssignorChoice>(EMPTY_CHOICE);

  const [serverFailures, setServerFailures] = useState<readonly string[]>([]);
  const [staffEntryOpen, setStaffEntryOpen] = useState(false);
  const [staffDescription, setStaffDescription] = useState('');
  const [lockBusy, setLockBusy] = useState(false);

  /** Which agreement the automatic lock has already been attempted for. */
  const autoLockedRef = useRef<string | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const [inkPresent, setInkPresent] = useState(false);
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const [handover, setHandover] = useState<{ heading: string; body: string }>({
    heading: strings.verify.lockedHeading,
    body: strings.errors.generic,
  });

  // The list is polled only while the tablet is between patients. Mid-ceremony
  // the screen is not showing it, and a poll that nobody can see is noise.
  const list = useWaitingList(step === 'idle' || step === 'list');

  useEffect(() => {
    void (async () => {
      try {
        const practice = await fetchPractice();
        setPracticeName(practice.name);
        setLocationLine(practice.state ?? null);
      } catch {
        // A missing header is cosmetic. It never stops the ceremony.
      }
      try {
        setStaffNames(await fetchPracticeStaffNames());
      } catch {
        // The staff block cannot fire without the list, so the assignor branch
        // routes to the desk on its own — see `continueAssignor`.
        setStaffNames([]);
      }
    })();
  }, []);

  const reset = useCallback(() => {
    setStep('idle');
    setRow(null);
    setAgreement(null);
    setChallengeId(null);
    setFields([]);
    setStated({});
    setVerification(firstAttempt());
    setChoice(EMPTY_CHOICE);
    setServerFailures([]);
    setStaffEntryOpen(false);
    setStaffDescription('');
    autoLockedRef.current = null;
    strokesRef.current = [];
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
   * `completeCapture`, no `signAgreement`, no `lockParticulars`. The agreement
   * the patient walked away from is in exactly the status it was in before
   * they touched the tablet, the capture request is still open, and the next
   * person — or the same person, at the desk — picks it up unchanged.
   *
   * It is deliberately NOT `reset()`. Resetting would drop somebody who asked
   * for help back at "Checking in?" with no explanation, which is a dead end
   * wearing a friendly face. They get a screen that says a person will help
   * them and that nothing has been signed; that screen resets the device.
   *
   * A walk-away is not a decline. `declined` is a status with consequences —
   * it ends the agreement and stops the chase ladder — and a patient who
   * wanted to ask a question has declined nothing. If we ever want the
   * walk-away recorded it goes to the vault as an ordinary event.
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
      setStartError(false);
      setStep('verify');
      try {
        const built = identifierFieldsFor(list.identifierTypes);
        setFields(built);
        const challenge = await startChallenge({
          patientId: picked.patientId,
          identifierTypes: built.map((field) => field.type),
        });
        setChallengeId(challenge.challengeId);
      } catch {
        // A challenge set the domain guard refuses, or a core that did not
        // answer. Either way the patient is not stuck at a tablet.
        setStartError(true);
        setFields([]);
      }
    },
    [list.identifierTypes],
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
      // `trimStatedValues`. Address went back to a single free-text line and
      // has no local draft state of its own to trim safely as it is typed.
      const result = await attemptChallenge(challengeId, trimStatedValues(stated));
      const next = afterAttempt(verification, result);
      setVerification(next);
      // Whatever happened, the stated values leave this device's memory now.
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
    } catch {
      toHandover(strings.verify.lockedHeading, strings.errors.generic);
    } finally {
      setVerifyBusy(false);
    }
  }, [challengeId, fields, row, stated, verification, toHandover]);

  /**
   * THE LIVE GATE BEHIND K-5's CONTINUE (Carl, 3 Sep 2026 live test). Recomputed
   * on every change to the choice or the staff list, so the `GuardedButton` on
   * `AssignorScreen` is disabled — with its reason — before anybody presses it,
   * not only after (CLAUDE.md §6). `decideAssignor`, below, uses the same
   * function for the "someone else" branch, so the two can never disagree about
   * what counts as blocked.
   */
  const guard = useMemo(
    () => evaluateAssignorGate({ choice, practiceStaffNames: staffNames, practiceName }),
    [choice, staffNames, practiceName],
  );

  /**
   * Step 3: who is signing. Takes the choice explicitly rather than reading
   * `choice` from closure, so the self-assign shortcut below can advance on
   * the SAME tap that sets `assignorIsPatient: true`, without waiting a
   * render for state to catch up.
   */
  const advanceAssignor = useCallback(
    (candidate: AssignorChoice) => {
      const decision = decideAssignor({
        choice: candidate,
        practiceStaffNames: staffNames,
        practiceName,
        // Not on this device by design — the waiting row carries no date of
        // birth, so the self-assign gate is the server's to make.
        patientAgeYears: null,
      });
      // Defence in depth, not the primary gate: the button that calls this is
      // already disabled while blocked, so `allowed` is false here only if
      // this is ever wired up wrong — never as the patient's own experience.
      if (!decision.allowed) return;
      if (!candidate.assignorIsPatient) {
        // Allowed, and still a desk job: nothing here can re-point the
        // agreement at a new assignor, and inventing one would be worse than
        // handing over.
        toHandover(strings.assignor.handoverHeading, strings.assignor.handoverBody);
        return;
      }
      setStep('particulars');
    },
    [staffNames, practiceName, toHandover],
  );

  const continueAssignor = useCallback(() => advanceAssignor(choice), [advanceAssignor, choice]);

  /** Step 4: lock, validate, render, hash — all server-side. */
  const runLock = useCallback(async () => {
    if (!row || !agreement) return;
    if (agreement.particularsLockedAt) return;
    setLockBusy(true);
    setServerFailures([]);
    try {
      const serviceDate = row.appointmentDate ?? new Date().toISOString().slice(0, 10);
      const locked = await lockParticulars(agreement.id, {
        serviceDate,
        ...(staffDescription.trim() ? { basicServiceDescription: staffDescription.trim() } : {}),
      });
      setAgreement(locked);
    } catch (err) {
      setServerFailures(readFailures(err));
      // The agreement is re-read so the gate is evaluated from the server's
      // state rather than from what this screen hoped had happened.
      try {
        setAgreement(await fetchAgreement(agreement.id));
      } catch {
        /* keep the last known agreement; the gate stays blocked either way */
      }
    } finally {
      setLockBusy(false);
    }
  }, [agreement, row, staffDescription]);

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
      try {
        await signAgreement(agreement.id, { method, captureRequestId: row.captureRequestId });
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
          queueDepth={0}
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
          onChange={(t, v) => setStated((prev) => ({ ...prev, [t]: v }))}
          onContinue={() => void submitAttempt()}
          onRetry={() => setVerification((prev) => retryAfterMismatch(prev))}
          onSeeReception={leave}
        />
      );
    case 'assignor':
      return (
        <AssignorScreen
          practiceName={practiceName}
          locationLine={locationLine}
          patientName={row?.patientName ?? ''}
          choice={choice}
          guard={guard}
          onChoose={(isPatient) => {
            const next = { ...choice, assignorIsPatient: isPatient };
            setChoice(next);
            // Self-assign is never blocked from this device (see
            // `advanceAssignor`), so the tap itself advances — fewest taps,
            // no Continue needed for the common case. "Someone else" only
            // reveals the form; it still has real gates to pass.
            if (isPatient) advanceAssignor(next);
          }}
          onChangeOther={(patch) => {
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
          serverFailures={serverFailures}
          staffEntryOpen={staffEntryOpen}
          staffDescription={staffDescription}
          busy={lockBusy}
          onOpenStaffEntry={() => setStaffEntryOpen(true)}
          onChangeStaffDescription={setStaffDescription}
          onRetryLock={() => void runLock()}
          onContinue={() => setStep('signature')}
          onSeeReception={leave}
        />
      );
    case 'signature':
      return (
        <SignatureScreen
          practiceName={practiceName}
          locationLine={locationLine}
          validation={validation}
          strokesRef={strokesRef}
          inkPresent={inkPresent}
          submitting={signBusy}
          error={signError}
          onInkChange={setInkPresent}
          onClear={() => {
            strokesRef.current = [];
            setInkPresent(false);
          }}
          onSignDrawn={() => void sign('drawn')}
          onSignTap={() => void sign('tap_to_approve')}
          onSeeReception={leave}
        />
      );
    case 'complete':
      return (
        <CompleteScreen
          practiceName={practiceName}
          locationLine={locationLine}
          givenName={(row?.patientName ?? '').split(' ')[0] ?? ''}
          queued={false}
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
 * Pulls the rules engine's named failures out of a 400. They are rule lines
 * ("C6: D6a: a pre-agreement requires…"), never a patient detail value — the
 * server is careful about that and this only forwards what it sent.
 */
function readFailures(err: unknown): readonly string[] {
  if (!(err instanceof KioskApiError)) return [strings.particulars.lockFailed];
  try {
    const parsed = JSON.parse(err.message) as { message?: string; failures?: string[] };
    if (Array.isArray(parsed.failures) && parsed.failures.length > 0) return parsed.failures;
    if (typeof parsed.message === 'string') return [parsed.message];
  } catch {
    /* not JSON — fall through */
  }
  return [strings.particulars.lockFailed];
}

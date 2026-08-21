'use client';

/**
 * Recording one check.
 *
 * The catalogue told the reviewer what to do; this is where they say what they
 * actually did. Without it the checklist was a reading exercise, which is worse
 * than no checklist — it looks like a control and records nothing.
 *
 * The rules mirror packages/domain/src/checks.ts EXACTLY, and the server
 * enforces them again on arrival. That duplication is deliberate: the form
 * exists to stop a reviewer wasting a submission, the server exists to stop
 * anything else, and neither is allowed to be the only one.
 *
 *   - failed             → needs a reason code AND words. "Failed" with no
 *                          reason cannot be counted and tells the next reviewer
 *                          nothing.
 *   - could_not_complete → needs a reason code, from a DIFFERENT list. "We
 *                          could not verify" and "they refused" are different
 *                          facts about an applicant and must not collapse into
 *                          one outcome.
 *   - not_applicable     → needs words. It leaves the score entirely, so an
 *                          unexplained one is indistinguishable from skipping.
 *   - passed             → needs neither, but always names who.
 *
 * Every outcome names the human. "Checked" is not a check.
 */

import { useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import { Button, Field, Notice, SelectInput, TextInput, ui } from '../ui';
import { strings } from '../strings';
import styles from './review.module.css';

export interface RecordCheckInput {
  checkKey: string;
  outcome: string;
  performedByName: string;
  reasonCode?: string;
  note?: string;
}

type ReasonKey = keyof typeof strings.review.checkReasons;

const OUTCOMES = ['passed', 'failed', 'not_applicable', 'could_not_complete'] as const;

export function CheckRecorder({
  checkKey,
  performedByName,
  failureReasons,
  incompleteReasons,
  verifyAt,
  onCancel,
  onSave,
}: {
  checkKey: string;
  /**
   * The reviewer, taken from the session — NEVER typed here. A name somebody
   * types into an evidence record is not attribution, it is a text field: any
   * value is accepted and none can be checked. See the notice on the dossier
   * about what this currently means.
   */
  performedByName: string;
  failureReasons: string[];
  incompleteReasons: string[];
  /** Where to actually perform this check, when there is an authoritative source. */
  verifyAt?: { label: string; url: string };
  onCancel: () => void;
  /** Rejects on refusal, so the reason can be shown HERE rather than off-screen. */
  onSave: (input: RecordCheckInput) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * A refusal is shown INSIDE this form.
   *
   * It used to surface in the page-level notice at the top of the dossier —
   * roughly two thousand pixels above the form being filled in. The save
   * appeared to do nothing at all, which is the worst possible reading of a
   * refusal: the reviewer concludes the button is broken and stops trying.
   * An error belongs where the eye already is.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  // Which list of reasons applies is decided by the outcome, because the two
  // lists describe different things: why a check FAILED, versus why it could
  // not be completed at all.
  const reasons = outcome === 'failed' ? failureReasons : outcome === 'could_not_complete' ? incompleteReasons : [];
  const needsReason = outcome === 'failed' || outcome === 'could_not_complete';
  const needsNote = outcome === 'failed' || outcome === 'not_applicable';

  // The reviewer's name is not a field here, so it is not part of validity —
  // whether it is known at all is decided by the dossier, which will not open
  // this form without one.
  const complete =
    outcome !== '' && (!needsReason || reasonCode !== '') && (!needsNote || note.trim().length > 0);

  const label = (key: string) => strings.review.checkReasons[key as ReasonKey] ?? key;

  async function save() {
    setBusy(true);
    setRefusal(null);
    try {
      await onSave({
        checkKey,
        outcome,
        performedByName,
        reasonCode: needsReason ? reasonCode : undefined,
        note: note.trim() || undefined,
      });
    } catch (e) {
      setRefusal((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.checkForm}>
      {verifyAt && (
        <p className={styles.verifyAt}>
          <a href={verifyAt.url} target="_blank" rel="noreferrer noopener" className={styles.verifyLink}>
            <ExternalLink size={14} aria-hidden="true" />
            {strings.review.checkVerifyAt} {verifyAt.label}
          </a>
        </p>
      )}

      <Field label={strings.review.checkOutcome} required>
        {(props) => (
          <SelectInput
            {...props}
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              // The reason lists differ per outcome, so a code chosen under the
              // old outcome would be silently wrong under the new one.
              setReasonCode('');
            }}
            data-testid={`check-outcome-${checkKey}`}
          >
            <option value="">{strings.review.checkOutcomeChoose}</option>
            {OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {strings.review.checkOutcomes[value]}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>

      {needsReason && (
        <Field label={strings.review.checkReason} hint={strings.review.checkReasonRequired} required>
          {(props) => (
            <SelectInput
              {...props}
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              data-testid={`check-reason-${checkKey}`}
            >
              <option value="">{strings.review.checkOutcomeChoose}</option>
              {reasons.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      )}

      <Field
        label={strings.review.checkNote}
        hint={
          outcome === 'failed'
            ? strings.review.checkNoteRequiredFailed
            : outcome === 'not_applicable'
              ? strings.review.checkNoteRequiredNa
              : undefined
        }
        required={needsNote}
      >
        {(props) => (
          <TextInput
            {...props}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid={`check-note-${checkKey}`}
          />
        )}
      </Field>

      <p className={ui.hint} data-testid={`check-by-${checkKey}`}>
        {strings.review.checkWillBeRecordedAs} <strong>{performedByName}</strong>
      </p>

      {refusal && (
        <Notice tone="stop" title={strings.review.checkRefused}>
          {refusal}
        </Notice>
      )}

      <div className={styles.decideActions}>
        <Button variant="primary" disabled={!complete || busy} onClick={save} data-testid={`check-save-${checkKey}`}>
          <Check size={15} aria-hidden="true" />
          {strings.review.checkSave}
        </Button>
        <Button variant="subtle" onClick={onCancel} disabled={busy}>
          <X size={15} aria-hidden="true" />
          {strings.review.checkCancel}
        </Button>
        {!complete && <span className={ui.hint}>{strings.review.checkAppendOnly}</span>}
      </div>
    </div>
  );
}

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

import { useRef, useState } from 'react';
import { Check, ExternalLink, FileUp, Paperclip, X } from 'lucide-react';
import { Button, Field, Notice, SelectInput, TextInput, ui } from '../ui';
import { MAX_ARTEFACT_BYTES } from '@aobplatform/domain';
import { strings } from '../strings';
import styles from './review.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * Which artefact purpose a check's evidence belongs under.
 *
 * The purposes say what a file IS, independently of the check it happened to
 * be attached to — so the same round-trip email is a `domain_check` whether it
 * was filed today or re-read in a dispute three years from now.
 */
const PURPOSE_FOR_CHECK: Record<string, string> = {
  'entitlement.phone_call': 'entitlement_call',
  'entitlement.video_call': 'entitlement_call',
  'entitlement.domain_match': 'domain_check',
  'entitlement.document': 'identity_document',
  'entitlement.hpio_delegation': 'credential',
  'entity.abn_active': 'website_capture',
  'entity.abn_age': 'website_capture',
  'address.confirmed': 'website_capture',
  'address.ahpra_locality_match': 'credential',
  'credential.verified': 'credential',
};

interface Attached {
  id: string;
  filename: string;
}

interface EvidenceWarning {
  kind: 'duplicate' | 'identifier_absent' | 'unreadable';
  message: string;
}

/**
 * Which identifier a check's evidence ought to contain.
 *
 * Only the checks where there IS a right answer. Asking whether a phone-call
 * note contains the ABN would produce a warning on every legitimate file, and a
 * warning that cries wolf is one reviewers learn to click past — which costs
 * more than the check gains.
 */
const IDENTIFIER_FOR_CHECK: Record<string, { field: 'abn'; label: string }> = {
  'entity.abn_active': { field: 'abn', label: 'ABN' },
  'entity.abn_age': { field: 'abn', label: 'ABN' },
};

/** "24.6 MB", not "25783512". A limit is only useful if it can be compared to. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface RecordCheckInput {
  checkKey: string;
  outcome: string;
  performedByName: string;
  reasonCode?: string;
  note?: string;
  artefactIds?: string[];
  fields?: Record<string, string>;
}

type ReasonKey = keyof typeof strings.review.checkReasons;

const OUTCOMES = ['passed', 'failed', 'not_applicable', 'could_not_complete'] as const;

export function CheckRecorder({
  checkKey,
  performedByName,
  failureReasons,
  incompleteReasons,
  verifyAt,
  evidenceRequired,
  requiredFields,
  practiceId,
  abn,
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
  /** Whether this check may be recorded as PASSED with nothing attached. */
  evidenceRequired: boolean;
  /**
   * Structured values this check demands when it passes, from the catalogue.
   *
   * Rendered generically rather than hand-written per check. Three separate
   * times a rule in the domain has demanded something the form could not
   * collect — a checklist that could not be filled in, evidence that could not
   * be attached, and now this. Driving the inputs off the catalogue means the
   * next requiredField added to a check appears here on its own.
   */
  requiredFields: readonly string[];
  practiceId: string;
  /** The application's ABN, so evidence for an ABN check can be checked against it. */
  abn?: string | null;
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
  const [fields, setFields] = useState<Record<string, string>>({});
  const [attached, setAttached] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<EvidenceWarning[]>([]);
  const [inspecting, setInspecting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Which list of reasons applies is decided by the outcome, because the two
  // lists describe different things: why a check FAILED, versus why it could
  // not be completed at all.
  const reasons = outcome === 'failed' ? failureReasons : outcome === 'could_not_complete' ? incompleteReasons : [];
  const needsReason = outcome === 'failed' || outcome === 'could_not_complete';
  const needsNote = outcome === 'failed' || outcome === 'not_applicable';

  // The reviewer's name is not a field here, so it is not part of validity —
  // whether it is known at all is decided by the dossier, which will not open
  // this form without one.
  // Evidence is only demanded on a PASS. A failure is explained by its reason
  // code and its words; requiring a file to record "nobody answered" would make
  // the checks hardest to evidence the ones hardest to report, which is exactly
  // backwards — and would push a reviewer towards recording nothing at all.
  const needsEvidence = evidenceRequired && outcome === 'passed';
  // Only demanded on a PASS, for the same reason as evidence: recording that
  // nobody answered should not require the name of the person who did not.
  const fieldsNeeded = outcome === 'passed' ? requiredFields : [];

  const complete =
    outcome !== '' &&
    (!needsReason || reasonCode !== '') &&
    (!needsNote || note.trim().length > 0) &&
    (!needsEvidence || attached.length > 0) &&
    fieldsNeeded.every((name) => (fields[name] ?? '').trim().length > 0) &&
    !uploading;

  const label = (key: string) => strings.review.checkReasons[key as ReasonKey] ?? key;

  /**
   * Upload one file and hold its id.
   *
   * The artefact is created against the PRACTICE and only linked to this check
   * when the check saves. A file uploaded and then abandoned is an orphan,
   * which is untidy; the alternative — creating the check first so the file has
   * something to hang on — would put an unevidenced check in an append-only
   * register the moment somebody opened a file dialog. Untidy beats wrong.
   */
  /**
   * Ask whether the file actually evidences what it is about to be cited for.
   *
   * Runs AFTER the upload rather than as part of it, because the check being
   * evidenced is not known at upload time — a file is uploaded, then cited.
   *
   * Failure here is silent on purpose: this is an advisory second opinion, and
   * an error banner about a corroboration service would obscure the upload that
   * actually succeeded.
   */
  async function inspect(artefactId: string) {
    const wanted = IDENTIFIER_FOR_CHECK[checkKey];
    setInspecting(true);
    try {
      const params = new URLSearchParams({ checkKey });
      if (wanted && abn) {
        params.set('identifier', abn);
        params.set('identifierLabel', wanted.label);
      }
      const response = await fetch(
        CORE_URL + '/artefacts/' + artefactId + '/inspect?' + params.toString(),
        { headers: { 'x-practice-id': practiceId } },
      );
      if (!response.ok) return;
      const data = (await response.json()) as { warnings: EvidenceWarning[] };
      setWarnings((current) => [...current, ...(data.warnings ?? [])]);
    } catch {
      // Advisory only.
    } finally {
      setInspecting(false);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      // Checked HERE, before reading the file into memory and base64-ing it.
      // The server checks again — it is the boundary — but discovering the
      // limit only after a long upload, from a message about "request entity
      // too large", tells the reviewer nothing they can act on.
      if (file.size > MAX_ARTEFACT_BYTES) {
        throw new Error(
          strings.review.evidenceTooLarge
            .replace('{size}', formatBytes(file.size))
            .replace('{max}', formatBytes(MAX_ARTEFACT_BYTES)),
        );
      }

      const buffer = new Uint8Array(await file.arrayBuffer());
      // Chunked. String.fromCharCode(...bytes) on a large file exceeds the
      // argument limit and throws a RangeError that reads like nothing at all.
      let binary = '';
      for (let i = 0; i < buffer.length; i += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      }

      const response = await fetch(CORE_URL + '/artefacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-practice-id': practiceId },
        body: JSON.stringify({
          contentBase64: btoa(binary),
          filename: file.name,
          declaredContentType: file.type || undefined,
          purpose: PURPOSE_FOR_CHECK[checkKey] ?? 'other',
          uploadedByName: performedByName,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'That file was refused (' + response.status + ').');
      }
      const created = (await response.json()) as { id: string; filename?: string };
      setAttached((list) => [...list, { id: created.id, filename: created.filename ?? file.name }]);
      void inspect(created.id);
    } catch (e) {
      setUploadError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

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
        artefactIds: attached.map((a) => a.id),
        fields: fieldsNeeded.length > 0 ? fields : undefined,
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

      {fieldsNeeded.length > 0 && (
        <div className={styles.requiredFields}>
          <p className={ui.hint} style={{ marginBottom: 'var(--s3)' }}>
            {strings.review.checkFieldsNeeded}
          </p>
          {fieldsNeeded.map((name) => (
            <Field
              key={name}
              // An unlabelled key renders as itself rather than vanishing: a
              // missing label is a cosmetic bug, a missing input is a wall.
              label={strings.review.checkFields[name] ?? name}
              hint={strings.review.checkFieldHints[name]}
              required
            >
              {(props) =>
                name === 'numberSource' ? (
                  <SelectInput
                    {...props}
                    value={fields[name] ?? ''}
                    onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))}
                    data-testid={'check-field-' + name}
                  >
                    <option value="">{strings.review.checkOutcomeChoose}</option>
                    <option value="nhsd">National Health Services Directory</option>
                    <option value="practice_website">The practice website</option>
                    <option value="public_directory">Another public directory</option>
                    <option value="application_form">The application form</option>
                    <option value="other">Other</option>
                  </SelectInput>
                ) : (
                  <TextInput
                    {...props}
                    value={fields[name] ?? ''}
                    onChange={(e) => setFields((f) => ({ ...f, [name]: e.target.value }))}
                    data-testid={'check-field-' + name}
                  />
                )
              }
            </Field>
          ))}
        </div>
      )}

      {outcome === 'passed' || evidenceRequired ? (
        <div className={styles.evidence}>
          <div className={styles.evidenceHead}>
            <Paperclip size={15} aria-hidden="true" />
            {strings.review.evidenceHeading}
          </div>
          <p className={ui.hint}>
            {needsEvidence ? strings.review.evidenceRequiredHere : strings.review.evidenceOptionalHere}
          </p>
          <p className={ui.hint}>
            {strings.review.evidenceTypes} {strings.review.evidenceMax} {formatBytes(MAX_ARTEFACT_BYTES)}.
          </p>

          <ul className={styles.evidenceList}>
            {attached.length === 0 && <li className={ui.hint}>{strings.review.evidenceNone}</li>}
            {attached.map((file) => (
              <li className={styles.evidenceItem} key={file.id}>
                <Paperclip size={13} aria-hidden="true" />
                <span className={styles.evidenceName}>{file.filename}</span>
                <Button
                  variant="subtle"
                  onClick={() => {
                    setAttached((list) => list.filter((f) => f.id !== file.id));
                    // The warnings were about the file being removed.
                    setWarnings([]);
                  }}
                >
                  {strings.review.evidenceRemove}
                </Button>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 'var(--s3)' }}>
            <input
              ref={fileRef}
              type="file"
              id={'evidence-' + checkKey}
              className={styles.fileInput}
              accept="image/png,image/jpeg,image/gif,image/webp,image/tiff,application/pdf,text/plain,message/rfc822,.eml"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                // Cleared so re-selecting the SAME file fires change again.
                e.target.value = '';
              }}
              data-testid={'check-file-' + checkKey}
            />
            <label htmlFor={'evidence-' + checkKey} className={styles.fileLabel}>
              <FileUp size={15} aria-hidden="true" />
              {uploading ? strings.review.evidenceUploading : strings.review.evidenceAdd}
            </label>
          </div>

          {uploadError && (
            <Notice tone="stop" title={strings.review.evidenceRejected}>
              {uploadError}
            </Notice>
          )}

          {inspecting && <p className={ui.hint}>{strings.review.evidenceChecking}</p>}

          {/*
            Warnings, never refusals. Both tests are defeatable by anyone
            actually trying — a hash changes when a file is re-exported, and a
            fabricated screenshot contains the right number. What they do is put
            a specific, checkable statement in front of the person deciding.
          */}
          {warnings.length > 0 && (
            <div data-testid={'evidence-warnings-' + checkKey}>
              <Notice tone="warn" title={strings.review.evidenceWarnHeading}>
                <span>
                  {warnings.map((w, i) => (
                    <span key={w.kind + i} style={{ display: 'block', marginBottom: 'var(--s2)' }}>
                      {w.message}
                    </span>
                  ))}
                  <span style={{ display: 'block', opacity: 0.85 }}>{strings.review.evidenceWarnAck}</span>
                </span>
              </Notice>
            </div>
          )}
        </div>
      ) : (
        outcome !== '' && <p className={ui.hint}>{strings.review.evidenceOnlyOnPass}</p>
      )}

      <p className={ui.hint} data-testid={'check-by-' + checkKey}>
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

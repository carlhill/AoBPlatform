'use client';

/**
 * The two ends of an address confirmation: the reviewer's decision, and the
 * practice's correction.
 *
 * WHY THEY LIVE IN ONE FILE. They are one loop, and the thing that makes the
 * loop work is that a rejection says something the practice can act on. Split
 * across two files, the reviewer's reason list and the practice's guidance
 * text drift apart, and the practice ends up reading "not_a_clinical_site".
 * Both render from the SAME catalogue, fetched from the server, so a reviewer
 * can see exactly what their decision will say to somebody else.
 *
 * WHAT WAS HERE BEFORE. A single "Confirm the address" button that recorded a
 * boolean and a typed-in name. It could only say yes: a reviewer who looked
 * and decided not to confirm had nothing to do but close the tab, leaving the
 * practice locked out of the site with no way to learn why. And "confirmed"
 * with no method is a record nobody can weigh later — not a regulator, not us,
 * not the reviewer themselves in six months.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Paperclip, Pencil, Send, X } from 'lucide-react';
import { Button, Field, Notice, SelectInput, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Mirrors ADDRESS_CHECK_METHODS / ADDRESS_REJECTION_REASONS in the domain. */
interface CheckMethod {
  key: string;
  label: string;
  establishes: string;
  limits: string;
  requiresDocument: boolean;
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
}
interface RejectionReason {
  key: string;
  label: string;
  practiceGuidance: string;
  requiresDetail: boolean;
}
interface Catalogue {
  version: string;
  methods: CheckMethod[];
  rejectionReasons: RejectionReason[];
}

/** 20 MB, matching the artefact store's own cap. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

async function refusal(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const message = body?.message;
    return Array.isArray(message) ? message.join(', ') : String(message ?? res.status);
  } catch {
    return `Request failed (${res.status}).`;
  }
}

export function useAddressCatalogue(): Catalogue | null {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${CORE_URL}/organisations/address-check/catalogue`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (live && c) setCatalogue(c);
      })
      .catch(() => {
        // The panel degrades to a disabled state rather than an empty form
        // that would post an unrecordable decision.
      });
    return () => {
      live = false;
    };
  }, []);
  return catalogue;
}

/**
 * The reviewer's decision: confirm with a method and evidence, or send it back
 * with a reason.
 */
export function AddressDecision({
  locationId,
  headers,
  catalogue,
  onDone,
  onCancel,
}: {
  locationId: string;
  headers: Record<string, string>;
  catalogue: Catalogue | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'confirm' | 'reject'>('confirm');

  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const [artefactId, setArtefactId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenMethod = catalogue?.methods.find((m) => m.key === method);
  const chosenReason = catalogue?.rejectionReasons.find((r) => r.key === reason);

  /*
   * The same rule the server enforces, applied here so the reviewer is not
   * told about it only after pressing the button. The SERVER is still the
   * authority — this is a courtesy, not the control.
   */
  const confirmReady =
    Boolean(method) &&
    (!chosenMethod?.requiresDocument || Boolean(artefactId)) &&
    (method !== 'other' || note.trim().length > 0);
  const rejectReady = Boolean(reason) && (!chosenReason?.requiresDetail || detail.trim().length > 0);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(strings.locations.uploadTooLarge);
      return;
    }
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      // Chunked, because String.fromCharCode(...) on a 20 MB array blows the
      // argument limit and fails as a RangeError nobody can interpret.
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const res = await fetch(`${CORE_URL}/artefacts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contentBase64: btoa(binary),
          declaredContentType: file.type || undefined,
          filename: file.name,
          purpose: 'address_evidence',
          subjectType: 'PracticeLocation',
          subjectId: locationId,
        }),
      });
      if (!res.ok) throw new Error(await refusal(res));
      const body = await res.json();
      setArtefactId(body.id);
      setFileName(file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const url =
        mode === 'confirm'
          ? `${CORE_URL}/organisations/locations/${locationId}/activate`
          : `${CORE_URL}/organisations/locations/${locationId}/reject-address`;
      const body =
        mode === 'confirm'
          ? { method, note: note.trim() || undefined, artefactId: artefactId ?? undefined }
          : { reason, detail: detail.trim() || undefined };
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await refusal(res));
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!catalogue) {
    return <p className={styles.cardNote}>{strings.locations.catalogueLoading}</p>;
  }

  return (
    <div className={styles.decision}>
      <div className={styles.decisionTabs} role="group" aria-label={strings.locations.decisionLegend}>
        <Button
          variant={mode === 'confirm' ? 'primary' : 'subtle'}
          onClick={() => setMode('confirm')}
          data-testid={`decision-confirm-${locationId}`}
        >
          <Check size={15} aria-hidden="true" />
          {strings.locations.confirmTitle}
        </Button>
        <Button
          variant={mode === 'reject' ? 'primary' : 'subtle'}
          onClick={() => setMode('reject')}
          data-testid={`decision-reject-${locationId}`}
        >
          <Send size={15} aria-hidden="true" />
          {strings.locations.rejectTitle}
        </Button>
      </div>

      {mode === 'confirm' ? (
        <>
          <p className={styles.cardNote}>{strings.locations.confirmBody}</p>

          <Field label={strings.locations.methodLabel} hint={strings.locations.methodHint} required>
            {(props) => (
              <SelectInput
                {...props}
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                  setError(null);
                }}
                data-testid={`method-${locationId}`}
              >
                <option value="">{strings.locations.methodPlaceholder}</option>
                {catalogue.methods.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>

          {/*
            WHAT IT DOES AND DOES NOT ESTABLISH, at the moment of choosing. The
            limits are the half people skip, and a reviewer who only ever reads
            what a check proves learns to over-read their own evidence.
          */}
          {chosenMethod && (
            <div className={styles.methodDetail}>
              <p className={styles.methodEstablishes}>{chosenMethod.establishes}</p>
              <p className={styles.methodLimits}>
                <AlertTriangle size={13} aria-hidden="true" /> {chosenMethod.limits}
              </p>
            </div>
          )}

          {chosenMethod?.requiresDocument && (
            <Field label={strings.locations.documentLabel} hint={strings.locations.documentHint} required>
              {(props) => (
                <div className={styles.uploadRow}>
                  <input
                    {...props}
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                    }}
                    disabled={uploading}
                    data-testid={`document-${locationId}`}
                  />
                  {uploading && <span className={styles.cardNote}>{strings.locations.uploading}</span>}
                  {artefactId && fileName && (
                    <span className={styles.attached}>
                      <Paperclip size={13} aria-hidden="true" /> {fileName}
                    </span>
                  )}
                </div>
              )}
            </Field>
          )}

          <Field
            label={strings.locations.noteLabel}
            hint={method === 'other' ? strings.locations.noteRequiredHint : strings.locations.noteHint}
            required={method === 'other'}
          >
            {(props) => (
              <TextInput
                {...props}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid={`note-${locationId}`}
              />
            )}
          </Field>
        </>
      ) : (
        <>
          <p className={styles.cardNote}>{strings.locations.rejectBody}</p>

          <Field label={strings.locations.reasonLabel} hint={strings.locations.reasonHint} required>
            {(props) => (
              <SelectInput
                {...props}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                data-testid={`reason-${locationId}`}
              >
                <option value="">{strings.locations.reasonPlaceholder}</option>
                {catalogue.rejectionReasons.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>

          {/*
            EXACTLY WHAT THE PRACTICE WILL READ. A reviewer choosing a reason is
            writing a message to somebody else, and they should be able to see
            it before they send it.
          */}
          {chosenReason && (
            <div className={styles.methodDetail}>
              <p className={styles.previewLabel}>{strings.locations.practiceWillSee}</p>
              <p className={styles.methodEstablishes}>{chosenReason.practiceGuidance}</p>
            </div>
          )}

          <Field
            label={strings.locations.detailLabel}
            hint={chosenReason?.requiresDetail ? strings.locations.detailRequiredHint : strings.locations.detailHint}
            required={Boolean(chosenReason?.requiresDetail)}
          >
            {(props) => (
              <TextInput
                {...props}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                data-testid={`detail-${locationId}`}
              />
            )}
          </Field>
        </>
      )}

      <div className={ui.rowActions}>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={busy || uploading || (mode === 'confirm' ? !confirmReady : !rejectReady)}
          data-testid={`decision-submit-${locationId}`}
        >
          {busy
            ? strings.locations.working
            : mode === 'confirm'
              ? strings.locations.confirmAction
              : strings.locations.rejectAction}
        </Button>
        <Button variant="subtle" onClick={onCancel}>
          {strings.locations.confirmCancel}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.locations.confirmFailed}>
          {error}
        </Notice>
      )}
    </div>
  );
}

/**
 * The practice correcting its own address.
 *
 * Only offered while the address is unconfirmed. After confirmation it may
 * already be printed on captured agreements, so changing it is a review, not
 * an edit — the server refuses either way.
 */
export function AddressEdit({
  location,
  headers,
  onDone,
  onCancel,
}: {
  location: {
    id: string;
    addressLine1?: string | null;
    addressLine2?: string | null;
    suburb?: string | null;
    state?: string | null;
    postcode?: string | null;
    code?: string | null;
  };
  headers: Record<string, string>;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [addressLine1, setAddressLine1] = useState(location.addressLine1 ?? '');
  const [addressLine2, setAddressLine2] = useState(location.addressLine2 ?? '');
  const [suburb, setSuburb] = useState(location.suburb ?? '');
  const [state, setState] = useState(location.state ?? '');
  const [postcode, setPostcode] = useState(location.postcode ?? '');
  const [code, setCode] = useState(location.code ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/organisations/locations/${location.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ addressLine1, addressLine2, suburb, state, postcode, code }),
      });
      if (!res.ok) throw new Error(await refusal(res));
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.decision}>
      <p className={styles.cardNote}>{strings.locations.editBody}</p>

      <Field label={strings.locations.editLine1} required>
        {(props) => (
          <TextInput
            {...props}
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            data-testid={`edit-line1-${location.id}`}
          />
        )}
      </Field>
      <Field label={strings.locations.editLine2}>
        {(props) => <TextInput {...props} value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />}
      </Field>
      <Field label={strings.locations.editSuburb} required>
        {(props) => <TextInput {...props} value={suburb} onChange={(e) => setSuburb(e.target.value)} />}
      </Field>
      <Field label={strings.locations.editState} hint={strings.locations.editStateHint} required>
        {(props) => <TextInput {...props} value={state} onChange={(e) => setState(e.target.value)} />}
      </Field>
      <Field label={strings.locations.editPostcode} required>
        {(props) => <TextInput {...props} value={postcode} onChange={(e) => setPostcode(e.target.value)} />}
      </Field>
      <Field label={strings.locations.editCode} hint={strings.locations.editCodeHint}>
        {(props) => <TextInput {...props} value={code} onChange={(e) => setCode(e.target.value)} />}
      </Field>

      <div className={ui.rowActions}>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={busy || !addressLine1.trim() || !suburb.trim() || !state.trim() || !postcode.trim()}
          data-testid={`edit-save-${location.id}`}
        >
          <Pencil size={15} aria-hidden="true" />
          {busy ? strings.locations.working : strings.locations.editSave}
        </Button>
        <Button variant="subtle" onClick={onCancel}>
          <X size={15} aria-hidden="true" />
          {strings.locations.confirmCancel}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.locations.editFailed}>
          {error}
        </Notice>
      )}
    </div>
  );
}

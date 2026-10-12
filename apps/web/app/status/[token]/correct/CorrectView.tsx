'use client';
import { SessionControl } from '../../../SessionControl';

/**
 * The applicant's correction form.
 *
 * A typo in a phone number should not cost somebody a rejection and a fresh
 * application. But this is an edit to evidence, so three things are visible on
 * the screen rather than merely true underneath it:
 *
 *   1. WHAT CANNOT CHANGE, and why. The ABN is shown, locked, with the reason
 *      stated — every check runs against one legal entity, so a different ABN
 *      is a different application. Hiding the field would leave the applicant
 *      hunting for it; showing it greyed with no explanation would read as a
 *      bug.
 *   2. WHAT WILL BE RECORDED. The changes are listed back before submitting,
 *      because "I did not realise it would keep the old one" is not a
 *      conversation worth having about an audit trail.
 *   3. THAT SOMEBODY WILL SEE IT. An amendment does not restart the review and
 *      does not undo a check; it tells the reviewer what moved.
 *
 * Only fields the applicant actually TOUCHED are sent. Posting the whole form
 * back would record sixteen amendments of which fifteen are the same value —
 * and, before this was fixed, wiped every field the caller had not named.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Lock, Send } from 'lucide-react';
import { AU_STATES, contactClash } from '@aobplatform/domain';
import { Button, Field, Notice, Section, SelectInput, Shell, TextInput, ui } from '../../../ui';
import { strings } from '../../../strings';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Values = Record<string, string>;

interface Payload {
  reference: string;
  state: string;
  amendable: boolean;
  correctionExpiresAt: string | null;
  correctionReason: string | null;
  correctionRequestedByName: string | null;
  locked: { abn: string; legalName: string; entityType: string; abnStatus: string };
  values: Record<string, string | number | null>;
}

const FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'name', label: 'Practice name' },
  { key: 'website', label: 'Practice website' },
  { key: 'adminName', label: 'Your full name' },
  { key: 'adminEmail', label: 'Your email' },
  { key: 'adminPhone', label: 'Your direct phone' },
  { key: 'adminPosition', label: 'Your position' },
  { key: 'managerName', label: 'Second contact — full name' },
  { key: 'managerEmail', label: 'Second contact — email' },
  { key: 'managerPhone', label: 'Second contact — direct phone' },
  { key: 'managerPosition', label: 'Second contact — position' },
  { key: 'headOfficeLine1', label: 'Head office — address' },
  { key: 'headOfficeLine2', label: 'Head office — unit / level' },
  { key: 'headOfficeSuburb', label: 'Head office — suburb' },
  { key: 'headOfficePostcode', label: 'Head office — postcode' },
];

export function CorrectView({ token }: { token: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [values, setValues] = useState<Values>({});
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);

  useEffect(() => {
    fetch(`${CORE_URL}/applications/${token}/application`)
      .then((r) => {
        if (r.status === 404) {
          setMissing(true);
          return null;
        }
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((data: Payload | null) => {
        if (!data) return;
        setPayload(data);
        const initial: Values = {};
        for (const field of FIELDS) initial[field.key] = String(data.values[field.key] ?? '');
        initial.headOfficeState = String(data.values.headOfficeState ?? '');
        initial.statedPractitionerCount = String(data.values.statedPractitionerCount ?? '');
        setValues(initial);
      })
      .catch((e: Error) => setError(e instanceof TypeError ? strings.status.unreachable : e.message));
  }, [token]);

  // What actually moved. Computed the same way the server computes it, so the
  // list shown to the applicant is the list that gets recorded.
  const changed = useMemo(() => {
    if (!payload) return [];
    return Object.keys(values).filter((key) => {
      const before = String(payload.values[key] ?? '').trim();
      return values[key].trim() !== before;
    });
  }, [values, payload]);

  const clash = contactClash({
    adminEmail: values.adminEmail ?? '',
    adminPhone: values.adminPhone ?? '',
    managerEmail: values.managerEmail,
    managerPhone: values.managerPhone,
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // ONLY the touched fields. Sending the whole form back is what destroyed
      // an application the first time this ran.
      const body: Record<string, string | number> = {};
      for (const key of changed) {
        body[key] = key === 'statedPractitionerCount' ? Number(values[key]) : values[key];
      }
      const response = await fetch(`${CORE_URL}/applications/${token}/amend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const b = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? `That was refused (${response.status}).`);
      }
      const result = (await response.json()) as { changed: string[] };
      setDone(result.changed);
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <Shell right={<SessionControl audience={strings.status.audience} />}
      title={strings.status.notFound}
      lead={strings.status.notFoundBody}
    >
      </Shell>
    );
  }

  if (!payload) {
    return (
      <Shell right={<SessionControl audience={strings.status.audience} />}
      title={strings.status.correctedTitle}
      lead={strings.status.correctedBody}
    >
        {error ? (
          <Notice tone="stop" title={strings.status.notLoaded}>
            {error}
          </Notice>
        ) : (
          <p className={ui.hint}>{strings.review.loading}</p>
        )}
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell right={<SessionControl audience={strings.status.audience} />}
      title={strings.status.correctTitle}
      lead={strings.status.correctLead}
    >
        <Link href={`/status/${token}`} className={ui.buttonLink}>
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.status.backToStatus}
        </Link>
      </Shell>
    );
  }

  /*
   * Three reasons this form might not be usable, and they are NOT the same
   * thing. Collapsing them into "closed" told an applicant whose application
   * was merely waiting that it had been decided — wrong, and alarming.
   *
   *   decided  → closed for good; the decision was emailed
   *   expired  → the link aged out; the application is untouched
   *   no window→ nothing has been asked for yet; this is the normal state
   */
  if (!payload.amendable) {
    const decided = payload.state !== 'pending';
    const expiry = payload.correctionExpiresAt ? new Date(payload.correctionExpiresAt) : null;
    const expired = !decided && expiry !== null && expiry.getTime() <= Date.now();

    return (
      <Shell right={<SessionControl audience={strings.status.audience} />}>
        <Link href={`/status/${token}`} className={ui.pageBackLink}>
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.status.backToStatus}
        </Link>
        <h1 className={ui.pageTitle}>
          {decided
            ? strings.status.closedTitle
            : expired
              ? strings.status.expiredTitle
              : strings.status.notOpenTitle}
        </h1>
        <p className={ui.pageLead}>
          {decided ? strings.status.closedBody : expired ? strings.status.expiredBody : strings.status.notOpenBody}
        </p>
        {expired && expiry && (
          <p className={ui.hint}>
            {strings.status.expiredOn} {expiry.toISOString().slice(0, 10)}.
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.status.audience} />}>
      <Link href={`/status/${token}`} className={ui.pageBackLink}>
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.status.backToStatus}
      </Link>

      {/* What the reviewer actually asked for, in their words. Without this the
          applicant has a form and no idea which field is the problem. */}
      {payload.correctionReason && (
        <Notice tone="warn" title={strings.status.correctionAsked}>
          {payload.correctionReason}
          {payload.correctionRequestedByName && (
            <>
              {' '}
              — {strings.status.correctionAskedBy} {payload.correctionRequestedByName}.
            </>
          )}
          {payload.correctionExpiresAt && (
            <>
              {' '}
              {strings.status.correctionCloses}{' '}
              {new Date(payload.correctionExpiresAt).toISOString().slice(0, 10)}.
            </>
          )}
        </Notice>
      )}

      {error && (
        <Notice tone="stop" title={strings.status.notSaved}>
          {error}
        </Notice>
      )}

      <Section number={1} title={strings.status.lockedHeading} aside={<Lock size={16} aria-hidden="true" />}>
        <p className={ui.hint} style={{ marginBottom: 'var(--s3)' }}>
          {strings.status.lockedWhy}
        </p>
        <dl className={ui.facts}>
          <dt>ABN</dt>
          <dd className={ui.mono}>{payload.locked.abn}</dd>
          <dt>{strings.review.legalName}</dt>
          <dd>{payload.locked.legalName}</dd>
          <dt>{strings.review.entityType}</dt>
          <dd>{payload.locked.entityType}</dd>
        </dl>
      </Section>

      <Section number={2} title={strings.status.correctableHeading}>
        <div className={ui.grid2}>
          {FIELDS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              hint={field.hint}
              error={
                (field.key === 'managerEmail' && clash === 'email') ||
                (field.key === 'managerPhone' && clash === 'phone')
                  ? strings.apply.contactClash[clash]
                  : null
              }
            >
              {(props) => (
                <TextInput
                  {...props}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  data-testid={`correct-${field.key}`}
                />
              )}
            </Field>
          ))}
          <Field label="Head office — state">
            {(props) => (
              <SelectInput
                {...props}
                value={values.headOfficeState ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, headOfficeState: e.target.value }))}
                data-testid="correct-headOfficeState"
              >
                <option value="">—</option>
                {AU_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="How many practitioners">
            {(props) => (
              <TextInput
                {...props}
                value={values.statedPractitionerCount ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, statedPractitionerCount: e.target.value }))}
                data-testid="correct-statedPractitionerCount"
              />
            )}
          </Field>
        </div>
      </Section>

      {/* Listed back before sending. An audit trail should hold no surprises. */}
      <Section number={3} title={strings.status.whatChanges}>
        {changed.length === 0 ? (
          <p className={ui.hint}>{strings.status.nothingChanged}</p>
        ) : (
          <ul className={ui.plainList}>
            {changed.map((key) => (
              <li key={key}>
                <strong>{FIELDS.find((f) => f.key === key)?.label ?? key}</strong>:{' '}
                <span className={ui.mono}>{String(payload.values[key] ?? '—')}</span> →{' '}
                <span className={ui.mono}>{values[key] || '—'}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={ui.hint} style={{ marginTop: 'var(--s3)' }}>
          {strings.status.amendmentIsRecorded}
        </p>

        <div className={ui.rowActions}>
          <Button
            variant="primary"
            disabled={changed.length === 0 || clash !== null || busy}
            onClick={submit}
            data-testid="correct-submit"
          >
            <Send size={15} aria-hidden="true" />
            {busy ? strings.status.sending : strings.status.send}
          </Button>
          {clash !== null && <span className={ui.hint}>{strings.apply.contactClash[clash]}</span>}
        </div>
      </Section>
    </Shell>
  );
}

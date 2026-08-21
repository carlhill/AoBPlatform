'use client';

/**
 * Frame 01 — Apply, entity details.
 *
 * The four refusal forms this screen must keep distinct, because using the
 * wrong one is the likeliest mistake here:
 *
 *   INLINE      a mistyped ABN. Arithmetic, fixable in seconds, and the submit
 *               goes dead. Nothing is sent, so nothing needs undoing.
 *   BLOCKING    the ABR says CANCELLED, or the name matches nothing registered.
 *               The ENTITY is wrong; no amount of retyping fixes that, so the
 *               screen stops rather than nags.
 *   DEGRADE     the ABR cannot be reached. Never a block — an attestation panel
 *               appears and a named human types what the register shows.
 *   DOSSIER     the applicant cannot be verified. Not this screen's business at
 *               all; that is a judgement, and it belongs to the reviewer.
 */

import { useMemo, useState } from 'react';
import { isValidAbnChecksum, normaliseAbn, AU_STATES } from '@aobplatform/domain';
import { strings } from '../strings';
import { Button, Checkbox, Chip, Field, Notice, Section, SelectInput, Shell, TextInput, ui, BlockingRefusal } from '../ui';
import { GateLedger, type GateLedgerState } from './GateLedger';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Proof {
  credentialType: string;
  credentialValue: string;
}

const CREDENTIAL_TYPES = [
  { value: 'ahpra', label: 'AHPRA number of a responsible practitioner' },
  { value: 'hpio', label: 'HPI-O' },
  { value: 'accreditation', label: 'Practice accreditation reference' },
  { value: 'nash', label: 'NASH certificate' },
  { value: 'other', label: 'Other' },
];

const ENTITY_TYPES = [
  { value: 'PTY_LTD', label: 'PTY_LTD — “Australian Private Company”' },
  { value: 'PUBLIC_COMPANY', label: 'PUBLIC_COMPANY — “Australian Public Company”' },
  { value: 'INDIVIDUAL_SOLE_TRADER', label: 'INDIVIDUAL_SOLE_TRADER — “Individual/Sole Trader”' },
  { value: 'TRUST', label: 'TRUST — “The trustee for …”' },
  { value: 'PARTNERSHIP', label: 'PARTNERSHIP' },
  { value: 'OTHER', label: 'OTHER' },
];

export function ApplyForm() {
  const [name, setName] = useState('');
  const [abn, setAbn] = useState('');
  const [website, setWebsite] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [suburb, setSuburb] = useState('');
  const [state, setState] = useState('');
  const [postcode, setPostcode] = useState('');
  const [isPlaceOfPractice, setIsPlaceOfPractice] = useState(false);
  const [practitionerCount, setPractitionerCount] = useState('');

  const [proofs, setProofs] = useState<Proof[]>([{ credentialType: '', credentialValue: '' }]);

  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPosition, setAdminPosition] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [managerPosition, setManagerPosition] = useState('');

  // The attestation panel, shown ONLY once the register has actually failed to
  // answer. Offering it up front would invite people to bypass a working check.
  const [needsAttestation, setNeedsAttestation] = useState(false);
  const [attLegalName, setAttLegalName] = useState('');
  const [attTradingNames, setAttTradingNames] = useState('');
  const [attStatus, setAttStatus] = useState('ACTIVE');
  const [attEntityType, setAttEntityType] = useState('');
  const [attSightedBy, setAttSightedBy] = useState('');

  const [blocking, setBlocking] = useState<{ title: string; body: string } | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentReference, setSentReference] = useState<string | null>(null);

  // Run on every keystroke, because it costs nothing and the answer is certain.
  const abnDigits = normaliseAbn(abn);
  const abnTouched = abnDigits.length >= 11;
  const abnValid = abnTouched && isValidAbnChecksum(abnDigits);
  const abnError = abnTouched && !abnValid ? strings.apply.abnInvalid : null;

  const managerClash =
    managerEmail.trim().length > 0 && managerEmail.trim().toLowerCase() === adminEmail.trim().toLowerCase();

  const gates: GateLedgerState = useMemo(
    () => ({
      checksum: !abnTouched ? 'not_run' : abnValid ? 'passed' : 'failed',
      register: sentReference ? 'passed' : needsAttestation ? 'waiting' : 'not_run',
      human: sentReference ? 'waiting' : 'not_run',
      registerDetail: needsAttestation ? strings.apply.attestLead : undefined,
    }),
    [abnTouched, abnValid, needsAttestation, sentReference],
  );

  const complete =
    name.trim().length > 1 &&
    abnValid &&
    line1.trim() &&
    suburb.trim() &&
    state &&
    /^\d{4}$/.test(postcode.trim()) &&
    adminName.trim() &&
    adminEmail.trim() &&
    adminPhone.trim() &&
    !managerClash &&
    (!needsAttestation || (attLegalName.trim() && attEntityType && attSightedBy.trim()));

  async function submit() {
    setBusy(true);
    setInlineError(null);
    try {
      const response = await fetch(`${CORE_URL}/organisations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          abn,
          website: website.trim() || undefined,
          adminName,
          adminEmail,
          adminPhone,
          adminPosition: adminPosition.trim() || undefined,
          managerName: managerName.trim() || undefined,
          managerEmail: managerEmail.trim() || undefined,
          managerPhone: managerPhone.trim() || undefined,
          managerPosition: managerPosition.trim() || undefined,
          headOfficeLine1: line1,
          headOfficeLine2: line2.trim() || undefined,
          headOfficeSuburb: suburb,
          headOfficeState: state,
          headOfficePostcode: postcode,
          headOfficeIsPlaceOfPractice: isPlaceOfPractice,
          statedPractitionerCount: practitionerCount ? Number(practitionerCount) : undefined,
          credentialType: proofs[0]?.credentialType || undefined,
          credentialValue: proofs[0]?.credentialValue || undefined,
          abrAttestation: needsAttestation
            ? {
                legalName: attLegalName,
                businessNames: attTradingNames.split(',').map((n) => n.trim()).filter(Boolean),
                abnStatus: attStatus,
                entityType: attEntityType,
                sightedByName: attSightedBy,
              }
            : undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? 'Unknown error');
        // The refusal grammar, applied. Which form is used is decided by WHAT
        // failed, never by convenience.
        if (/no ABN lookup is configured/i.test(message)) {
          setNeedsAttestation(true);
          setInlineError(null);
        } else if (/not ACTIVE|CANCELLED/i.test(message)) {
          setBlocking({ title: strings.apply.cancelledTitle, body: message });
        } else if (/does not match any name registered/i.test(message)) {
          setBlocking({ title: strings.apply.nameMismatchTitle, body: message });
        } else {
          setInlineError(message);
        }
        return;
      }
      setSentReference(body.id);
    } catch (err) {
      setInlineError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sentReference) {
    return (
      <Shell right={strings.apply.audience}>
        <h1 className={ui.pageTitle}>{strings.apply.sentTitle}</h1>
        <p className={ui.pageLead}>{strings.apply.sentBody}</p>
        <GateLedger state={gates} />
        <p className={ui.hint}>
          {strings.apply.sentReference}: <span className={ui.mono}>{sentReference}</span>
        </p>
      </Shell>
    );
  }

  return (
    <Shell right={strings.apply.audience}>
      <h1 className={ui.pageTitle}>{strings.apply.title}</h1>
      <p className={ui.pageLead}>{strings.apply.lead}</p>

      <GateLedger state={gates} />

      {inlineError && <Notice tone="stop">{inlineError}</Notice>}

      <Section number={1} title={strings.apply.entityHeading}>
        <div className={ui.grid2}>
          <Field label={strings.apply.practiceName} hint={strings.apply.practiceNameHint} required>
            {(props) => (
              <TextInput {...props} value={name} onChange={(e) => setName(e.target.value)} data-testid="apply-name" />
            )}
          </Field>
          <Field label={strings.apply.abn} hint={strings.apply.abnHint} error={abnError} required>
            {(props) => (
              <TextInput
                {...props}
                value={abn}
                onChange={(e) => setAbn(e.target.value)}
                inputMode="numeric"
                data-testid="apply-abn"
              />
            )}
          </Field>
        </div>

        <p className={ui.hint} style={{ marginBottom: 8 }}>
          {strings.apply.headOfficeHint}
        </p>
        <div className={ui.grid2}>
          <Field label={strings.apply.headOfficeHeading} required>
            {(props) => (
              <TextInput {...props} value={line1} onChange={(e) => setLine1(e.target.value)} data-testid="apply-line1" />
            )}
          </Field>
          <Field label="Unit / level">
            {(props) => <TextInput {...props} value={line2} onChange={(e) => setLine2(e.target.value)} />}
          </Field>
        </div>
        <div className={ui.grid3}>
          <Field label="Suburb" required>
            {(props) => (
              <TextInput {...props} value={suburb} onChange={(e) => setSuburb(e.target.value)} data-testid="apply-suburb" />
            )}
          </Field>
          <Field label="State" required>
            {(props) => (
              <SelectInput {...props} value={state} onChange={(e) => setState(e.target.value)} data-testid="apply-state">
                <option value="">—</option>
                {AU_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="Postcode" required>
            {(props) => (
              <TextInput
                {...props}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                inputMode="numeric"
                maxLength={4}
                data-testid="apply-postcode"
              />
            )}
          </Field>
        </div>

        <Checkbox
          checked={isPlaceOfPractice}
          onCheckedChange={setIsPlaceOfPractice}
          label={strings.apply.headOfficeIsPop}
          hint={strings.apply.headOfficeIsPopHint}
        />

        <div className={ui.grid2}>
          <Field label={strings.apply.practitionerCount} hint={strings.apply.practitionerCountHint}>
            {(props) => (
              <TextInput
                {...props}
                value={practitionerCount}
                onChange={(e) => setPractitionerCount(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                data-testid="apply-count"
              />
            )}
          </Field>
          <Field label={strings.apply.website} hint={strings.apply.websiteHint}>
            {(props) => (
              <TextInput {...props} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            )}
          </Field>
        </div>
      </Section>

      <Section number={2} title={strings.apply.proofHeading} aside={<Chip>{proofs.length} added</Chip>}>
        <p className={ui.hint} style={{ marginBottom: 12 }}>
          {strings.apply.proofLead} {strings.apply.proofNone}
        </p>
        {proofs.map((proof, index) => (
          <div className={ui.repeatRow} key={index}>
            <Field label={strings.apply.credentialType}>
              {(props) => (
                <SelectInput
                  {...props}
                  value={proof.credentialType}
                  data-testid={`apply-proof-type-${index}`}
                  onChange={(e) =>
                    setProofs(proofs.map((p, i) => (i === index ? { ...p, credentialType: e.target.value } : p)))
                  }
                >
                  <option value="">—</option>
                  {CREDENTIAL_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label={strings.apply.credentialValue}>
              {(props) => (
                <TextInput
                  {...props}
                  value={proof.credentialValue}
                  data-testid={`apply-proof-value-${index}`}
                  onChange={(e) =>
                    setProofs(proofs.map((p, i) => (i === index ? { ...p, credentialValue: e.target.value } : p)))
                  }
                />
              )}
            </Field>
            <Button
              onClick={() => setProofs(proofs.filter((_, i) => i !== index))}
              disabled={proofs.length === 1}
              aria-label={`${strings.apply.removeProof} ${index + 1}`}
            >
              {strings.apply.removeProof}
            </Button>
          </div>
        ))}
        <Button
          variant="subtle"
          onClick={() => setProofs([...proofs, { credentialType: '', credentialValue: '' }])}
          data-testid="apply-add-proof"
        >
          {strings.apply.addProof}
        </Button>
      </Section>

      <Section number={3} title={strings.apply.contactsHeading}>
        <p className={ui.hint} style={{ marginBottom: 12 }}>
          {strings.apply.contactsLead}
        </p>

        <h3 className={ui.label} style={{ marginBottom: 8 }}>
          {strings.apply.you}
        </h3>
        <div className={ui.grid2}>
          <Field label={strings.apply.fullName} required>
            {(props) => (
              <TextInput
                {...props}
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                data-testid="apply-admin-name"
              />
            )}
          </Field>
          <Field label={strings.apply.emailLabel} hint={strings.apply.adminEmailHint} required>
            {(props) => (
              <TextInput
                {...props}
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                data-testid="apply-admin-email"
              />
            )}
          </Field>
          <Field label={strings.apply.phone} required>
            {(props) => (
              <TextInput
                {...props}
                value={adminPhone}
                onChange={(e) => setAdminPhone(e.target.value)}
                data-testid="apply-admin-phone"
              />
            )}
          </Field>
          <Field label={strings.apply.position}>
            {(props) => <TextInput {...props} value={adminPosition} onChange={(e) => setAdminPosition(e.target.value)} />}
          </Field>
        </div>

        <h3 className={ui.label} style={{ margin: '16px 0 8px' }}>
          {strings.apply.yourManager}
        </h3>
        <p className={ui.hint} style={{ marginBottom: 8 }}>
          {strings.apply.soleTraderHint}
        </p>
        <div className={ui.grid2}>
          <Field label={strings.apply.fullName}>
            {(props) => (
              <TextInput
                {...props}
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
                data-testid="apply-manager-name"
              />
            )}
          </Field>
          <Field
            label={strings.apply.emailLabel}
            error={managerClash ? strings.apply.managerSameEmail : null}
          >
            {(props) => (
              <TextInput
                {...props}
                type="email"
                value={managerEmail}
                onChange={(e) => setManagerEmail(e.target.value)}
                data-testid="apply-manager-email"
              />
            )}
          </Field>
          <Field label={strings.apply.phone}>
            {(props) => <TextInput {...props} value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} />}
          </Field>
          <Field label={strings.apply.position}>
            {(props) => (
              <TextInput {...props} value={managerPosition} onChange={(e) => setManagerPosition(e.target.value)} />
            )}
          </Field>
        </div>
      </Section>

      {needsAttestation && (
        <Section number={4} title={strings.apply.attestHeading}>
          <p className={ui.hint} style={{ marginBottom: 12 }}>
            {strings.apply.attestLead}
          </p>
          <p>
            <a
              href={`https://abr.business.gov.au/ABN/View?abn=${encodeURIComponent(abnDigits)}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {strings.apply.attestOpen}
            </a>
          </p>
          <div className={ui.grid2}>
            <Field label={strings.apply.attestLegalName} required>
              {(props) => (
                <TextInput
                  {...props}
                  value={attLegalName}
                  onChange={(e) => setAttLegalName(e.target.value)}
                  data-testid="apply-att-legal-name"
                />
              )}
            </Field>
            <Field label={strings.apply.attestTradingNames}>
              {(props) => (
                <TextInput {...props} value={attTradingNames} onChange={(e) => setAttTradingNames(e.target.value)} />
              )}
            </Field>
            <Field label={strings.apply.attestStatus} required>
              {(props) => (
                <SelectInput {...props} value={attStatus} onChange={(e) => setAttStatus(e.target.value)}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="CANCELLED">CANCELLED</option>
                </SelectInput>
              )}
            </Field>
            <Field label={strings.apply.attestEntityType} hint={strings.apply.attestEntityTypeHint} required>
              {(props) => (
                <SelectInput
                  {...props}
                  value={attEntityType}
                  onChange={(e) => setAttEntityType(e.target.value)}
                  data-testid="apply-att-entity-type"
                >
                  <option value="">—</option>
                  {ENTITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>
          <Field label={strings.apply.attestSightedBy} required>
            {(props) => (
              <TextInput
                {...props}
                value={attSightedBy}
                onChange={(e) => setAttSightedBy(e.target.value)}
                data-testid="apply-att-sighted-by"
              />
            )}
          </Field>
        </Section>
      )}

      <div className={ui.rowActions}>
        <Button variant="primary" disabled={!complete || busy} onClick={() => void submit()} data-testid="apply-submit">
          {busy ? strings.apply.submitting : strings.apply.submit}
        </Button>
        {!complete && <span className={ui.hint}>{strings.apply.submitDisabled}</span>}
      </div>

      <BlockingRefusal
        open={Boolean(blocking)}
        onOpenChange={(open) => !open && setBlocking(null)}
        title={blocking?.title ?? ''}
        actions={
          <Button variant="primary" onClick={() => setBlocking(null)}>
            {strings.apply.cancelledClose}
          </Button>
        }
      >
        <p className={ui.noticeBody}>{blocking?.body}</p>
        <ul style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-muted)', marginTop: 12 }}>
          <li>{strings.apply.cancelledFixOne}</li>
          <li>{strings.apply.cancelledFixTwo}</li>
        </ul>
      </BlockingRefusal>
    </Shell>
  );
}

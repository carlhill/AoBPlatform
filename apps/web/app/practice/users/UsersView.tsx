'use client';

/**
 * The practice's own people.
 *
 * WHY A PRACTICE NEEDS THIS. Until now the only account a practice had was the
 * single administrator, so every act by everybody there was attributed to one
 * shared login — which is not an audit trail, it is a shrug. Reports, status
 * views and recertification all want to say WHO looked and WHO answered.
 *
 * THE CAPS ARE SHOWN BEFORE THEY BITE. Five people per scope instance, and the
 * remaining count sits beside each place somebody can be added. A limit
 * discovered by hitting it reads as a bug; a limit shown while there is still
 * room reads as a rule.
 *
 * DEACTIVATE, NEVER DELETE, and the screen says so where the button is.
 * Somebody who approved or confirmed something must stay identifiable for as
 * long as that record matters, which is longer than their employment.
 *
 * PASSKEYS ARE NOT MANAGED HERE. They are managed by their owner, in Keycloak's
 * Account Console, in a session already proved by an existing credential —
 * which is the industry answer to "an emailed link can bootstrap a credential"
 * and is stronger than anything this screen could offer. The link out is the
 * feature.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, RotateCcw, UserMinus, UserPlus } from 'lucide-react';
import { Button, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { isPlatformOperator } from '@aobplatform/domain';
import { SessionControl } from '../../SessionControl';
import { apiHeaders, currentSession } from '../../auth';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import { PracticePicker } from '../PracticePicker';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const KEYCLOAK_ACCOUNT =
  process.env.NEXT_PUBLIC_KEYCLOAK_ACCOUNT_URL ??
  'http://localhost:21024/realms/aobplatform/account/#/security/signingin';

interface User {
  id: string;
  name: string;
  email: string | null;
  role: string;
  consoleRole: string | null;
  locationId: string | null;
  departmentId: string | null;
  scope: string;
  invitedAt: string | null;
  lastSignInAt: string | null;
  deactivatedAt: string | null;
  deactivatedReason: string | null;
  deactivatedByName: string | null;
  status: { key: string; label: string; tone: 'ok' | 'warn' | 'stop' | 'muted' };
}

interface Scope {
  key: string;
  label: string;
  locationId: string | null;
  departmentId: string | null;
  used: number;
  limit: number;
  remaining: number;
}

interface Listing {
  users: User[];
  scopes: Scope[];
  admin: { id: string; name: string; email: string | null; maxPasskeys: number } | null;
}

export function UsersView() {
  const { practiceId, checked } = usePractice();
  /*
   * A PLATFORM OPERATOR HAS NO PRACTICE CLAIM, so this screen was
   * rendering an empty list with no error and no way forward — which
   * looks exactly like "there is nothing here" and was not.
   */
  const [chosen, setChosen] = useState('');
  const isOperator = isPlatformOperator({ roles: currentSession()?.roles ?? [] });
  const scope = practiceId ?? chosen;
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!scope) return;
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practice-users`, { headers: apiHeaders(scope) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Your people could not be listed (${res.status}).`);
      }
      setListing(await res.json());
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!checked) return null;

  if (!scope) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{strings.users.title}</h1>
        <PracticePicker value={chosen} onChange={setChosen} isOperator={isOperator} />
      </Shell>
    );
  }

  const active = (listing?.users ?? []).filter((u) => u.consoleRole && !u.deactivatedAt);
  const withdrawn = (listing?.users ?? []).filter((u) => u.deactivatedAt);
  const noAccess = (listing?.users ?? []).filter((u) => !u.consoleRole && !u.deactivatedAt);

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <Link href="/practice/setup" className={ui.backLink} data-testid="users-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.queue.back}
      </Link>
      <h1 className={ui.pageTitle}>{strings.users.title}</h1>
      <p className={`${ui.pageLead} ${styles.queueLead}`}>{strings.users.lead}</p>

      {error && (
        <Notice tone="stop" title={strings.users.notLoaded}>
          {error}
        </Notice>
      )}

      {/*
        THE CAPS, BEFORE THEY BITE. Shown as remaining rather than used,
        because "two places left" is the number somebody about to add a person
        actually wants.
      */}
      {listing && listing.scopes.length > 0 && (
        <div className={styles.scopeBar}>
          {listing.scopes.map((s) => (
            <Chip key={s.key} tone={s.remaining === 0 ? 'stop' : s.remaining <= 1 ? 'warn' : 'neutral'}>
              {s.label}: {s.remaining} {strings.users.placesLeft}
            </Chip>
          ))}
        </div>
      )}

      {/*
        THE ADMINISTRATOR, called out. It is the practice's account rather than
        a person's, which is what makes succession work when an administrator
        leaves suddenly — and it is the thing people misunderstand first.
      */}
      {listing?.admin && (
        <section className={styles.adminPanel}>
          <h2 className={styles.applicationHeading}>{strings.users.adminTitle}</h2>
          <p className={ui.hint}>{strings.users.adminBody}</p>
          <p className={styles.cardNote}>
            <strong>{listing.admin.name}</strong> · {listing.admin.email}
          </p>
          <a href={KEYCLOAK_ACCOUNT} target="_blank" rel="noreferrer" className={ui.buttonLink}>
            <KeyRound size={15} aria-hidden="true" />
            {strings.users.managePasskeys}
          </a>
          <p className={ui.hint}>
            {strings.users.passkeyNote.replace('{n}', String(listing.admin.maxPasskeys))}
          </p>
        </section>
      )}

      <h2 className={styles.applicationHeading}>{strings.users.withAccess}</h2>
      {active.length === 0 && <p className={ui.hint}>{strings.users.nobodyYet}</p>}
      <ul className={styles.reviewList}>
        {active.map((u) => (
          <UserRow key={u.id} user={u} practiceId={scope} onDone={load} />
        ))}
      </ul>

      {noAccess.length > 0 && (
        <>
          <h2 className={styles.applicationHeading}>{strings.users.onStaffNoAccess}</h2>
          <p className={ui.hint}>{strings.users.onStaffNote}</p>
          <ul className={styles.reviewList}>
            {noAccess.map((u) => (
              <UserRow key={u.id} user={u} practiceId={scope} onDone={load} />
            ))}
          </ul>
        </>
      )}

      {withdrawn.length > 0 && (
        <>
          <h2 className={styles.applicationHeading}>{strings.users.withdrawn}</h2>
          <p className={ui.hint}>{strings.users.withdrawnNote}</p>
          <ul className={styles.reviewList}>
            {withdrawn.map((u) => (
              <UserRow key={u.id} user={u} practiceId={scope} onDone={load} />
            ))}
          </ul>
        </>
      )}

      <AddUser practiceId={scope} scopes={listing?.scopes ?? []} onDone={load} />
    </Shell>
  );
}

function UserRow({ user, practiceId, onDone }: { user: User; practiceId: string; onDone: () => void | Promise<void> }) {
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practice-users/${user.id}/${path}`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(b.message ?? `That failed (${res.status}).`);
      }
      setConfirming(false);
      setReason('');
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.reviewCard}>
      <div className={styles.reviewHead}>
        <span className={styles.reviewKind}>{user.name}</span>
        <Chip tone={user.status.tone === 'muted' ? 'neutral' : user.status.tone}>{user.status.label}</Chip>
        {user.consoleRole && <Chip tone="neutral">{user.consoleRole}</Chip>}
        <span className={styles.queueWhen}>{user.email}</span>
      </div>

      {user.deactivatedAt ? (
        <>
          <p className={styles.cardNote}>
            {strings.users.withdrawnBy} {user.deactivatedByName} — {user.deactivatedReason}
          </p>
          <Button onClick={() => void act('reactivate')} disabled={busy} data-testid={`reactivate-${user.id}`}>
            <RotateCcw size={14} aria-hidden="true" />
            {strings.users.restore}
          </Button>
        </>
      ) : (
        user.consoleRole && (
          <div className={styles.reviewActions}>
            {confirming ? (
              <>
                <Field label={strings.users.whyWithdraw} hint={strings.users.whyWithdrawHint} required>
                  {(props) => (
                    <TextInput
                      {...props}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      data-testid={`reason-${user.id}`}
                    />
                  )}
                </Field>
                <Button
                  variant="primary"
                  onClick={() => void act('deactivate', { reason: reason.trim() })}
                  disabled={busy || !reason.trim()}
                  data-testid={`deactivate-${user.id}`}
                >
                  {busy ? strings.users.withdrawing : strings.users.confirmWithdraw}
                </Button>
                <Button variant="subtle" onClick={() => setConfirming(false)}>
                  {strings.locations.confirmCancel}
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirming(true)} data-testid={`withdraw-${user.id}`}>
                <UserMinus size={14} aria-hidden="true" />
                {strings.users.withdraw}
              </Button>
            )}
          </div>
        )
      )}

      {error && (
        <Notice tone="stop" title={strings.users.actionFailed}>
          {error}
        </Notice>
      )}
    </li>
  );
}

function AddUser({
  practiceId,
  scopes,
  onDone,
}: {
  practiceId: string;
  scopes: Scope[];
  onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consoleRole, setConsoleRole] = useState('other');
  const [scopeKey, setScopeKey] = useState('organisation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenScope = scopes.find((s) => s.key === scopeKey);
  const ready = name.trim().length > 1 && email.trim().length > 3;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practice-users`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          consoleRole,
          locationId: chosenScope?.locationId ?? undefined,
          departmentId: chosenScope?.departmentId ?? undefined,
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const message = Array.isArray(b.message) ? b.message.join(', ') : b.message;
        throw new Error(message ?? `That failed (${res.status}).`);
      }
      setName('');
      setEmail('');
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.applicationSection}>
      <h2 className={styles.applicationHeading}>{strings.users.addTitle}</h2>
      <p className={ui.hint}>{strings.users.addBody}</p>

      <div className={styles.applicationFields}>
        <Field label={strings.users.addName} required>
          {(props) => (
            <TextInput {...props} value={name} onChange={(e) => setName(e.target.value)} data-testid="add-name" />
          )}
        </Field>
        <Field label={strings.users.addEmail} hint={strings.users.addEmailHint} required>
          {(props) => (
            <TextInput
              {...props}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="add-email"
            />
          )}
        </Field>
        <Field label={strings.users.addRole} hint={strings.users.addRoleHint}>
          {(props) => (
            <SelectInput
              {...props}
              value={consoleRole}
              onChange={(e) => setConsoleRole(e.target.value)}
              data-testid="add-role"
            >
              <option value="other">{strings.users.roleOther}</option>
              <option value="admin">{strings.users.roleAdmin}</option>
            </SelectInput>
          )}
        </Field>
        <Field label={strings.users.addScope} hint={strings.users.addScopeHint}>
          {(props) => (
            <SelectInput
              {...props}
              value={scopeKey}
              onChange={(e) => setScopeKey(e.target.value)}
              data-testid="add-scope"
            >
              {scopes.map((s) => (
                <option key={s.key} value={s.key} disabled={s.remaining === 0}>
                  {s.label} ({s.remaining} {strings.users.placesLeft})
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
      </div>

      <div className={ui.rowActions}>
        <Button variant="primary" onClick={() => void submit()} disabled={!ready || busy} data-testid="add-submit">
          <UserPlus size={15} aria-hidden="true" />
          {busy ? strings.users.adding : strings.users.add}
        </Button>
      </div>

      {/*
        Creating the record and sending a credential-bearing link are separate
        acts. Adding five people should not fire five enrolment links by side
        effect, and the practice may want to check the details first.
      */}
      <p className={ui.hint}>{strings.users.addThenInvite}</p>

      {error && (
        <Notice tone="stop" title={strings.users.addFailed}>
          {error}
        </Notice>
      )}
    </section>
  );
}

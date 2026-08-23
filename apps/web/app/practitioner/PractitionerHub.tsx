'use client';

/**
 * A practitioner's own view: the four cards, and only their own scope.
 *
 * A SEPARATE PAGE, NOT `/practice/setup` WITH CARDS HIDDEN. Defining this
 * screen by subtraction would mean every card added for practices appeared here
 * by default until somebody remembered to hide it — the same fail-open shape as
 * the page map's default-deny, one level up. What a practitioner sees is listed
 * here, positively, and nothing arrives by inheritance.
 *
 * THEIR SCOPE IS NOT A PRACTICE. They work at several and which ones changes,
 * so their token carries `practitioner_id` and no practice claim. Everything on
 * this page comes from `/practitioner/me`, which reads that claim — there is no
 * id in a URL to tamper with.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, CalendarClock, IdCard, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Button, Field, Notice, Shell, TextInput, ui } from '../ui';
import { SessionControl } from '../SessionControl';
import { apiHeaders, currentSession } from '../auth';
import { strings } from '../strings';
import styles from '../practice/setup/setup.module.css';
import manage from '../practice/manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Affiliation = {
  id: string;
  practiceId?: string | null;
  practiceName?: string | null;
  locationCode?: string | null;
  status: string;
  startedAt?: string | null;
  endsAt?: string | null;
  endedAt?: string | null;
};

type PendingChange = {
  id: string;
  requestedEmail: string;
  requestedAt: string;
  expiresAt: string;
};

type Me = {
  id: string;
  ahpraNumber: string;
  givenNames: string;
  familyName: string;
  providerType: string;
  registrationStatus: string | null;
  email: string | null;
  backupEmail: string | null;
  backupEmailVerifiedAt: string | null;
  pendingEmailChange: PendingChange | null;
  passkeyEnrolledAt: string | null;
  deregisteredAt: string | null;
  affiliations: Affiliation[];
};

export function PractitionerHub() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [backup, setBackup] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me`, { headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as Me & { message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be read (${res.status}).`);
      setMe(body);
      setEmail(body.email ?? '');
      setBackup(body.backupEmail ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEmail() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me/contact`, {
        method: 'PATCH',
        headers: apiHeaders(),
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be sent (${res.status}).`);
      /*
       * THE SERVER'S OWN WORDS, not a fixed string. It is the only side that
       * knows whether there was anybody to warn, and "we told your other
       * addresses" is a lie when there were none. The generic line is the
       * fallback, not the default.
       */
      setSaved(body.detail ?? strings.practitioner.contactSaved);
      /*
       * RELOADED so the field snaps BACK to the address still in force. The
       * new one sits in the pending notice above it, where it reads as asked
       * for rather than as done.
       */
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveBackup() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me/backup-email`, {
        method: 'PUT',
        headers: apiHeaders(),
        body: JSON.stringify({ email: backup.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be saved (${res.status}).`);
      setSaved(strings.practitioner.backupSaved);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function clearBackup() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me/backup-email`, {
        method: 'DELETE',
        headers: apiHeaders(),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be removed (${res.status}).`);
      setSaved(strings.practitioner.backupCleared);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!currentSession()) {
    /*
     * THE SIGN-IN CONTROL BELONGS HERE MOST OF ALL. This branch shipped
     * without it, so the one page that exists to say "you need to sign in"
     * was the one page with no way to do it — a dead end telling somebody
     * to do something and then not letting them.
     */
    return (
      <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
        <h1 className={ui.pageTitle}>{strings.practitioner.title}</h1>
        <Notice tone="warn" title={strings.practitioner.signedOutTitle}>
          {strings.practitioner.signedOutBody}
        </Notice>
      </Shell>
    );
  }

  const live = (me?.affiliations ?? []).filter((a) => a.status === 'active');

  /*
   * GROUPED BY PRACTICE, because this card answers "which entities do I work
   * for" and an affiliation is per SITE. Somebody working at two sites of one
   * practice has two affiliations, and listing them raw showed the practice
   * name twice with nothing to distinguish the rows — which reads as a
   * duplicate rather than as two places.
   */
  const entities = useMemo(() => {
    const byPractice = new Map<string, { id: string | null; name: string; sites: string[] }>();
    for (const a of live) {
      const name = a.practiceName ?? strings.practitioner.unnamedPractice;
      const entry = byPractice.get(name) ?? { id: a.practiceId ?? null, name, sites: [] };
      if (a.locationCode && !entry.sites.includes(a.locationCode)) entry.sites.push(a.locationCode);
      byPractice.set(name, entry);
    }
    return [...byPractice.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [live]);

  return (
    <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
      <h1 className={ui.pageTitle}>{strings.practitioner.title}</h1>
      <p className={ui.pageLead}>{strings.practitioner.lead}</p>

      {error && (
        <Notice tone="stop" title={strings.practitioner.failed}>
          {error}
        </Notice>
      )}

      {me?.deregisteredAt && (
        <Notice tone="stop" title={strings.practitioner.deregisteredTitle}>
          {strings.practitioner.deregisteredBody}
        </Notice>
      )}

      <div className={styles.cards}>
        {/*
          1. WHERE THEY WORK — view only, and deliberately thin. The practice's
          name and the sites they personally work at, and nothing else about it:
          not its administrator, not its other practitioners, not its
          application. Having a job somewhere does not make somebody a reader of
          that practice's record.
        */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardIcon}>
              <Building2 size={16} aria-hidden="true" />
            </span>
            <h2 className={styles.cardTitle}>{strings.practitioner.entitiesTitle}</h2>
          </div>
          <p className={ui.hint}>{strings.practitioner.entitiesBody}</p>
          {entities.length === 0 && <p className={manage.cardNote}>{strings.practitioner.noEntities}</p>}
          {entities.map((e) => (
            <p key={e.name} className={manage.cardNote}>
              {/* The name is the way in to the practice's own details. */}
              {e.id ? (
                <Link href={`/practitioner/practices/${e.id}`} data-testid={`to-practice-${e.id}`}>
                  <strong>{e.name}</strong>
                </Link>
              ) : (
                <strong>{e.name}</strong>
              )}
              {/* The sites under it, so two sites read as two places rather
                  than as the practice listed twice. */}
              {e.sites.length > 0 && <span className={ui.hint}> · {e.sites.join(', ')}</span>}
            </p>
          ))}
        </section>

        {/*
          2. THEIR OWN DETAILS. The address is theirs to change; the name and
          AHPRA number are what a reviewer attested against the public register,
          so they are shown as confirmed rather than as fields. Editing them
          here would leave that check attesting to a value that no longer
          exists.
        */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardIcon}>
              <IdCard size={16} aria-hidden="true" />
            </span>
            <h2 className={styles.cardTitle}>{strings.practitioner.detailsTitle}</h2>
          </div>
          {me && (
            <>
              <p className={manage.cardNote}>
                <strong>
                  {me.givenNames} {me.familyName}
                </strong>{' '}
                · {me.ahpraNumber}
              </p>
              <p className={ui.hint}>
                <ShieldCheck size={13} aria-hidden="true" /> {strings.practitioner.verifiedNote}
              </p>

              {/*
                WHAT IS WAITING, above the field rather than below it. Somebody
                who asked for a change yesterday and sees their old address in
                the box will otherwise conclude it did not save and ask again —
                which is the churn the server refuses on the third try.
              */}
              {me.pendingEmailChange && (
                <Notice tone="warn" title={strings.practitioner.pendingTitle} data-testid="practitioner-pending">
                  <p>{strings.practitioner.pendingBody.replace('{email}', me.pendingEmailChange.requestedEmail)}</p>
                  <p className={ui.hint}>{strings.practitioner.pendingStop}</p>
                </Notice>
              )}

              <Field label={strings.practitioner.email} hint={strings.practitioner.emailHint}>
                {(props) => (
                  <TextInput
                    {...props}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="practitioner-email"
                  />
                )}
              </Field>
              <Button
                variant="primary"
                onClick={() => void saveEmail()}
                disabled={busy || !email.trim() || email.trim() === (me.email ?? '')}
                data-testid="practitioner-save-email"
              >
                {busy ? strings.practitioner.saving : strings.practitioner.save}
              </Button>

              {/*
                THE BACKUP, on the same card as the address it protects. Put on
                its own screen it would be a setting nobody visits; put here it
                is the obvious next line after "this is where our messages go".

                Told plainly when it is missing, because having none is the
                state that costs something and silence reads as fine.
              */}
              {!me.backupEmail && (
                <Notice tone="warn" title={strings.practitioner.backupTitle} data-testid="practitioner-no-backup">
                  {strings.practitioner.backupNone}
                </Notice>
              )}

              <Field label={strings.practitioner.backupTitle} hint={strings.practitioner.backupHint}>
                {(props) => (
                  <TextInput
                    {...props}
                    value={backup}
                    onChange={(e) => setBackup(e.target.value)}
                    data-testid="practitioner-backup-email"
                  />
                )}
              </Field>
              {me.backupEmail && !me.backupEmailVerifiedAt && (
                <p className={ui.hint}>{strings.practitioner.backupUnverified}</p>
              )}
              <div className={ui.rowActions}>
                <Button
                  onClick={() => void saveBackup()}
                  disabled={busy || !backup.trim() || backup.trim() === (me.backupEmail ?? '')}
                  data-testid="practitioner-save-backup"
                >
                  {strings.practitioner.backupSave}
                </Button>
                {me.backupEmail && (
                  <Button variant="subtle" onClick={() => void clearBackup()} disabled={busy} data-testid="practitioner-clear-backup">
                    {strings.practitioner.backupClear}
                  </Button>
                )}
              </div>

              {saved && <p className={ui.hint}>{saved}</p>}
            </>
          )}
        </section>

        {/*
          3. AFFILIATIONS. Listed here; leaving one is its own screen because a
          departure has a statutory shape — a cessation date, notice periods,
          and consequences for agreements captured under it. It is not a button
          that belongs beside a summary.
        */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardIcon}>
              <CalendarClock size={16} aria-hidden="true" />
            </span>
            <h2 className={styles.cardTitle}>{strings.practitioner.affiliationsTitle}</h2>
          </div>
          <p className={ui.hint}>{strings.practitioner.affiliationsBody}</p>
          {(me?.affiliations ?? []).map((a) => (
            <p key={a.id} className={manage.cardNote}>
              {a.practiceName ?? strings.practitioner.unnamedPractice} — {a.status}
              {a.endsAt ? ` · ${strings.practitioner.endsOn} ${a.endsAt.slice(0, 10)}` : ''}
            </p>
          ))}
          <Link href="/practitioner/affiliations" className={styles.cardLink} data-testid="to-affiliations">
            {strings.practitioner.openAffiliations}
          </Link>
        </section>

        {/*
          4. WHAT WAS SENT TO THEM. Through Cube, under a credential that can
          read their rows and nobody else's — the database enforces it, not the
          screen.
        */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardIcon}>
              <Send size={16} aria-hidden="true" />
            </span>
            <h2 className={styles.cardTitle}>{strings.practitioner.messagesTitle}</h2>
          </div>
          <p className={ui.hint}>{strings.practitioner.messagesBody}</p>
          {/*
            Their own page, not Cube's builder. The builder is a tool for
            composing a question and shows nothing until you have; somebody
            opening "what we have sent you" has already asked theirs.
          */}
          <Link href="/practitioner/messages" className={styles.cardLink} data-testid="to-messages">
            {strings.practitioner.openMessages}
          </Link>
        </section>
      </div>

      <div className={ui.rowActions}>
        <Button variant="subtle" onClick={() => void load()} data-testid="practitioner-refresh">
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>
    </Shell>
  );
}

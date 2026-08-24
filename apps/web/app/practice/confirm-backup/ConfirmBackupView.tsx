'use client';

/**
 * "Confirm this backup address" — the page the emailed link opens.
 *
 * REACHED WITHOUT A SESSION, and by somebody who may have no account at all.
 * A backup address belongs to a spouse, a colleague, a practice manager —
 * their entire role is being reachable, and this page is how they prove it.
 * Requiring a session would mean only the practitioner could confirm their
 * own backup, which proves nothing about whether the OTHER inbox works.
 *
 * THE LINK ALONE DOES NOTHING. Opening this page confirms nothing — it asks
 * for the code from the same message, because mail scanners, link previews
 * and antivirus gateways all issue GETs, and a backup that can confirm
 * itself with nobody involved is not a proof of anything.
 */

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button, Field, Notice, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export function ConfirmBackupView() {
  const token = useSearchParams().get('token') ?? '';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/pending-email-change/confirm-backup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be confirmed (${res.status}).`);
      setDone(body.detail ?? strings.confirmBackup.doneFallback);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A missing token is its own answer: a form that cannot work must not be
  // shown as though it could.
  if (!token) {
    return (
      <Shell>
        <h1 className={ui.pageTitle}>{strings.confirmBackup.title}</h1>
        <Notice tone="stop" title={strings.confirmBackup.noTokenTitle}>
          {strings.confirmBackup.noTokenBody}
        </Notice>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1 className={ui.pageTitle}>{strings.confirmBackup.title}</h1>
        <Notice tone="ok" title={strings.confirmBackup.doneTitle}>
          <CheckCircle2 size={15} aria-hidden="true" /> {done}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className={ui.pageTitle}>{strings.confirmBackup.title}</h1>
      <p className={ui.lead}>{strings.confirmBackup.lead}</p>

      <Field label={strings.confirmBackup.code} hint={strings.confirmBackup.codeHint} required>
        {(props) => (
          <TextInput
            {...props}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            data-testid="confirm-backup-code"
          />
        )}
      </Field>

      <div className={ui.rowActions}>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={busy || code.trim().length !== 6}
          data-testid="confirm-backup-submit"
        >
          <ShieldCheck size={14} aria-hidden="true" />
          {busy ? strings.confirmBackup.confirming : strings.confirmBackup.confirm}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.confirmBackup.failed}>
          {error}
        </Notice>
      )}

      {/* What they are agreeing to, before they agree to it. */}
      <Notice title={strings.confirmBackup.whatTitle}>{strings.confirmBackup.whatBody}</Notice>
    </Shell>
  );
}

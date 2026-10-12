'use client';

/**
 * P-1, Messages tab — the same log from the other side (design handoff).
 *
 * "The patient's portal shows the same rows for their own records — same
 * wording, same timestamps, from their point of view. It is one log with two
 * audiences, not two logs. Anything the practice can see about a message, the
 * patient can see about their own." So this is `MessageLog` again, with the
 * audience set to `patient` and the "who" column dropped — every row is theirs.
 *
 * WHAT THE PATIENT DOES NOT SEE: what a message cost the practice. That is the
 * practice's own figure (design, M-1).
 *
 * REACHED BY THE LINK THEY WERE SENT, because there is no patient account
 * (REQ-PORT-08) and the design's passkey portal does not exist yet. The server
 * refuses until the identity challenge behind that token has passed, so a
 * forwarded link shows nothing.
 *
 * "STOP REMINDERS" IS DISABLED, WITH ITS REASON. The design puts the control
 * here and the rule behind it is that STOP applies across every channel at
 * once. Nothing on the platform records a cross-channel stop today; a button
 * that stopped some channels and not others would be a promise the record
 * could not keep. So it says what to do instead, and the gap is in TODO.md.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellOff, ShieldCheck } from 'lucide-react';
import { type DispatchRow, buildMessageLog } from '@aobplatform/domain';
import { Button, Notice, Shell, ui } from '../../../ui';
import { strings } from '../../../strings';
import { MessageLog } from '../../../correspondence/MessageLog';
import styles from '../../../verify/verify.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Row = DispatchRow & { bodyText: string | null };
type Outcome = 'invalid' | 'unverified' | 'unreachable';

export function PatientMessagesView({ token }: { token: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [practiceName, setPracticeName] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${CORE_URL}/agree/${token}/messages`).catch(() => null);
    if (!res) return setOutcome('unreachable');
    // 409 is "confirm your details first" — the content-blind refusal, not a fault.
    if (res.status === 409) return setOutcome('unverified');
    if (!res.ok) return setOutcome('invalid');
    const body = (await res.json()) as { practiceName: string | null; messages: Row[] };
    setPracticeName(body.practiceName);
    setRows(body.messages ?? []);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(() => buildMessageLog({ dispatches: rows ?? [] }), [rows]);
  const bodies = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);

  if (outcome) {
    const o =
      outcome === 'unverified'
        ? { title: strings.patientMessages.verifyTitle, body: strings.patientMessages.verifyBody, tone: 'warn' as const }
        : outcome === 'unreachable'
          ? { title: strings.patientMessages.unreachableTitle, body: strings.status.unreachable, tone: 'warn' as const }
          : { title: strings.patientMessages.invalidTitle, body: strings.patientMessages.invalidBody, tone: 'stop' as const };
    return (
      <Shell>
        <div className={styles.card}>
          <div className={styles.mark}>
            <ShieldCheck size={20} aria-hidden="true" />
            <span className={styles.markText}>{strings.appName}</span>
          </div>
          <Notice tone={o.tone} title={o.title}>
            {o.body}
          </Notice>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={strings.patientMessages.title} lead={strings.patientMessages.lead}>
      {practiceName && <p className={ui.hint}>{practiceName}</p>}

      {rows === null ? (
        <p className={ui.hint}>{strings.patientMessages.loading}</p>
      ) : (
        <MessageLog
          audience="patient"
          entries={entries}
          showWho={false}
          emptyText={strings.patientMessages.none}
          bodyOf={(entry) => {
            const row = bodies.get(entry.id);
            return row ? { subject: row.subject ?? null, body: row.bodyText } : null;
          }}
        />
      )}

      <h2 className={ui.label}>{strings.patientMessages.stopTitle}</h2>
      <p className={ui.hint}>{strings.patientMessages.stopBody}</p>
      {/* Disabled WITH ITS REASON — the design's GuardedButton rule. */}
      <Button variant="subtle" disabled data-testid="patient-stop-reminders">
        <BellOff size={14} aria-hidden="true" />
        {strings.patientMessages.stop}
      </Button>
      <p className={ui.hint}>{strings.patientMessages.stopUnavailable}</p>

      <p className={ui.hint}>{strings.patientMessages.checkerNote}</p>
      <p className={ui.hint}>{strings.patientMessages.footer}</p>
    </Shell>
  );
}

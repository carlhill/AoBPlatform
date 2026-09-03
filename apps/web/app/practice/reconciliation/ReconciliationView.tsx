'use client';

/**
 * The reconciliation queue — every service billed without a stored agreement,
 * ranked by days left on the twelve-month lodgement window (M7, REQ-REC-01).
 *
 * Built to the queue wireframe (design handoff, option 1d): R-1 is the list
 * — patient and service, the BAND AS A WORD, days left, one action; R-2 opens
 * beneath the row — what has been tried, what the band allows, what comes
 * next. R-3 (convert-or-forgo, FR-7.3) has no backend yet and is not drawn
 * here; a button that recorded nothing would be worse than none.
 *
 * WHAT IS NEW SINCE THE CASCADE. Most items never reach a person now: the
 * platform drafts and sends for any patient it may. What is left here is
 * exactly what it could not decide, and each row says WHY — under 14, no way
 * to reach them, window closed. The queue says what is left to do, not only
 * that something is.
 *
 * RULES CARRIED FROM THE DESIGN. The band is always a word, never colour
 * alone. A disabled action names its reason. Nothing here blocks care, and
 * nothing here shows a dollar amount. 89AA notices never appear — they are
 * one-way and never chased.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Mail, MessageSquare, RefreshCw, Send, X } from 'lucide-react';
import { Button, Chip, Notice, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Band = 'standard' | 'compressed' | 'urgent' | 'last_chance' | 'expired';

type Item = {
  serviceRecordId: string;
  serviceDate: string;
  mbsItemNumbers: string[];
  daysRemaining: number;
  band: Band;
  agreementId: string | null;
  agreementStatus: string | null;
  patientId: string | null;
  patientName: string | null;
  providerName: string | null;
  patientHasEmail: boolean;
  patientHasMobile: boolean;
  needsAgreement: boolean;
  captureSuppressedReason: string | null;
  outboundChaseSuppressed: boolean;
  revenueForgone: boolean;
};

type Metrics = { outstanding: number; byBand: Record<Band, number>; captureRate: number | null };

type Decision = { id: string; decision: string; reason: string | null; decidedBy: string; decidedAt: string };

type Detail = {
  alreadyClosed: boolean;
  decisions: Decision[];
  band: Band;
  daysRemaining: number;
  patient: { name: string } | null;
  provider: { name: string } | null;
  agreement: { id: string; status: string } | null;
  captureSuppressedReason: string | null;
  policy: { attempts: number; attemptWindowHours: number | null; escalation: string[]; handback: string };
  attemptsMade: number;
  attemptAllowed: boolean;
  nextStep: 'ai' | 'human' | 'handback' | null;
  attempts: {
    captureRequestId: string;
    channel: string;
    status: string;
    openedAt: string;
    messages: { id: string; channel: string; to: string | null; state: string; sentAt: string | null }[];
  }[];
};

const BAND_TONE: Record<Band, 'neutral' | 'warn' | 'stop'> = {
  standard: 'neutral',
  compressed: 'warn',
  urgent: 'warn',
  last_chance: 'stop',
  expired: 'stop',
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Email first — a copy the patient keeps — SMS when that is all there is. */
function channelFor(item: Item): 'email_link' | 'sms_link' | null {
  if (item.patientHasEmail) return 'email_link';
  if (item.patientHasMobile) return 'sms_link';
  return null;
}

/** Can a link be sent for this row at all? The reasons mirror the server's refusals. */
function resendBlockedReason(item: Item): string | null {
  if (item.revenueForgone) return strings.reconciliation.expiredWhy;
  if (item.outboundChaseSuppressed) return strings.reconciliation.reasons.confidentiality_flag;
  if (item.needsAgreement) return strings.reconciliation.needsAgreementWhy;
  if (!channelFor(item)) return strings.reconciliation.reasons.no_contact_channel;
  return null;
}

export function ReconciliationView() {
  const { practiceId, checked } = usePractice();
  const [items, setItems] = useState<Item[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState<'all' | Band>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowOutcome, setRowOutcome] = useState<Record<string, 'sent' | 'failed'>>({});
  const [bulk, setBulk] = useState<{ sent: number; skipped: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!practiceId) return;
    setError(null);
    try {
      const [q, m] = await Promise.all([
        fetch(`${CORE_URL}/reconciliation/outstanding`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/reconciliation/metrics`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!q.ok || !m.ok) throw new Error(String(q.status));
      setItems((await q.json()) as Item[]);
      setMetrics((await m.json()) as Metrics);
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);
  useRefreshable(load);

  const openDetail = useCallback(
    async (id: string) => {
      if (!practiceId) return;
      setOpenId(id);
      setDetail(null);
      const res = await fetch(`${CORE_URL}/reconciliation/${id}`, { headers: apiHeaders(practiceId) }).catch(() => null);
      if (res?.ok) setDetail((await res.json()) as Detail);
    },
    [practiceId],
  );

  async function resend(item: Item): Promise<boolean> {
    const channel = channelFor(item);
    if (!practiceId || !channel) return false;
    const res = await fetch(`${CORE_URL}/reconciliation/${item.serviceRecordId}/resend`, {
      method: 'POST',
      headers: { ...apiHeaders(practiceId), 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    }).catch(() => null);
    return Boolean(res?.ok);
  }

  async function resendOne(item: Item) {
    setBusyId(item.serviceRecordId);
    const ok = await resend(item);
    setRowOutcome((o) => ({ ...o, [item.serviceRecordId]: ok ? 'sent' : 'failed' }));
    setBusyId(null);
    if (openId === item.serviceRecordId) void openDetail(item.serviceRecordId);
  }

  /**
   * "Select all in band → bulk resend", as the wireframe has it — one request
   * per item, so every send is its own capture request and its own vault
   * event, and one refusal does not stop the rest. The skipped count says how
   * many could not be sent and why, rather than pretending they went.
   */
  async function resendShown() {
    if (!items) return;
    let sent = 0;
    let skipped = 0;
    setBulk(null);
    for (const item of shown) {
      if (resendBlockedReason(item)) {
        skipped += 1;
        continue;
      }
      setBusyId(item.serviceRecordId);
      const ok = await resend(item);
      setRowOutcome((o) => ({ ...o, [item.serviceRecordId]: ok ? 'sent' : 'failed' }));
      if (ok) sent += 1;
      else skipped += 1;
    }
    setBusyId(null);
    setBulk({ sent, skipped });
  }

  const shown = useMemo(() => (items ?? []).filter((i) => band === 'all' || i.band === band), [items, band]);

  const right = <SessionControl audience={strings.setup.audience} />;

  if (!checked) return null;

  // No practice to ask about — not signed in, or an operator with no practice
  // chosen. Say so, the way the queue page does, rather than loading for ever.
  if (!practiceId) {
    return (
      <Shell right={right} title={strings.reconciliation.title} lead={strings.reconciliation.lead}>
        <Notice tone="warn" title={strings.queue.chooseTitle}>
          {strings.queue.chooseBodyPractice}
        </Notice>
      </Shell>
    );
  }

  if (items === null) {
    return (
      <Shell right={right} title={strings.reconciliation.title} lead={strings.reconciliation.lead}>
        {error ? (
          <Notice tone="stop" title={strings.reconciliation.unreachableTitle}>
            {error}
          </Notice>
        ) : (
          <p className={ui.hint}>{strings.reconciliation.loading}</p>
        )}
      </Shell>
    );
  }

  async function decide(serviceRecordId: string, decision: string, reason: string) {
    if (!practiceId) return;
    setBusyId(serviceRecordId);
    setDecideError(null);
    try {
      const res = await fetch(`${CORE_URL}/reconciliation/${serviceRecordId}/decide`, {
        method: 'POST',
        headers: { ...apiHeaders(practiceId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: reason || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; closesItem?: boolean };
      if (!res.ok) throw new Error(body.message ?? strings.reconciliation.decideFailed);
      await load();
      if (body.closesItem) setOpenId(null);
      else await openDetail(serviceRecordId);
    } catch (e) {
      setDecideError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell right={right} title={strings.reconciliation.title} lead={strings.reconciliation.lead}>
      {error && (
        <Notice tone="stop" title={strings.reconciliation.unreachableTitle}>
          {error}
        </Notice>
      )}

      <div className={styles.queueSummary} data-testid="reconciliation-summary">
        <Chip tone={items.length ? 'warn' : 'ok'}>{strings.reconciliation.open.replace('{n}', String(items.length))}</Chip>
        {metrics &&
          (Object.keys(metrics.byBand) as Band[])
            .filter((b) => metrics.byBand[b] > 0)
            .map((b) => (
              <Chip key={b} tone={BAND_TONE[b]}>
                {strings.reconciliation.bands[b]} · {metrics.byBand[b]}
              </Chip>
            ))}
      </div>

      <div className={styles.queueFilters}>
        <label className={ui.label} htmlFor="recon-band">
          {strings.reconciliation.selectBand}
        </label>
        <select
          id="recon-band"
          className={ui.select}
          value={band}
          onChange={(e) => setBand(e.target.value as 'all' | Band)}
          data-testid="reconciliation-band"
        >
          <option value="all">{strings.reconciliation.byBand}</option>
          {(['last_chance', 'urgent', 'compressed', 'standard', 'expired'] as Band[]).map((b) => (
            <option key={b} value={b}>
              {strings.reconciliation.bands[b]}
            </option>
          ))}
        </select>
        <Button
          variant="subtle"
          onClick={() => void resendShown()}
          disabled={busyId !== null || shown.length === 0}
          data-testid="reconciliation-bulk"
        >
          <Send size={14} aria-hidden="true" />
          {strings.reconciliation.bulkResend}
        </Button>
        <Button variant="subtle" onClick={() => void load()} disabled={busyId !== null}>
          <RefreshCw size={14} aria-hidden="true" />
          {strings.queue.refresh}
        </Button>
      </div>

      {bulk && (
        <Notice tone={bulk.skipped ? 'warn' : 'ok'} title={strings.reconciliation.bulkResendDone.replace('{sent}', String(bulk.sent)).replace('{skipped}', String(bulk.skipped))}>
          {bulk.skipped > 0 ? strings.reconciliation.bulkSkippedWhy : null}
        </Notice>
      )}

      {shown.length === 0 ? (
        <p className={ui.hint}>{strings.reconciliation.none}</p>
      ) : (
        <>
          <div className={styles.queueHead} aria-hidden="true">
            <span>{strings.reconciliation.colPatient}</span>
            <span>{strings.reconciliation.colBand}</span>
            <span>{strings.reconciliation.colDays}</span>
            <span>{strings.reconciliation.colAction}</span>
          </div>
          <ul className={styles.queueList} data-testid="reconciliation-list">
            {shown.map((item) => {
              const blocked = resendBlockedReason(item);
              const outcome = rowOutcome[item.serviceRecordId];
              const reasonWord = item.outboundChaseSuppressed
                ? strings.reconciliation.confidential
                : item.captureSuppressedReason
                  ? strings.reconciliation.reasons[item.captureSuppressedReason] ?? item.captureSuppressedReason
                  : item.needsAgreement
                    ? strings.reconciliation.reasonUnknown
                    : null;
              const isOpen = openId === item.serviceRecordId;
              return (
                <li key={item.serviceRecordId} className={styles.queueRow}>
                  <div
                    className={styles.queueRowMain}
                    role="button"
                    tabIndex={0}
                    onClick={() => (isOpen ? setOpenId(null) : void openDetail(item.serviceRecordId))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        isOpen ? setOpenId(null) : void openDetail(item.serviceRecordId);
                      }
                    }}
                    data-testid={`reconciliation-row-${item.serviceRecordId}`}
                  >
                    <span className={styles.queueDest}>
                      <strong>{item.patientName ?? '—'}</strong> · {when(item.serviceDate)}
                      <span className={styles.queueSub}>
                        {item.providerName ?? '—'} · {item.mbsItemNumbers.join(', ')}
                      </span>
                    </span>
                    {/* The band is a WORD. Colour is secondary, never the carrier. */}
                    <Chip tone={item.outboundChaseSuppressed ? 'neutral' : BAND_TONE[item.band]}>
                      {item.outboundChaseSuppressed ? strings.reconciliation.bands.suppressed : strings.reconciliation.bands[item.band]}
                    </Chip>
                    <span className={ui.mono}>{item.revenueForgone ? '—' : item.daysRemaining}</span>
                    <span className={styles.rowActions ?? ''} onClick={(e) => e.stopPropagation()}>
                      {blocked ? (
                        // Disabled WITH ITS REASON — the design's GuardedButton rule.
                        <span className={ui.hint} title={blocked}>
                          {item.revenueForgone
                            ? strings.reconciliation.expiredAction
                            : item.needsAgreement
                              ? `${strings.reconciliation.needsAgreementAction} — ${reasonWord}`
                              : reasonWord}
                        </span>
                      ) : (
                        <Button
                          onClick={() => void resendOne(item)}
                          disabled={busyId !== null}
                          data-testid={`reconciliation-resend-${item.serviceRecordId}`}
                        >
                          {channelFor(item) === 'sms_link' ? <MessageSquare size={14} aria-hidden="true" /> : <Mail size={14} aria-hidden="true" />}
                          {busyId === item.serviceRecordId
                            ? strings.reconciliation.resending
                            : outcome === 'sent'
                              ? strings.reconciliation.resent
                              : outcome === 'failed'
                                ? strings.reconciliation.resendFailed
                                : strings.reconciliation.resend}
                        </Button>
                      )}
                    </span>
                  </div>

                  {isOpen && (
                    <div className={styles.historyPanel ?? ''} data-testid="reconciliation-detail">
                      {!detail ? (
                        <p className={ui.hint}>{strings.reconciliation.loading}</p>
                      ) : (
                        <DetailPanel
                          detail={detail}
                          busy={busyId !== null}
                          error={decideError}
                          onDecide={(decision, reason) => void decide(item.serviceRecordId, decision, reason)}
                          onClose={() => setOpenId(null)}
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className={ui.hint}>{strings.reconciliation.footer}</p>
    </Shell>
  );
}

/** R-2 — what has been tried, what the band allows, what comes next; R-3 — the decision. */
function DetailPanel({
  detail,
  busy,
  error,
  onDecide,
  onClose,
}: {
  detail: Detail;
  busy: boolean;
  error: string | null;
  onDecide: (decision: 'convert_to_private' | 'forgo_benefit' | 'keep_chasing', reason: string) => void;
  onClose: () => void;
}) {
  const s = strings.reconciliation;
  const [reason, setReason] = useState('');
  const latest = detail.decisions[0] ?? null;
  const remaining = Math.max(detail.policy.attempts - detail.attemptsMade, 0);
  const windowText =
    detail.policy.attemptWindowHours === null
      ? s.policyNoWindow
      : detail.policy.attemptWindowHours % 24 === 0
        ? `${detail.policy.attemptWindowHours / 24} day(s)`
        : `${detail.policy.attemptWindowHours} h`;
  const ladder = detail.policy.escalation.map((e) => s.ladder[e] ?? e).join(' → ') || '—';

  return (
    <div>
      <div className={ui.rowActions ?? ''}>
        <h2 className={ui.sectionTitle}>{s.detailTitle}</h2>
        <Button variant="subtle" onClick={onClose}>
          <X size={14} aria-hidden="true" />
          {s.close}
        </Button>
      </div>

      <h3 className={ui.label}>{s.attempts}</h3>
      {detail.attempts.length === 0 ? (
        <p className={ui.hint}>{s.noAttempts}</p>
      ) : (
        <ul className={ui.plainList}>
          {detail.attempts.map((a) => (
            <li key={a.captureRequestId}>
              {s.attemptLine
                .replace('{channel}', a.channel === 'sms_link' ? s.channelSms : a.channel === 'email_link' ? s.channelEmail : a.channel)
                .replace('{when}', when(a.openedAt))
                .replace('{status}', a.status)}
              {a.messages.length > 0 && (
                <ul className={ui.plainList}>
                  {a.messages.map((m) => (
                    <li key={m.id} className={ui.hint}>
                      {s.messageLine.replace('{state}', m.state).replace('{to}', m.to ?? '—')}
                      {m.sentAt ? ` · ${when(m.sentAt)}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className={ui.label}>{s.policy}</h3>
      <p className={ui.hint}>
        {s.policyLine
          .replace('{attempts}', String(detail.policy.attempts))
          .replace('{window}', windowText)
          .replace('{ladder}', ladder)
          .replace('{handback}', detail.policy.handback)}
      </p>

      <h3 className={ui.label}>{s.nextStep}</h3>
      {detail.nextStep === null ? (
        <p className={ui.hint}>
          <AlertTriangle size={14} aria-hidden="true" /> {s.nextNone}
        </p>
      ) : detail.nextStep === 'handback' ? (
        <p className={ui.hint}>{s.nextExhausted}</p>
      ) : (
        <p>
          <Clock size={14} aria-hidden="true" /> {s.ladder[detail.nextStep]} · {s.attemptsRemaining.replace('{n}', String(remaining))}
        </p>
      )}
      {detail.captureSuppressedReason && (
        <p className={ui.hint}>{s.reasons[detail.captureSuppressedReason] ?? detail.captureSuppressedReason}</p>
      )}
      <p className={ui.hint}>{s.everyAttemptRecorded}</p>

      {/* R-3 — convert-or-forgo (FR-7.3). Nothing happens by default; either choice is recorded. */}
      <h3 className={ui.label}>{s.decisionTitle}</h3>
      {latest && (
        <p data-testid="reconciliation-decision-recorded">
          {s.decisionRecorded
            .replace('{decision}', s.decisionNames[latest.decision] ?? latest.decision)
            .replace('{by}', latest.decidedBy)
            .replace('{when}', when(latest.decidedAt))}
          {latest.reason ? ` — ${latest.reason}` : ''}
        </p>
      )}
      {!detail.alreadyClosed && (
        <>
          <p className={ui.hint}>{s.decisionLead}</p>
          {error && (
            <Notice tone="stop" title={s.decideFailed}>
              {error}
            </Notice>
          )}
          <div className={ui.field}>
            <label className={ui.label} htmlFor="recon-reason">
              {s.reasonLabel}
            </label>
            <input id="recon-reason" className={ui.input} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className={ui.rowActions ?? ''}>
            <Button onClick={() => onDecide('convert_to_private', reason)} disabled={busy} data-testid="decide-convert">
              {s.convert}
            </Button>
            <Button onClick={() => onDecide('forgo_benefit', reason)} disabled={busy} data-testid="decide-forgo">
              {s.forgo}
            </Button>
            {/* Disabled WITH ITS REASON when the band no longer permits an attempt (REQ-CHASE-08/-09). */}
            <Button
              variant="subtle"
              onClick={() => onDecide('keep_chasing', reason)}
              disabled={busy || !detail.attemptAllowed}
              title={detail.attemptAllowed ? undefined : s.keepChasingBlocked}
              data-testid="decide-keep"
            >
              {detail.attemptAllowed ? s.keepChasing.replace('{n}', String(remaining)) : s.keepChasingBlockedShort}
            </Button>
          </div>
          <p className={ui.hint}>{s.careNeverBlocked}</p>
          <p className={ui.hint}>{s.recordedWithIdentity}</p>
        </>
      )}
    </div>
  );
}

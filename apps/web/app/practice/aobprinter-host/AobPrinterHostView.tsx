'use client';

/**
 * THE PRACTICE'S AOBPRINTER HOST (PRINTER-HEARTBEAT.md §4, D-2026-10-10-02).
 *
 * The host beats every minute; this page reads what the platform made of the
 * last beat (`GET /aobprinter-hosts`) and says it in the ten states of §4,
 * worst first (`hostStates.ts`). Every state names what was observed, and a
 * remedy appears only where it is true for that record (CLAUDE.md §7c,
 * wow.md §13). Codes this page has no words for show the code.
 *
 * THE LAST REPORT STAYS ON SCREEN, WITH ITS AGE. A host that has gone quiet
 * is exactly when somebody needs to know what it held when it stopped, so the
 * versions, the stage table and the chain head are shown whatever the state,
 * headed by how old they are.
 *
 * NO RE-BASELINE HERE, EVER (decision 7). A practice may not verify its own
 * evidence. The platform twin renders the operator's control outside the
 * read-only region; this component has no prop that could turn it on.
 *
 * LIVE, LIKE THE TABLETS PAGE. It re-reads itself every 30 s and skips a
 * tick while `paused` (the twin's re-baseline in flight), the same way
 * `DevicesView` skips while an act is in flight; the top-bar refresh is
 * registered with `useRefreshable`. Ages use `deviceSeenAgo`.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AOBPRINTER_OFFLINE_AFTER_MS } from '@aobplatform/domain';
import {
  AOBPRINTER_PRINT_STAGES,
  AOBPRINTER_RETURN_STAGES,
  type AobPrinterChainPoint,
  type AobPrinterHostException,
  type AobPrinterHostRow,
  type AobPrinterHostsView,
} from '@aobplatform/contracts';
import { Chip, Notice, Section, Shell, ui, type Tone } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { deviceSeenAgo } from '../deviceActivity';
import { aobPrinterHostRank, aobPrinterHostStates, hash8, type AobPrinterHostState } from './hostStates';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Twice the host's default beat: the page is never more than one report behind. */
const REFRESH_MS = 30_000;

const t = strings.aobprinterHost;

const LIVENESS_TONE: Record<string, Tone> = { live: 'ok', stale: 'warn', offline: 'stop', never_reported: 'neutral' };

/** A label from a string map, or the code itself where the map has none. */
function wordsOr(map: Readonly<Record<string, string>>, code: string): string {
  return map[code] ?? code;
}

export function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function point(p: AobPrinterChainPoint): string {
  return p.hash ? t.point(p.seq, hash8(p.hash)) : t.pointNoHash(p.seq);
}

async function refusalMessage(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[]; reasonCode?: string };
  const message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? String(res.status));
  return new Error(body.reasonCode ? `${message} (${body.reasonCode})` : message);
}

export function AobPrinterHostView({
  practiceId,
  paused = false,
  onView,
}: {
  practiceId: string;
  /** Skip the timed re-read — set by the twin while its re-baseline is in flight. */
  paused?: boolean;
  /** Each successful read, for the twin's re-baseline panel. Pass a stable function. */
  onView?: (view: AobPrinterHostsView) => void;
}) {
  const [view, setView] = useState<AobPrinterHostsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/aobprinter-hosts`, { headers: apiHeaders(practiceId) });
      if (!res.ok) throw await refusalMessage(res);
      const body = (await res.json()) as AobPrinterHostsView;
      setView(body);
      setLoadError(null);
      onView?.(body);
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId, onView]);

  useRefreshable(load);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (paused) return;
      void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, paused]);

  const now = Date.now();
  const hosts = [...(view?.hosts ?? [])].sort(
    (a, b) => aobPrinterHostRank(signalOf(a)) - aobPrinterHostRank(signalOf(b)),
  );

  return (
    <Shell right={<SessionControl audience={t.audience} />} title={t.title} lead={t.lead}>
      {loadError && (
        <Notice tone="stop" title={t.notLoaded}>
          {loadError}
        </Notice>
      )}
      {view === null && !loadError && <p className={ui.hint}>{t.loading}</p>}

      {view !== null && hosts.length === 0 && <NeverReported />}

      {view?.secondHostReporting && (
        <Notice tone="stop" title={t.secondHostTitle} data-testid="aobprinter-state-second_host">
          {t.secondHostBody(Math.round(AOBPRINTER_OFFLINE_AFTER_MS / 60_000))}
        </Notice>
      )}

      {hosts.map((host) => (
        <HostCard key={host.id} host={host} now={now} />
      ))}
    </Shell>
  );
}

/** The host's own signal. Two hosts reporting is the page's state, not one host's. */
function signalOf(host: AobPrinterHostRow) {
  return {
    liveness: host.liveness,
    chainStatus: host.chain.status,
    secondHostReporting: false,
    localCheckFailed: host.localCheck.ok === false,
    openExceptions: host.exceptions.length,
    filedUnconfirmed: host.filedUnconfirmed.length,
    staleQueued: host.counts.staleQueued,
    clockSkewMs: host.clockSkewMs,
  };
}

/** State 10. Neutral — a plain section, not an alert: nothing has failed. */
function NeverReported() {
  return (
    <section className={styles.empty} data-testid="aobprinter-state-never_reported">
      <p className={styles.emptyTitle}>{t.neverTitle}</p>
      <p className={ui.hint}>{t.never}</p>
    </section>
  );
}

function HostCard({ host, now }: { host: AobPrinterHostRow; now: number }) {
  const states = aobPrinterHostStates(signalOf(host));
  const age = deviceSeenAgo(host.lastSeenAt, now);

  return (
    <section className={styles.card} data-testid={`aobprinter-host-${host.id}`} aria-label={t.hostHeading(hash8(host.chainId))}>
      <div className={styles.cardHead}>
        <div className={styles.cardMain}>
          <p className={styles.cardTitle}>
            <span className={ui.mono}>{t.hostHeading(hash8(host.chainId))}</span>
          </p>
        </div>
        <div className={styles.cardAside}>
          <Chip tone={LIVENESS_TONE[host.liveness] ?? 'neutral'}>{wordsOr(t.liveness, host.liveness)}</Chip>
        </div>
      </div>

      <div className={styles.cardBody}>
        {states.map((state) => (
          <StateNotice key={state} state={state} host={host} age={age} />
        ))}
      </div>

      {host.liveness !== 'never_reported' && <LastReport host={host} age={age} />}
    </section>
  );
}

function StateNotice({ state, host, age }: { state: AobPrinterHostState; host: AobPrinterHostRow; age: string }) {
  const testId = `aobprinter-state-${state}`;
  switch (state) {
    case 'regressed': {
      const r = host.chain.regression;
      const sentence = !r
        ? t.chainStatus.regressed
        : r.kind in t.regression
          ? t.regression[r.kind as keyof typeof t.regression](point(r.expected), point(r.received), when(r.at))
          : t.regressionUnmapped(r.kind, when(r.at));
      return (
        <Notice tone="stop" title={t.regressedTitle} data-testid={testId}>
          <p>{sentence}</p>
          <p>{t.regressedStays}</p>
        </Notice>
      );
    }
    case 'local_check_failed': {
      const check = host.localCheck;
      if (check.ok) return null;
      const sentence =
        check.why in t.localCheck
          ? t.localCheck[check.why as keyof typeof t.localCheck](check.brokenAtSeq)
          : t.localCheckUnmapped(check.brokenAtSeq, check.why);
      return (
        <Notice tone="stop" title={t.localCheckTitle} data-testid={testId}>
          {sentence}
        </Notice>
      );
    }
    case 'offline':
      return (
        <Notice tone="stop" title={t.offlineTitle} data-testid={testId}>
          {t.offline(when(host.lastSeenAt), age)}
        </Notice>
      );
    case 'stale':
      return (
        <Notice tone="warn" title={t.staleTitle} data-testid={testId}>
          {t.stale(when(host.lastSeenAt), age)}
        </Notice>
      );
    case 'open_exceptions':
      return (
        <Notice tone="warn" title={t.exceptionsTitle(host.exceptions.length)} data-testid={testId}>
          <ul className={styles.subList}>
            {host.exceptions.map((exception, index) => (
              <ExceptionItem key={index} exception={exception} index={index} />
            ))}
          </ul>
        </Notice>
      );
    case 'filed_unconfirmed':
      return (
        <Notice tone="warn" title={t.filedTitle(host.filedUnconfirmed.length)} data-testid={testId}>
          <ul className={styles.subList}>
            {host.filedUnconfirmed.map((row) => (
              <li key={row.agreementId} className={styles.subItem}>
                <span>{wordsOrUnmapped(t.filed, row.verdict, t.filedUnmapped)}</span>{' '}
                {row.patientId ? (
                  <Link href={`/practice/patients/${row.patientId}`}>{t.returnOpenPatient}</Link>
                ) : (
                  <span className={ui.hint}>{t.returnNoPatient}</span>
                )}
              </li>
            ))}
          </ul>
        </Notice>
      );
    case 'old_queue': {
      const oldest = host.counts.oldestQueuedAt;
      return (
        <Notice tone="warn" title={t.oldQueueTitle} data-testid={testId}>
          {oldest
            ? t.oldQueue(host.counts.staleQueued, deviceSeenAgo(oldest))
            : t.oldQueueNoAge(host.counts.staleQueued)}
        </Notice>
      );
    }
    case 'clock_skew': {
      const minutes = Math.round(Math.abs(host.clockSkewMs) / 60_000);
      return (
        <Notice tone="warn" title={t.skewTitle} data-testid={testId}>
          {host.clockSkewMs > 0 ? t.skewAhead(minutes) : t.skewBehind(minutes)}
        </Notice>
      );
    }
    case 'healthy':
      return (
        <Notice tone="ok" title={t.healthyTitle} data-testid={testId}>
          {t.healthy(age)}
        </Notice>
      );
    case 'never_reported':
      return (
        <div data-testid={testId}>
          <p className={styles.emptyTitle}>{t.neverTitle}</p>
          <p className={ui.hint}>{t.never}</p>
        </div>
      );
    // `second_host` is the page's state, rendered once above every card.
    default:
      return null;
  }
}

function wordsOrUnmapped(
  map: Readonly<Record<string, string>>,
  code: string,
  unmapped: (code: string) => string,
): string {
  return map[code] ?? unmapped(code);
}

/**
 * ONE EXCEPTION. A return links to its patient, the one place on the platform
 * it can be acted on. A print has no platform page (decision 13), so it shows
 * its reason code and the first 8 characters of its hash, and says it is held
 * on the host — never a link to a page that does not exist.
 */
function ExceptionItem({ exception, index }: { exception: AobPrinterHostException; index: number }) {
  const words = t.exceptionReason[exception.reason as keyof typeof t.exceptionReason];
  return (
    <li className={styles.subItem} data-testid={`aobprinter-exception-${index}`}>
      <span>
        {wordsOr(t.exceptionStage, exception.stage)}
        {words ? `: ${words} ` : ' '}
      </span>
      <span className={ui.mono}>{exception.reason}</span>
      <span className={ui.hint}> {t.exceptionSince(when(exception.since))}</span>
      {exception.direction === 'out' && exception.sourceSha256 && (
        <p className={ui.hint}>{t.printHeld(hash8(exception.sourceSha256))}</p>
      )}
      {exception.direction === 'in' &&
        (exception.patientId ? (
          <p>
            <Link href={`/practice/patients/${exception.patientId}`}>{t.returnOpenPatient}</Link>
          </p>
        ) : (
          <p className={ui.hint}>{t.returnNoPatient}</p>
        ))}
    </li>
  );
}

/** State 9's detail, and the last report under every other state, headed by its age. */
function LastReport({ host, age }: { host: AobPrinterHostRow; age: string }) {
  const yesNo = (value: boolean) => (value ? t.yes : t.no);
  return (
    <div className={styles.cardBody} data-testid={`aobprinter-report-${host.id}`}>
      <Section number={1} title={t.reportTitle(age)}>
        <p className={styles.subHeading}>{t.versionsTitle}</p>
        <ul className={styles.subList}>
          <li className={styles.subItem}>
            {t.printerVersion}: <span className={ui.mono} data-testid="aobprinter-version-printer">{host.printerVersion}</span>
          </li>
          <li className={styles.subItem}>
            {t.templateVersion}: <span className={ui.mono} data-testid="aobprinter-version-template">{host.templateVersion}</span>
          </li>
          <li className={styles.subItem}>
            {t.schemaVersion}: <span className={ui.mono} data-testid="aobprinter-version-schema">{String(host.schemaVersion)}</span>
          </li>
          <li className={styles.subItem}>
            {t.runtimeVersion}: <span className={ui.mono} data-testid="aobprinter-version-runtime">{host.runtimeVersion}</span>
          </li>
          <li className={styles.subItem}>
            {t.startedAt}: {when(host.startedAt)}
          </li>
          <li className={styles.subItem}>{t.interval(Math.round(host.intervalMs / 1000))}</li>
          <li className={styles.subItem}>
            {t.collecting}: {yesNo(host.collecting)}
          </li>
          <li className={styles.subItem}>
            {t.retention}: {yesNo(host.retentionEnabled)}
          </li>
          <li className={styles.subItem}>
            {t.queueCount}: {host.queueCount}
          </li>
        </ul>

        <p className={styles.subHeading}>{t.stagesTitle}</p>
        <div className={styles.tableScroll}>
          <StageTable
            heading={t.printsHeading}
            prefix="prints"
            stages={AOBPRINTER_PRINT_STAGES}
            labels={t.printStages}
            counts={host.counts.prints}
          />
          <StageTable
            heading={t.returnsHeading}
            prefix="returns"
            stages={AOBPRINTER_RETURN_STAGES}
            labels={t.returnStages}
            counts={host.counts.returns}
          />
        </div>

        <p className={styles.subHeading}>{t.chainTitle}</p>
        <p data-testid="aobprinter-chain-head">{t.chainHead(point(host.head))}</p>
        <p>{wordsOr(t.chainStatus, host.chain.status)}</p>
        <p data-testid="aobprinter-chain-anchor">
          {host.chain.anchorVerifiedAt
            ? t.anchorVerified(when(host.chain.anchorVerifiedAt), host.chain.anchorSeq)
            : t.anchorNotVerified}
        </p>
      </Section>
    </div>
  );
}

function StageTable({
  heading,
  prefix,
  stages,
  labels,
  counts,
}: {
  heading: string;
  prefix: string;
  stages: readonly string[];
  labels: Readonly<Record<string, string>>;
  counts: Readonly<Record<string, number>>;
}) {
  return (
    <table className={styles.totalsTable}>
      <caption className={ui.hint}>{heading}</caption>
      <thead>
        <tr>
          <th scope="col">{t.stageColumn}</th>
          <th scope="col">{t.countColumn}</th>
        </tr>
      </thead>
      <tbody>
        {stages.map((stage) => (
          <tr key={stage}>
            <th scope="row">{wordsOr(labels, stage)}</th>
            <td data-testid={`aobprinter-stage-${prefix}-${stage}`}>{counts[stage] ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

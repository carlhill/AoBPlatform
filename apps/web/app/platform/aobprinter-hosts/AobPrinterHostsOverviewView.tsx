'use client';

/**
 * EVERY PRACTICE'S AOBPRINTER HOST, WORST FIRST (PRINTER-HEARTBEAT.md §4,
 * D-2026-10-10-02 decision 10).
 *
 * Counts, versions, times and status only — never a practice's records. Each
 * row names its worst state and opens that practice's twin, where the detail
 * and the operator's Re-baseline live. "Worst" is the order of the ten states
 * on the practice's page, read from the same `hostStates.ts`, so a row's
 * place here and the first state on its page cannot disagree. Sorted here as
 * well as wherever the server sorts, so the order holds whatever arrives.
 *
 * Re-reads itself every 30 s, like the practice's page, and registers the
 * top-bar refresh.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Chip, Notice, Shell, ui, type Tone } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { deviceSeenAgo } from '../../practice/deviceActivity';
import {
  aobPrinterHostRank,
  aobPrinterHostStates,
  type AobPrinterHostSignal,
  type AobPrinterHostState,
} from '../../practice/aobprinter-host/hostStates';
import styles from '../../practice/manage.module.css';
import type { AobPrinterHostOverviewRow } from '@aobplatform/contracts';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const REFRESH_MS = 30_000;

const s = strings.aobprinterHost.overview;

const STATE_TONE: Record<AobPrinterHostState, Tone> = {
  regressed: 'stop',
  second_host: 'stop',
  local_check_failed: 'stop',
  offline: 'stop',
  stale: 'warn',
  open_exceptions: 'warn',
  filed_unconfirmed: 'warn',
  old_queue: 'warn',
  clock_skew: 'warn',
  healthy: 'ok',
  never_reported: 'neutral',
};

function signalOf(row: AobPrinterHostOverviewRow): AobPrinterHostSignal {
  return {
    liveness: row.liveness,
    chainStatus: row.chainStatus,
    secondHostReporting: row.secondHostReporting,
    localCheckFailed: !row.localCheckOk,
    openExceptions: row.openExceptions,
    filedUnconfirmed: row.filedUnconfirmed,
    staleQueued: row.staleQueued,
    clockSkewMs: row.clockSkewMs,
  };
}

export function AobPrinterHostsOverviewView() {
  const [rows, setRows] = useState<AobPrinterHostOverviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/platform/aobprinter-hosts`, { headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as {
        hosts?: AobPrinterHostOverviewRow[];
        message?: string | string[];
        reasonCode?: string;
      };
      if (!res.ok) {
        const message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? String(res.status));
        throw new Error(body.reasonCode ? `${message} (${body.reasonCode})` : message);
      }
      setRows(body.hosts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, []);

  useRefreshable(load);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const now = Date.now();
  // Stable: rows in the same state keep the order they arrived in.
  const ranked = (rows ?? [])
    .map((row, index) => ({ row, index, signal: signalOf(row) }))
    .sort((a, b) => aobPrinterHostRank(a.signal) - aobPrinterHostRank(b.signal) || a.index - b.index)
    .map(({ row, signal }) => ({ row, state: aobPrinterHostStates(signal)[0] }));

  return (
    <Shell right={<SessionControl audience={s.audience} />} title={s.title} lead={s.lead}>
      {error && (
        <Notice tone="stop" title={s.notLoaded}>
          {error}
        </Notice>
      )}
      {rows === null && !error && <p className={ui.hint}>{strings.aobprinterHost.loading}</p>}
      {rows !== null && rows.length === 0 && (
        <p className={ui.hint} data-testid="aobprinter-overview-none">
          {s.none}
        </p>
      )}

      {ranked.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.totalsTable}>
            <thead>
              <tr>
                <th scope="col">{s.practiceColumn}</th>
                <th scope="col">{s.stateColumn}</th>
                <th scope="col">{s.lastSeenColumn}</th>
                <th scope="col">{s.versionColumn}</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ row, state }) => (
                <tr key={row.practiceId} data-testid={`aobprinter-overview-row-${row.practiceId}`}>
                  <th scope="row">
                    <Link
                      href={`/platform/practices/${row.practiceId}/aobprinter-host`}
                      data-testid={`aobprinter-overview-link-${row.practiceId}`}
                    >
                      {row.practiceName ?? row.practiceId}
                    </Link>
                  </th>
                  <td>
                    <Chip tone={STATE_TONE[state]}>{s.states[state]}</Chip>
                    {state === 'regressed' && row.regressionKind && (
                      <span className={ui.mono}> {row.regressionKind}</span>
                    )}
                  </td>
                  <td>{row.lastSeenAt ? s.lastSeen(deviceSeenAgo(row.lastSeenAt, now)) : s.neverSeen}</td>
                  <td>
                    <span className={ui.mono}>{row.printerVersion ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

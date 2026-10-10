'use client';

/**
 * RE-BASELINE A REGRESSED AOBPRINTER CHAIN — the platform operator's act alone
 * (D-2026-10-10-02 decision 7; PRINTER-HEARTBEAT.md §3–§4).
 *
 * `POST /aobprinter-hosts/:hostId/rebaseline` with `{ reasonCode }`. Core
 * requires PLATFORM_ADMIN and a fresh second factor, and refuses a code that
 * is not in the versioned reason list. The list offered here is that same
 * list (`AOBPRINTER_REBASELINE_REASON_KEYS`, in file order), with labels from
 * the string table — option lists are content, not code (CLAUDE.md §7c).
 *
 * A REFUSAL THAT ASKS WHO IS THERE GETS THE CONTROL THAT ANSWERS IT, the same
 * three branches as the tablets page: a stale sign-in re-runs the sign-in
 * here; an account with no second factor is told what it lacks; any other
 * code shows the code (§7c — an unmapped reason code shows its code).
 *
 * The request carries no practice header: this is the platform's act on a
 * host row it names by id, not something done as the practice.
 */

import { useState } from 'react';
import { AOBPRINTER_REBASELINE_REASON_KEYS } from '@aobplatform/domain';
import type { AobPrinterHostRow } from '@aobplatform/contracts';
import { Button, Field, Notice, Section, SelectInput, ui } from '../../../../ui';
import { apiHeaders, beginLogin } from '../../../../auth';
import { strings } from '../../../../strings';
import { hash8 } from '../../../../practice/aobprinter-host/hostStates';
import uiStyles from '../../../../ui/ui.module.css';
import styles from '../../../../practice/manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

const r = strings.aobprinterHost.rebaseline;
const REASON_LABELS: Readonly<Record<string, string>> = r.reasons;

export function RebaselinePanel({
  hosts,
  onBusy,
  onDone,
}: {
  hosts: readonly AobPrinterHostRow[];
  onBusy: (busy: boolean) => void;
  onDone: () => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A retired chain is not re-baselined (core refuses it, `aobprinter_chain_retired`), so it is not offered.
  const regressed = hosts.filter((host) => host.chain.status === 'regressed' && host.retiredAt === null);
  if (regressed.length === 0) return null;

  async function rebaseline(host: AobPrinterHostRow) {
    const reasonCode = reasons[host.id];
    if (!reasonCode) return;
    setBusy(true);
    onBusy(true);
    setError(null);
    setErrorCode(null);
    setDone(false);
    try {
      const res = await fetch(`${CORE_URL}/aobprinter-hosts/${encodeURIComponent(host.id)}/rebaseline`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ reasonCode }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[]; reasonCode?: string };
        setError(Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? String(res.status)));
        setErrorCode(body.reasonCode ?? null);
        return;
      }
      setDone(true);
      setReasons((prev) => ({ ...prev, [host.id]: '' }));
      onDone();
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <div className={uiStyles.main}>
      {done && (
        <Notice tone="ok" title={r.action} data-testid="aobprinter-rebaseline-done">
          {r.done}
        </Notice>
      )}
      {error && !errorCode && (
        <Notice tone="stop" title={r.refused}>
          {error}
        </Notice>
      )}
      {errorCode && (
        <Notice tone="stop" title={r.stepUpTitle} data-testid="aobprinter-rebaseline-step-up">
          {errorCode === 'reauthentication_required' && (
            <>
              <p>{r.stepUpReauthenticate}</p>
              <Button
                variant="primary"
                onClick={() => void beginLogin(undefined, { reauthenticate: true })}
                data-testid="aobprinter-rebaseline-step-up-action"
              >
                {r.stepUpAction}
              </Button>
            </>
          )}
          {errorCode === 'second_factor_required' && <p>{r.stepUpSecondFactorMissing}</p>}
          {errorCode !== 'reauthentication_required' && errorCode !== 'second_factor_required' && (
            <p data-testid="aobprinter-rebaseline-unmapped">{r.stepUpUnmapped(errorCode)}</p>
          )}
        </Notice>
      )}

      {regressed.map((host, index) => {
        const reason = reasons[host.id] ?? '';
        return (
          <div key={host.id} data-testid={`aobprinter-rebaseline-${host.id}`}>
            <Section number={index + 1} title={r.title(hash8(host.chainId))}>
              <p className={ui.hint}>{r.lead}</p>
              <div className={styles.addPanel}>
                <Field label={r.reasonLabel}>
                  {(field) => (
                    <SelectInput
                      {...field}
                      value={reason}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [host.id]: e.target.value }))}
                      data-testid={`aobprinter-rebaseline-reason-${host.id}`}
                    >
                      <option value="">{r.reasonPlaceholder}</option>
                      {AOBPRINTER_REBASELINE_REASON_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {REASON_LABELS[key] ?? key}
                        </option>
                      ))}
                    </SelectInput>
                  )}
                </Field>
                <div className={styles.formActions}>
                  <Button
                    variant="primary"
                    disabled={busy || reason === ''}
                    onClick={() => void rebaseline(host)}
                    data-testid={`aobprinter-rebaseline-action-${host.id}`}
                  >
                    {busy ? r.busy : reason === '' ? r.blocked : r.action}
                  </Button>
                </div>
              </div>
            </Section>
          </div>
        );
      })}
    </div>
  );
}

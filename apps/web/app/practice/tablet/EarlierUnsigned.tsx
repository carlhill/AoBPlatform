'use client';

/**
 * "UNSIGNED FROM EARLIER DAYS: N" — the line under today's list on the tablet
 * page (D-2026-10-10-01, option 1).
 *
 * THE PROBLEM. `pushable` lists today's agreements only, so one still unsigned
 * at midnight dropped off this page with no word and stayed unsigned for ever.
 * This names how many there are and, opened, says for each one what the
 * platform OBSERVED about its service — and links to the exact place it is
 * dealt with:
 *
 *  - a service record names it and it is on the Reconciliation queue → that
 *    item, opened, on `/practice/reconciliation?item=<serviceRecordId>`;
 *  - a service record names it and a Reconciliation decision closed it → the
 *    decision, in words, and the patient's page;
 *  - no service record names it → the patient's page, which lists every
 *    agreement of theirs in its history. There is no page for one agreement in
 *    this console (`RefusalDescription`), and a link to one would 404.
 *
 * NEVER GENERIC ADVICE (wow.md §13). No "please follow up": what to do with
 * yesterday's unsigned agreement depends on the visit, and the link goes to
 * where that is decided. An unmapped reason shows its own code.
 *
 * READ ONLY, AND NEVER IN THE WAY (hard rule 8). It is its own fetch, not part
 * of the desk's three-second poll — it changes at midnight, not every three
 * seconds — and a failure leaves one quiet line, never a broken desk. Hidden
 * entirely when there is nothing to say.
 *
 * NO MORE ABOUT THE PATIENT THAN TODAY'S ROWS SHOW: the name and the two
 * record ids, through the same `PatientIdentity` (hard rule 1 — neither is a
 * Medicare number, and there is no column for one).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PatientIdentity, ui } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders } from '../../auth';
import { useRefreshable } from '../../refresh';
import { RECONCILIATION_ITEM_PARAM } from '../reconciliation/ReconciliationView';
import styles from '../manage.module.css';
import { bornOn, destination, type PushDesk } from './pushDesk';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** `GET /tablet-sessions/unsigned-earlier`, one row — `EarlierUnsignedRow` in core. */
export interface EarlierUnsignedRow {
  agreementId: string;
  agreementType: string;
  status: string;
  patientId: string;
  patientName: string;
  patientRecordNumber: string | null;
  providerName: string | null;
  /** The day it was for, ISO. */
  forDate: string;
  reason: string;
  serviceRecordId: string | null;
  reconciliationDecision: string | null;
}

export interface EarlierUnsignedList {
  total: number;
  rows: EarlierUnsignedRow[];
}

/**
 * WHAT THE PLATFORM FOUND, IN WORDS — and the code itself where we have no
 * words for it (CLAUDE.md §7c).
 */
export function earlierReasonText(row: Pick<EarlierUnsignedRow, 'reason' | 'reconciliationDecision'>): string {
  if (row.reason === 'service_decided') {
    const code = row.reconciliationDecision;
    return code
      ? strings.tablet.earlierDecided(strings.reconciliation.decisionNames[code] ?? code)
      : strings.tablet.earlierReasonUnknown(row.reason);
  }
  return strings.tablet.earlierReason[row.reason] ?? strings.tablet.earlierReasonUnknown(row.reason);
}

/**
 * THE REASONS WHOSE LINE GOES TO A RECONCILIATION ITEM rather than the
 * patient's page. The three association reasons (D-2026-10-10-09, option (b))
 * link to the SERVICE's item, never to the draft.
 */
const ITEM_LINKED_REASONS: readonly string[] = [
  'service_in_reconciliation',
  'service_associated',
  'service_choice_needed',
  'service_associated_other',
];

/**
 * WHERE THIS ROW IS DEALT WITH — the Reconciliation item while one is on the
 * queue, otherwise the patient's page. Routed through `destination`, so a
 * platform operator gets the read-only twin and a link the caller may not
 * open is hidden rather than left to refuse them.
 */
export function earlierLink(
  row: Pick<EarlierUnsignedRow, 'reason' | 'serviceRecordId' | 'patientId'>,
  ctx: Pick<PushDesk, 'audiences' | 'practiceId'>,
) {
  if (ITEM_LINKED_REASONS.includes(row.reason) && row.serviceRecordId) {
    return destination(
      '/practice/reconciliation',
      strings.tablet.earlierToReconciliation,
      ctx,
      `?${RECONCILIATION_ITEM_PARAM}=${encodeURIComponent(row.serviceRecordId)}`,
    );
  }
  return destination(`/practice/patients/${row.patientId}`, strings.tablet.toPatient, ctx);
}

export function EarlierUnsigned({ desk }: { desk: Pick<PushDesk, 'audiences' | 'practiceId'> }) {
  const { practiceId } = desk;
  const [list, setList] = useState<EarlierUnsignedList | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!practiceId) return;
    const res = await fetch(`${CORE_URL}/tablet-sessions/unsigned-earlier`, {
      headers: apiHeaders(practiceId),
    }).catch(() => null);
    if (!res) {
      setFailure(strings.tablet.earlierUnreachable);
      return;
    }
    if (!res.ok) {
      setFailure(String(res.status));
      return;
    }
    const body = (await res.json().catch(() => null)) as EarlierUnsignedList | null;
    if (!body || typeof body.total !== 'number' || !Array.isArray(body.rows)) {
      setFailure(String(res.status));
      return;
    }
    setFailure(null);
    setList(body);
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);
  useRefreshable(load);

  if (failure && list === null) {
    return (
      <p className={ui.hint} data-testid="earlier-not-loaded">
        {strings.tablet.earlierNotLoaded(failure)}
      </p>
    );
  }
  if (!list || list.total === 0) return null;

  return (
    <details data-testid="earlier-unsigned">
      <summary data-testid="earlier-summary">
        <strong>{strings.tablet.earlierSummary(list.total)}</strong>
      </summary>
      <p className={ui.hint}>{strings.tablet.earlierLead}</p>
      <ul className={styles.queueList} data-testid="earlier-list">
        {list.rows.map((row) => {
          const link = earlierLink(row, desk);
          return (
            <li key={row.agreementId} className={ui.hint} data-testid={`earlier-${row.agreementId}`}>
              <strong>{row.patientName}</strong>
              <PatientIdentity
                practiceNumber={row.patientRecordNumber}
                recordId={row.patientId}
                testId={`earlier-patient-id-${row.agreementId}`}
              />
              <span data-testid={`earlier-for-${row.agreementId}`}>
                {strings.tablet.earlierFor(bornOn(row.forDate), row.providerName)}
              </span>
              {' · '}
              <span data-testid={`earlier-reason-${row.agreementId}`}>{earlierReasonText(row)}</span>
              {link && (
                <>
                  {' '}
                  <Link href={link.href} data-testid={`earlier-link-${row.agreementId}`}>
                    {link.label}
                  </Link>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {list.rows.length < list.total && (
        <p className={ui.hint} data-testid="earlier-capped">
          {strings.tablet.earlierCapped(list.rows.length, list.total)}
        </p>
      )}
    </details>
  );
}

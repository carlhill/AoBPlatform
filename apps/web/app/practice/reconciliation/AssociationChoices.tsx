'use client';

/**
 * WHICH UNSIGNED AGREEMENT WAS THIS VISIT'S? (D-2026-10-10-09; Carl, 10 Oct
 * 2026: option (b), "associate, do not link").
 *
 * When a service is recorded, an unsigned pre-agreement for the same patient,
 * servicing provider and practice-local day is ASSOCIATED with it -- never
 * linked, so the after-service agreement is still drafted and chased. Exactly
 * one match is associated by the platform. Where it cannot be (more than one
 * matched, or a draft appeared after the service did), the service is listed
 * here with every matching draft named, and a person chooses.
 *
 * NEVER GENERIC ADVICE (wow.md §13). Each line says what was found -- how many
 * drafts match and on what -- and nothing about why there are two, which the
 * platform does not know. An unmapped reason shows its own code.
 *
 * ITS OWN FETCH, AND A FAILURE IS ONE QUIET NOTICE (hard rule 8): the queue
 * below it does not depend on this list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { audiencesOf, type Audience } from '@aobplatform/domain';
import { Button, Notice, ui } from '../../ui';
import { apiHeaders, currentSession } from '../../auth';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { bornOn } from '../tablet/pushDesk';
import { mayActOnDescriptions } from './ServiceDescriptionsNeeded';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** `GET /reconciliation/association-choices`, one item — `AssociationChoiceItem` in core. */
export interface AssociationChoiceItem {
  serviceRecordId: string;
  serviceDate: string;
  patientId: string | null;
  patientName: string | null;
  providerName: string | null;
  reason: string;
  candidates: {
    agreementId: string;
    type: string;
    status: string;
    forDay: string;
    createdAt: string;
    providerName: string | null;
  }[];
}

/** What was found, in words, or the code where there are none (CLAUDE.md §7c). */
export function choiceReasonText(item: Pick<AssociationChoiceItem, 'reason' | 'candidates'>): string {
  const words = strings.reconciliation.associationChoice.reasons[item.reason];
  return words ? words(item.candidates.length) : strings.reconciliation.associationChoice.reasonUnknown(item.reason);
}

/** One draft, as a line: what kind, where it is, the day it was for and when it was made. */
export function candidateText(candidate: AssociationChoiceItem['candidates'][number]): string {
  const s = strings.reconciliation.associationChoice;
  const made = new Date(candidate.createdAt);
  const madeAt = Number.isNaN(made.getTime())
    ? candidate.createdAt
    : made.toLocaleString('en-AU', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Australia/Sydney',
      });
  return s.candidateLine(
    s.types[candidate.type] ?? candidate.type,
    s.statuses[candidate.status] ?? candidate.status,
    bornOn(candidate.forDay),
    madeAt,
  );
}

export function AssociationChoices({
  practiceId,
  onLoaded,
}: {
  practiceId: string;
  /** The service record ids on this list, so the page's `?item=` link can find one here. */
  onLoaded?: (serviceRecordIds: string[]) => void;
}) {
  const [items, setItems] = useState<AssociationChoiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  /* THE SESSION'S OWN CLAIM decides whether the act is offered, as on the list above it. */
  const audiences: Audience[] = useMemo(() => {
    const session = currentSession();
    return audiencesOf({
      roles: session?.roles,
      practiceId: session?.practiceId ?? null,
      practitionerId: session?.practitionerId,
    });
  }, []);
  const mayAct = mayActOnDescriptions(audiences);

  const load = useCallback(async () => {
    if (!practiceId) return;
    const res = await fetch(`${CORE_URL}/reconciliation/association-choices`, {
      headers: apiHeaders(practiceId),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(res ? String(res.status) : strings.status.unreachable);
      onLoaded?.([]);
      return;
    }
    const body = (await res.json().catch(() => null)) as AssociationChoiceItem[] | null;
    if (!Array.isArray(body)) {
      setError(String(res.status));
      onLoaded?.([]);
      return;
    }
    setError(null);
    setItems(body);
    onLoaded?.(body.map((item) => item.serviceRecordId));
  }, [practiceId, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);
  useRefreshable(load);

  async function choose(item: AssociationChoiceItem, agreementId: string) {
    setBusyId(item.serviceRecordId);
    setOutcome(null);
    try {
      const res = await fetch(`${CORE_URL}/reconciliation/${item.serviceRecordId}/associate`, {
        method: 'POST',
        headers: { ...apiHeaders(practiceId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreementId }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? strings.reconciliation.associationChoice.chooseFailed);
      setOutcome({ id: item.serviceRecordId, text: strings.reconciliation.associationChoice.chosen, ok: true });
      await load();
    } catch (e) {
      setOutcome({
        id: item.serviceRecordId,
        text: e instanceof TypeError ? strings.status.unreachable : (e as Error).message,
        ok: false,
      });
    } finally {
      setBusyId(null);
    }
  }

  const s = strings.reconciliation.associationChoice;
  if (error && items === null) {
    return (
      <p className={ui.hint} data-testid="association-choices-not-loaded">
        {s.notLoaded(error)}
      </p>
    );
  }
  if (!items || items.length === 0) {
    return outcome?.ok ? (
      <Notice tone="ok" title={outcome.text} data-testid="association-choice-outcome">
        {null}
      </Notice>
    ) : null;
  }

  return (
    <section data-testid="association-choices">
      <h2 className={ui.sectionTitle}>
        <GitMerge size={16} aria-hidden="true" /> {s.title}
      </h2>
      <p className={ui.hint}>{s.lead}</p>
      {outcome && (
        <Notice tone={outcome.ok ? 'ok' : 'stop'} title={outcome.ok ? outcome.text : s.chooseFailed} data-testid="association-choice-outcome">
          {outcome.ok ? null : outcome.text}
        </Notice>
      )}
      <ul className={styles.queueList} data-testid="association-choices-list">
        {items.map((item) => (
          <li
            key={item.serviceRecordId}
            id={`reconciliation-choice-${item.serviceRecordId}`}
            tabIndex={-1}
            className={styles.queueRow}
            data-testid={`association-choice-${item.serviceRecordId}`}
          >
            <div>
              <strong>{item.patientName ?? '—'}</strong> · {bornOn(item.serviceDate)}
              {item.providerName ? ` · ${item.providerName}` : ''}
            </div>
            <p className={ui.hint} data-testid={`association-choice-reason-${item.serviceRecordId}`}>
              {choiceReasonText(item)}
            </p>
            <ul className={ui.plainList}>
              {item.candidates.map((candidate) => (
                <li key={candidate.agreementId} data-testid={`association-candidate-${candidate.agreementId}`}>
                  {candidateText(candidate)}{' '}
                  {mayAct && (
                    <Button
                      variant="subtle"
                      onClick={() => void choose(item, candidate.agreementId)}
                      disabled={busyId !== null}
                      data-testid={`association-choose-${candidate.agreementId}`}
                    >
                      {busyId === item.serviceRecordId ? s.choosing : s.choose}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!mayAct && <p className={ui.hint}>{s.viewOnly}</p>}
            <p className={ui.hint}>{s.postNotAffected}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

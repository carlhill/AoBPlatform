'use client';

/**
 * The human validation queue — gate 3.
 *
 * Ordered WORST FIRST, not by arrival. Every application here has already
 * passed its check digits and the register, so they all look fine; a queue in
 * arrival order asks the reviewer to find the one that needs attention by
 * reading all of them, which is exactly the conditions under which people stop
 * reading. Age breaks ties, so nothing quiet waits forever.
 *
 * Each row states, before it is opened, why it might need attention. A reviewer
 * who has to open twenty applications to find out which one matters will
 * eventually open none of them properly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Inbox, Search } from 'lucide-react';
import { compareForReview, reviewFlags, type ReviewFlag } from '@aobplatform/domain';
import { Chip, Field, Notice, Shell, TextInput, ui } from '../ui';
import { useRefreshable } from '../refresh';
import { strings } from '../strings';
import { FlagChip } from './flags';
import styles from './review.module.css';
import { SessionControl } from '../SessionControl';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * One row of the pending queue, as the API returns it.
 *
 * Declared once and shared with the dossier, which reads the SAME endpoint —
 * an application is only reviewable while it is still waiting, so there is no
 * second source to drift from. It deliberately carries no provider numbers and
 * no patient data: neither is any part of deciding whether an applicant may act
 * for an entity, and a screen cannot leak what it never received.
 */
export interface QueueRow {
  id: string;
  name: string;
  abn: string;
  acn?: string | null;
  legalName?: string | null;
  tradingNames?: string[] | null;
  entityType?: string | null;
  abnStatus?: string | null;
  nameMatchTier?: string | null;
  nameMatchedOn?: string | null;
  createdAt: string;
  abnVerificationSource?: string | null;
  abnSightedByName?: string | null;
  adminName?: string | null;
  adminEmail?: string | null;
  adminPhone?: string | null;
  adminPosition?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerPhone?: string | null;
  managerPosition?: string | null;
  website?: string | null;
  headOfficeAddress?: string | null;
  headOfficeState?: string | null;
  credentialType?: string | null;
  credentialValue?: string | null;
}

/** "27734610304" reads as a number; "27 734 610 304" reads as an ABN. */
export function formatAbn(abn: string): string {
  const d = abn.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : abn;
}

/** How long it has waited, in the terms a person would say it. */
export function waitedFor(createdAt: string, now: Date): string {
  const ms = now.getTime() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return 'today';
}

export function QueueView() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Rendered on the client only, so the server and client cannot disagree
  // about "now" and produce a hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);

  const load = useCallback(() => {
    setNow(new Date());
    setError(null);
    return fetch(`${CORE_URL}/organisations/pending`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => setRows(data.organisations ?? []))
      // A dead connection throws a TypeError reading "Failed to fetch" — a DOM
      // exception string, not an answer. Say what happened instead.
      .catch((e: Error) => setError(e instanceof TypeError ? strings.review.unreachableBody : e.message));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A queue is stale the moment somebody else decides an application.
  useRefreshable(load);

  const ordered = useMemo(() => {
    if (!rows) return [];
    const withFlags = rows.map((row) => ({ row, flags: reviewFlags(row) as ReviewFlag[] }));
    const needle = filter.trim().toLowerCase();
    const matched = needle
      ? withFlags.filter(
          ({ row }) =>
            row.name.toLowerCase().includes(needle) ||
            (row.legalName ?? '').toLowerCase().includes(needle) ||
            row.abn.replace(/\D/g, '').includes(needle.replace(/\D/g, '')),
        )
      : withFlags;
    return [...matched].sort((a, b) =>
      compareForReview({ flags: a.flags, createdAt: a.row.createdAt }, { flags: b.flags, createdAt: b.row.createdAt }),
    );
  }, [rows, filter]);

  return (
    <Shell right={<SessionControl audience={strings.review.audience} />}
      title={strings.review.queueTitle}
      lead={strings.review.queueLead}
    >

      {/*
        The queue answers "what is in front of me today". The dashboard answers
        "what is going wrong across everything", which is a different question
        and a different rhythm — so it is a link from here rather than another
        panel on this page competing with the work.
      */}
      <p className={ui.hint}>
        <Link href="/review/identity" data-testid="queue-to-identity">
          {strings.review.toIdentity}
        </Link>{' '}
        {strings.review.toIdentityHint}
      </p>

      {error && (
        <Notice
          tone="stop"
          title={error === strings.review.unreachableBody ? strings.review.unreachable : 'The queue could not be loaded'}
        >
          {error}
        </Notice>
      )}

      <div className={styles.queueControls}>
        <Field label={strings.review.queueSearch} hint={strings.review.queueSearchHint}>
          {(props) => (
            <div className={styles.searchWrap}>
              <Search size={16} aria-hidden="true" className={styles.searchIcon} />
              <TextInput
                {...props}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="XLEVELUP, or 27 734 610 304"
                data-testid="review-filter"
              />
            </div>
          )}
        </Field>
        {rows && (
          <p className={styles.queueMeta} data-testid="review-count">
            <strong>{rows.length}</strong> {strings.review.queueCount} · {strings.review.queueSortNote}
          </p>
        )}
      </div>

      {rows && rows.length === 0 && (
        <div className={styles.empty}>
          <Inbox size={28} aria-hidden="true" />
          <p className={styles.emptyTitle}>{strings.review.queueEmptyTitle}</p>
          <p className={ui.hint}>{strings.review.queueEmpty}</p>
        </div>
      )}

      {rows && rows.length > 0 && ordered.length === 0 && (
        <Notice tone="warn">{strings.review.queueNoMatch}</Notice>
      )}

      <ul className={styles.queue}>
        {ordered.map(({ row, flags }) => (
          <li key={row.id}>
            <Link href={`/review/${row.id}`} className={styles.queueRow} data-testid={`review-row-${row.abn}`}>
              <div className={styles.queueMain}>
                <div className={styles.queueName}>{row.name}</div>
                <div className={styles.queueSub}>
                  {row.legalName && row.legalName !== row.name ? `${row.legalName} · ` : ''}
                  ABN {formatAbn(row.abn)}
                </div>
                <div className={styles.flagRow}>
                  {flags.length === 0 ? (
                    <Chip tone="neutral">Nothing flagged</Chip>
                  ) : (
                    flags.map((flag) => <FlagChip key={flag.key} flag={flag} />)
                  )}
                </div>
              </div>
              <div className={styles.queueAside}>
                <span className={ui.hint}>{now ? `Waiting ${waitedFor(row.createdAt, now)}` : ''}</span>
                <span className={styles.queueOpen}>
                  {strings.review.queueOpen}
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

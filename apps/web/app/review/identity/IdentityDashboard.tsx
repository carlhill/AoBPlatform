'use client';

/**
 * The two identity dashboards (IDENTITY-STRENGTH-DESIGN.md §7).
 *
 * EACH ANSWERS ONE OPERATIONAL QUESTION, and the page says which above the
 * list. "Which applications are stuck, and on what?" and "Whose verification is
 * going stale, and who is moving unusually?" A dashboard without a question is
 * a report nobody opens twice.
 *
 * THE "WOULD FAIL" COUNT IS THE POINT OF SOFT MODE. It shows, live, what hard
 * enforcement would cost: how many real practices we would be turning away
 * today. That number decides when the threshold is safe to switch on, and it is
 * invisible unless soft runs first — you cannot calibrate a threshold you are
 * already enforcing, because you never see the outcomes of what you rejected.
 *
 * THE SCORE IS NEVER SHOWN ALONE. Every row carries the weakest link beside it,
 * because a number without "and here is what to do about it" has moved the work
 * to the reader rather than done it. That is the same rule the setup hub
 * follows: promote the problem, do not make somebody scan for it.
 *
 * NOTHING HERE REFUSES ANYBODY. The scoring is soft by design (§2), and the
 * page says so at the top rather than letting a red number read as a decision.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Clock, Search, ShieldAlert, TrendingUp, X } from 'lucide-react';
import { Button, Chip, Field, Notice, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders } from '../../auth';
import styles from './identity.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface PracticeRow {
  id: string;
  name: string;
  legalName: string | null;
  abn: string | null;
  abnStatus: string | null;
  state: string | null;
  validationState: string;
  daysInQueue: number;
  stillWaiting: boolean;
  score: number;
  summary: { performed: number; passed: number; failed: number; incomplete: number };
  wouldPass: boolean;
  wouldFailBecause: string[];
  weakestLink: string | null;
  artefactCount: number;
  credentialCount: number;
  verifiedCredentialCount: number;
}

interface PractitionerRow {
  id: string;
  ahpraNumber: string;
  familyName: string;
  givenNames: string;
  profession: string | null;
  registrationStatus: string | null;
  score: number;
  potentialScore: number;
  freshness: number;
  sightingAgeDays: number | null;
  blocking: string[];
  negatives: string[];
  weakestLink: string | null;
  affiliationCount: number;
  activeAffiliationCount: number;
  velocityAnomalous: boolean;
  acceptedByPasskey: number;
  acceptedByEmail: number;
  deregisteredAt: string | null;
}

type Tab = 'practices' | 'practitioners';

/** Practice filters, each one an operational question rather than a category. */
const PRACTICE_FILTERS = ['all', 'would_fail', 'waiting', 'no_checks'] as const;
const PRACTITIONER_FILTERS = ['all', 'blocked', 'never_checked', 'stale', 'restricted', 'moving'] as const;

function matchesPracticeFilter(filter: string, row: PracticeRow): boolean {
  switch (filter) {
    case 'would_fail':
      return !row.wouldPass;
    case 'waiting':
      return row.stillWaiting;
    case 'no_checks':
      return row.summary.performed === 0;
    default:
      return true;
  }
}

function matchesPractitionerFilter(filter: string, row: PractitionerRow): boolean {
  switch (filter) {
    case 'blocked':
      return row.blocking.length > 0;
    case 'never_checked':
      // Different from stale, and worse. Nobody has ever looked, so there is
      // no sighting to decay -- lumping the two together hid which of the
      // eleven rows needed a first check and which needed a repeat.
      return row.sightingAgeDays === null;
    case 'stale':
      return row.sightingAgeDays !== null && row.freshness < 1;
    case 'restricted':
      return row.negatives.some((n) => /conditions, undertakings or reprimands/i.test(n));
    case 'moving':
      return row.velocityAnomalous;
    default:
      return true;
  }
}

/** "1 days" is the kind of thing that makes a screen look unfinished. */
function queueLabel(days: number, waiting: boolean): string {
  if (days === 0) {
    return waiting ? strings.identity.practiceWaitingToday : strings.identity.practiceQueueToday;
  }
  if (days === 1) {
    return waiting ? strings.identity.practiceQueueOne : strings.identity.practiceDecidedOne;
  }
  return (waiting ? strings.identity.practiceQueue : strings.identity.practiceDecided).replace(
    '{n}',
    String(days),
  );
}

function sightingLabel(days: number | null): string {
  if (days === null) return strings.identity.sightedNever;
  if (days === 0) return strings.identity.sightedToday;
  if (days === 1) return strings.identity.sightedOne;
  return strings.identity.sightedDays.replace('{n}', String(days));
}

function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

export function IdentityDashboard() {
  const [tab, setTab] = useState<Tab>('practices');
  const [practices, setPractices] = useState<PracticeRow[] | null>(null);
  const [practitioners, setPractitioners] = useState<PractitionerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch(`${CORE_URL}/identity/practices`, { headers: apiHeaders() }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
      fetch(`${CORE_URL}/identity/practitioners`, { headers: apiHeaders() }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      ),
    ])
      .then(([p, pr]: [PracticeRow[], PractitionerRow[]]) => {
        if (!live) return;
        setPractices(p);
        setPractitioners(pr);
      })
      .catch((e: Error) =>
        live && setError(e instanceof TypeError ? strings.review.unreachableBody : e.message),
      );
    return () => {
      live = false;
    };
  }, []);

  // Switching tab resets the filter, because the filters mean different things
  // on each and carrying "would_fail" across to practitioners would silently
  // show everything.
  function switchTab(next: Tab) {
    setTab(next);
    setFilter('all');
    setQuery('');
  }

  const shownPractices = useMemo(() => {
    if (!practices) return [];
    return practices
      .filter((r) => matchesPracticeFilter(filter, r) && matchesQuery(query, [r.name, r.legalName, r.abn]))
      // WORST FIRST: what would fail, then what is waiting longest.
      .sort((a, b) => {
        if (a.wouldPass !== b.wouldPass) return a.wouldPass ? 1 : -1;
        if (a.stillWaiting !== b.stillWaiting) return a.stillWaiting ? -1 : 1;
        return b.daysInQueue - a.daysInQueue;
      });
  }, [practices, filter, query]);

  const shownPractitioners = useMemo(() => {
    if (!practitioners) return [];
    return practitioners
      .filter(
        (r) =>
          matchesPractitionerFilter(filter, r) &&
          matchesQuery(query, [r.familyName, r.givenNames, r.ahpraNumber]),
      )
      // Blocked first, then weakest, then stalest.
      .sort((a, b) => {
        if ((a.blocking.length > 0) !== (b.blocking.length > 0)) return a.blocking.length > 0 ? -1 : 1;
        if (a.score !== b.score) return a.score - b.score;
        return (b.sightingAgeDays ?? Infinity) - (a.sightingAgeDays ?? Infinity);
      });
  }, [practitioners, filter, query]);

  if (error) {
    return (
      <Shell right={strings.identity.audience}>
        <Notice tone="stop" title={strings.identity.notLoaded}>
          {error}
        </Notice>
      </Shell>
    );
  }

  const wouldFail = (practices ?? []).filter((r) => !r.wouldPass).length;
  const wouldPass = (practices ?? []).length - wouldFail;
  const filters: readonly string[] = tab === 'practices' ? PRACTICE_FILTERS : PRACTITIONER_FILTERS;
  const total = tab === 'practices' ? (practices ?? []).length : (practitioners ?? []).length;
  const shown = tab === 'practices' ? shownPractices.length : shownPractitioners.length;

  return (
    <Shell right={strings.identity.audience}>
      <Link href="/review" className={ui.hint} data-testid="identity-back">
        <ArrowLeft size={14} aria-hidden="true" /> {strings.identity.backToQueue}
      </Link>

      <h1 className={ui.pageTitle}>{strings.identity.title}</h1>
      <p className={ui.pageLead}>{strings.identity.lead}</p>

      {/*
        Said before any number is shown, so a red score reads as information
        rather than as a decision that has already been taken about somebody.
      */}
      <Notice tone="ok" title={strings.identity.softTitle}>
        {strings.identity.softBody}
      </Notice>

      <p className={ui.hint}>
        <Chip tone={wouldFail > 0 ? 'warn' : 'ok'}>
          {strings.identity.wouldFail.replace('{n}', String(wouldFail))}
        </Chip>{' '}
        <Chip tone="neutral">{strings.identity.wouldPass.replace('{n}', String(wouldPass))}</Chip>
      </p>

      <div className={styles.tabs} role="tablist">
        {(['practices', 'practitioners'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`${styles.tab} ${tab === t ? styles.tabOn : ''}`}
            onClick={() => switchTab(t)}
            data-testid={`identity-tab-${t}`}
          >
            {t === 'practices' ? strings.identity.tabPractices : strings.identity.tabPractitioners}
          </button>
        ))}
      </div>

      <p className={styles.question}>
        {tab === 'practices' ? strings.identity.practicesQuestion : strings.identity.practitionersQuestion}
      </p>

      <div className={styles.controls}>
        <div className={styles.searchField}>
          <Field
            label={strings.identity.search}
            hint={
              tab === 'practices'
                ? strings.identity.searchHintPractices
                : strings.identity.searchHintPractitioners
            }
          >
            {(props) => (
              <TextInput
                {...props}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="identity-search"
              />
            )}
          </Field>
        </div>

        <div className={styles.filterRow} role="group" aria-label={strings.identity.search}>
          {filters.map((f) => {
            // The count per filter, so a reader can see a tab is empty before
            // pressing it and finding nothing.
            const count =
              tab === 'practices'
                ? (practices ?? []).filter((r) => matchesPracticeFilter(f, r)).length
                : (practitioners ?? []).filter((r) => matchesPractitionerFilter(f, r)).length;
            return (
              <button
                key={f}
                type="button"
                className={`${styles.filterChip} ${filter === f ? styles.filterChipOn : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                data-testid={`identity-filter-${f}`}
              >
                {strings.identity.filters[f]}
                <span className={styles.filterCount}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className={ui.hint}>
        {strings.identity.showing} <strong>{shown}</strong> {strings.identity.of} {total}
        {(query || filter !== 'all') && (
          <>
            {' '}
            <Button
              variant="subtle"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
              data-testid="identity-clear"
            >
              <X size={13} aria-hidden="true" />
              {strings.identity.clear}
            </Button>
          </>
        )}
      </p>

      {practices === null && <p className={ui.hint}>{strings.identity.loading}</p>}

      {practices !== null && shown === 0 && (
        <div className={styles.empty}>
          <Search size={26} aria-hidden="true" />
          <p>{strings.identity.noMatch}</p>
        </div>
      )}

      {tab === 'practices' && shownPractices.length > 0 && (
        <ul className={styles.list}>
          {shownPractices.map((r) => (
            <li key={r.id}>
              <div className={styles.row} data-testid={`identity-practice-${r.id}`}>
                <div className={styles.score}>
                  <div className={`${styles.scoreValue} ${r.wouldPass ? styles.scoreOk : styles.scoreWeak}`}>
                    {r.score}
                  </div>
                  <div className={styles.scoreNote}>
                    {strings.identity.practiceChecks
                      .replace('{passed}', String(r.summary.passed))
                      .replace('{failed}', String(r.summary.failed))
                      .replace('{incomplete}', String(r.summary.incomplete))}
                  </div>
                </div>

                <div className={styles.main}>
                  <p className={styles.name}>{r.name}</p>
                  <p className={styles.sub}>
                    {r.legalName && r.legalName !== r.name ? `${r.legalName} · ` : ''}
                    ABN {r.abn ?? '—'}
                    {r.state ? ` · ${r.state}` : ''}
                    {' · '}
                    {strings.identity.practiceArtefacts.replace('{n}', String(r.artefactCount))}
                    {' · '}
                    {strings.identity.practiceCredentials
                      .replace('{verified}', String(r.verifiedCredentialCount))
                      .replace('{total}', String(r.credentialCount))}
                  </p>

                  {/* The "on what". A score alone moves the work to the reader. */}
                  {r.summary.performed === 0 ? (
                    <p className={styles.weakest}>{strings.identity.practiceNoChecks}</p>
                  ) : (
                    r.weakestLink && <p className={styles.weakest}>{r.weakestLink}</p>
                  )}
                </div>

                <div className={styles.aside}>
                  <Chip tone={r.wouldPass ? 'ok' : 'warn'}>
                    {r.wouldPass ? strings.identity.practiceWouldPass : strings.identity.practiceWouldFail}
                  </Chip>
                  <Chip tone="neutral">
                    <Clock size={13} aria-hidden="true" />
                    {queueLabel(r.daysInQueue, r.stillWaiting)}
                  </Chip>
                  <Link href={`/review/${r.id}`} className={ui.hint}>
                    {strings.identity.practiceOpen}
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {tab === 'practitioners' && shownPractitioners.length > 0 && (
        <ul className={styles.list}>
          {shownPractitioners.map((r) => {
            const blocked = r.blocking.length > 0;
            const restricted = r.negatives.some((n) => /conditions, undertakings/i.test(n));
            /*
             * The fact only a cross-practice view can see: every one of this
             * person's affiliations resting on one inbox. Not visible to any
             * single practice, because each sees only its own.
             */
            const allOnOneInbox =
              r.affiliationCount > 1 && r.acceptedByEmail === r.affiliationCount && r.acceptedByPasskey === 0;

            return (
              <li key={r.id}>
                <div className={styles.row} data-testid={`identity-practitioner-${r.id}`}>
                  <div className={styles.score}>
                    <div
                      className={`${styles.scoreValue} ${blocked || r.score <= 0 ? styles.scoreWeak : ''}`}
                    >
                      {r.score}
                    </div>
                    {/*
                      What one fresh check would restore. Shown only when it
                      differs, so it reads as an opportunity rather than as
                      noise on every row.
                    */}
                    {r.potentialScore !== r.score && (
                      <div className={styles.scoreNote}>
                        {strings.identity.ofPotential.replace('{n}', String(r.potentialScore))}
                      </div>
                    )}
                  </div>

                  <div className={styles.main}>
                    <p className={styles.name}>
                      {r.familyName}, {r.givenNames}
                    </p>
                    <p className={styles.sub}>
                      {r.ahpraNumber}
                      {r.profession ? ` · ${r.profession}` : ''}
                      {r.registrationStatus ? ` · ${r.registrationStatus}` : ''}
                      {' · '}
                      {strings.identity.affiliations
                        .replace('{active}', String(r.activeAffiliationCount))
                        .replace('{total}', String(r.affiliationCount))}
                    </p>

                    {blocked ? (
                      <p className={styles.blocking}>{r.blocking[0]}</p>
                    ) : (
                      <p className={styles.weakest}>
                        {r.weakestLink ?? strings.identity.nothingOutstanding}
                      </p>
                    )}

                    {allOnOneInbox && <p className={styles.weakest}>{strings.identity.allOnOneInbox}</p>}
                  </div>

                  <div className={styles.aside}>
                    {blocked && (
                      <Chip tone="stop" solid>
                        <ShieldAlert size={13} aria-hidden="true" />
                        {strings.identity.blocked}
                      </Chip>
                    )}
                    <Chip tone={r.freshness === 1 ? 'ok' : r.freshness === 0 ? 'stop' : 'warn'}>
                      {sightingLabel(r.sightingAgeDays)}
                    </Chip>
                    {restricted && (
                      <Chip tone="warn">
                        <AlertTriangle size={13} aria-hidden="true" />
                        {strings.identity.restricted}
                      </Chip>
                    )}
                    {r.velocityAnomalous && (
                      <Chip tone="warn">
                        <TrendingUp size={13} aria-hidden="true" />
                        {strings.identity.moving}
                      </Chip>
                    )}
                    {r.affiliationCount > 0 && (
                      <span className={styles.scoreNote}>
                        {strings.identity.acceptedBy
                          .replace('{passkey}', String(r.acceptedByPasskey))
                          .replace('{email}', String(r.acceptedByEmail))}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}

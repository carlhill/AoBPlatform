'use client';

/**
 * The practices this admin works with.
 *
 * NOT A DEVELOPMENT AFFORDANCE, which is what the first version of this was.
 * A practice administrator can legitimately hold several practices — a group
 * with three clinics, a trust operating two sites under separate ABNs — and
 * managing them is ordinary work, not an edge case. Making them re-pick from a
 * warning-boxed dev list every time was wrong.
 *
 * WORST FIRST, like everything else here. A group manager opening this wants to
 * know which of their practices needs attention, not which comes first
 * alphabetically. The one that cannot capture consent is promoted above the
 * ones quietly working.
 *
 * EVERY STATE, not just approved. Somebody who applies, receives an
 * acknowledgement and comes here must not find an empty page — so an
 * application still being read appears too, marked as waiting and leading to
 * its status page rather than to a hub that approval has not yet opened.
 *
 * A refused application appears and is INERT. Hiding it would leave somebody
 * wondering where their application went; making it clickable would promise
 * somewhere to go, and there is nowhere.
 *
 * WHAT IT WILL LIST once platform sign-in exists: the practices the token says
 * this person administers. Until then it lists all of them, and says so — an
 * honest placeholder is better than a list that looks authoritative and is not
 * scoped to anybody.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock, Search, X } from 'lucide-react';
import { matchesFilter, matchesPractice, mayChoosePractice, type PracticeFilter } from '@aobplatform/domain';
import { Button, Chip, Field, Notice, Shell, TextInput, ui } from '../ui';
import { strings } from '../strings';
import { apiHeaders, attemptSilentLogin, currentSession, beginLogin } from '../auth';
import styles from './practice.module.css';
import { SessionControl } from '../SessionControl';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const SELECTION_KEY = 'aob.practiceId';

interface Practice {
  id: string;
  name: string;
  legalName: string | null;
  tradingNames?: string[] | null;
  abn: string | null;
  acn?: string | null;
  abnStatus: string | null;
  validationState: string;
  // Searched on, because these are what somebody actually has to hand when
  // looking for a clinic: a number from a missed call, an address off a thread.
  adminName?: string | null;
  adminEmail?: string | null;
  adminPhone?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  managerPhone?: string | null;
  locationCount?: number;
  activeLocationCount?: number;
}

interface WithReadiness extends Practice {
  ready: boolean | null;
  headline: string | null;
  /** For an application still waiting: where the applicant can watch it. */
  statusUrl: string | null;
}

export function PracticeList() {
  const router = useRouter();

  /*
   * A PRACTICE USER NEVER SEES THIS PAGE.
   *
   * It lists every organisation on the platform. That is right for an operator
   * choosing which one to work on, and quite wrong for somebody who has exactly
   * one and whose token says which — they would be looking at other people's
   * practices, including their names and ABNs.
   *
   * Sent to their own hub instead of shown an empty list, because the empty
   * list would be a lie about what exists rather than a statement about what is
   * theirs.
   */
  const session = currentSession();
  const scoped = session ? !mayChoosePractice({ roles: session.roles, practiceId: session.practiceId }) : false;

  /*
   * A COLD LOAD HAS NO SESSION, because the token is held in memory only. That
   * is exactly how somebody navigating straight here was shown every practice
   * on the platform: with no session there was no claim to scope them by, and
   * this page enumerates by design.
   *
   * A browser that has signed in before restores silently first, and nothing is
   * fetched or painted until it has. Only a browser that has never signed in
   * falls through to the list.
   */
  /*
   * "Restoring" HAS TO BE ABLE TO END, and it could not.
   *
   * It used to be plain `!session`, which conflates two different things: a
   * restore in flight, and a restore that has already failed. Combined with
   * `if (scoped || restoring) return null` below, the second case rendered
   * NOTHING, for ever — no error, no sign-in prompt, a blank page.
   *
   * Reaching it took one ordinary sequence: sign in, sign out, come back here.
   * `attemptSilentLogin` allows one attempt per tab (correctly — a
   * `login_required` answer would otherwise loop), the marker survived the
   * sign-out, and so the second visit waited on a restore that would never be
   * attempted.
   *
   * The redirect is now the signal. `attemptSilentLogin` resolves `true` when
   * it is navigating to Keycloak and `false` when it has declined to try, and
   * only the first is a reason to keep waiting.
   */
  const [restoreSettled, setRestoreSettled] = useState(false);
  const restoring = !session && !restoreSettled;

  useEffect(() => {
    if (scoped) {
      router.replace('/practice/setup');
      return;
    }
    if (session || restoreSettled) return;
    let live = true;
    void attemptSilentLogin().then((redirecting) => {
      // `true` means the browser is on its way to Keycloak and this component
      // is about to be torn down; settling would only paint a flash first.
      if (live && !redirecting) setRestoreSettled(true);
    });
    return () => {
      live = false;
    };
  }, [scoped, session, restoreSettled, router]);

  const [practices, setPractices] = useState<WithReadiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PracticeFilter>('all');

  useEffect(() => {
    if (scoped || restoring) return;
    let live = true;

    fetch(`${CORE_URL}/organisations?state=all`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(async (data: { organisations: Practice[] }) => {
        const list = data.organisations ?? [];

        // Readiness per practice, so the list can lead with the one that needs
        // attention. Fetched in parallel and failure-tolerant: a practice whose
        // hub cannot be read still appears, with its readiness unknown rather
        // than assumed fine.
        const enriched = await Promise.all(
          list.map(async (p): Promise<WithReadiness> => {
            /*
             * A PENDING application has no hub and no readiness — the hub is
             * what approval opens. What it has instead is a status page, and
             * that is where its row should lead. Omitting these rows entirely
             * was the first version's mistake: somebody applies, receives an
             * acknowledgement, comes here, and finds nothing at all.
             */
            if (p.validationState !== 'validated') {
              let statusUrl: string | null = null;
              try {
                const res = await fetch(`${CORE_URL}/organisations/${p.id}/status-link`);
                if (res.ok) statusUrl = ((await res.json()) as { statusUrl?: string }).statusUrl ?? null;
              } catch {
                // A missing link is not worth failing the row for.
              }
              return { ...p, ready: null, headline: null, statusUrl };
            }

            try {
              const res = await fetch(`${CORE_URL}/organisations/setup`, {
                headers: apiHeaders(p.id),
              });
              if (!res.ok) return { ...p, ready: null, headline: null, statusUrl: null };
              const hub = (await res.json()) as { readiness: { ready: boolean; headline: string } };
              return { ...p, ready: hub.readiness.ready, headline: hub.readiness.headline, statusUrl: null };
            } catch {
              return { ...p, ready: null, headline: null, statusUrl: null };
            }
          }),
        );

        if (!live) return;
        /*
         * Order: what needs work, then what is waiting on us, then what is
         * quietly running, then what was refused.
         *
         * A rejected application sits LAST rather than first, which is the one
         * departure from worst-first on this page. It is not work — there is
         * nothing the reader can do about it here — and promoting it would push
         * the practices they actually operate below a closed one.
         */
        const rank = (p: WithReadiness) => {
          if (p.validationState === 'rejected') return 4;
          if (p.validationState === 'pending') return 1;
          if (p.ready === false) return 0;
          if (p.ready === null) return 2;
          return 3;
        };
        setPractices([...enriched].sort((a, b) => rank(a) - rank(b)));
      })
      .catch((e: Error) =>
        live && setError(e instanceof TypeError ? strings.review.unreachableBody : e.message),
      );

    return () => {
      live = false;
    };
  }, []);

  /*
   * Filtered here rather than on the server. With a handful of practices a
   * round trip per keystroke buys nothing and costs the instant feedback that
   * makes a search box worth having. When a group is large enough for this to
   * matter, the query moves to the API — the matching rules already live in the
   * domain, so both ends would use the same ones.
   */
  const shown = useMemo(() => {
    if (!practices) return [];
    return practices.filter(
      (p) => matchesFilter(filter, p) && matchesPractice(query, p),
    );
  }, [practices, query, filter]);

  const filters: PracticeFilter[] = ['all', 'needs_work', 'capturing', 'being_reviewed', 'not_approved'];

  // Nothing at all while the redirect runs. A flash of other practices' names
  // is still a disclosure of other practices' names.
  if (scoped || restoring) return null;

  /*
   * SIGNED OUT, AND SAYING SO. This page enumerates every practice on the
   * platform, which is not something to show somebody we cannot identify —
   * and falling through to the list "because auth is staged" is how a missing
   * session became a disclosure the first time.
   */
  if (!session) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{strings.auth.signedOutTitle}</h1>
        <p className={ui.pageLead}>{strings.auth.signedOutBody}</p>
        <button type="button" className={ui.buttonLink} onClick={() => void beginLogin()} data-testid="list-sign-in">
          {strings.auth.signIn}
        </button>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <Notice tone="stop" title={strings.practices.notLoaded}>
          {error}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <h1 className={ui.pageTitle}>{strings.practices.title}</h1>
      <p className={ui.pageLead}>{strings.practices.lead}</p>

      {practices !== null && practices.length > 0 && (
        <div className={styles.controls}>
          <div className={styles.searchField}>
            <Field label={strings.practices.search} hint={strings.practices.searchHint}>
              {(props) => (
                <div className={styles.searchWrap}>
                  <Search size={16} aria-hidden="true" className={styles.searchIcon} />
                  <TextInput
                    {...props}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={strings.practices.searchPlaceholder}
                    data-testid="practice-search"
                  />
                </div>
              )}
            </Field>
          </div>

          <div className={styles.filterRow} role="group" aria-label={strings.practices.search}>
            {filters.map((f) => {
              // The COUNT per filter, so a reader can see there is nothing
              // under a tab before pressing it and finding an empty list.
              const count = practices.filter((p) => matchesFilter(f, p)).length;
              return (
                <button
                  key={f}
                  type="button"
                  className={`${styles.filterChip} ${filter === f ? styles.filterChipOn : ''}`}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  data-testid={`filter-${f}`}
                >
                  {strings.practices.filters[f]}
                  <span className={styles.filterCount}>{count}</span>
                </button>
              );
            })}
          </div>

          <p className={ui.hint}>
            {strings.practices.showing} <strong>{shown.length}</strong> {strings.practices.of}{' '}
            {practices.length}
            {(query || filter !== 'all') && (
              <>
                {' '}
                <Button
                  variant="subtle"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                  data-testid="practice-clear"
                >
                  <X size={13} aria-hidden="true" />
                  {strings.practices.clear}
                </Button>
              </>
            )}
          </p>
        </div>
      )}

      {practices === null && <p className={ui.hint}>{strings.review.loading}</p>}

      {practices !== null && practices.length > 0 && shown.length === 0 && (
        <div className={styles.empty}>
          <Search size={26} aria-hidden="true" />
          <p className={styles.emptyTitle}>{strings.practices.noMatch}</p>
          <p className={ui.hint}>{strings.practices.noMatchHint}</p>
        </div>
      )}

      {practices !== null && practices.length === 0 && (
        <div className={styles.empty}>
          <Building2 size={26} aria-hidden="true" />
          <p className={styles.emptyTitle}>{strings.practices.emptyTitle}</p>
          <p className={ui.hint}>{strings.practices.emptyBody}</p>
        </div>
      )}

      <ul className={styles.list}>
        {shown.map((p) => {
          const pending = p.validationState === 'pending';
          const rejected = p.validationState === 'rejected';
          /*
           * EVERY row goes to the console, and the console decides what to show.
           *
           * A waiting application used to link to the applicant's status page —
           * a bearer-token URL addressed to somebody with no account. Sending a
           * signed-in administrator there is jarring and slightly alarming: it
           * looks like being logged out. The console has its own view of an
           * application under review, and that is where this belongs.
           */
          const href = '/practice/setup';

          const body = (
            <>
              <div className={styles.rowMain}>
                <div className={styles.rowName}>{p.name}</div>
                <div className={styles.rowSub}>
                  {p.legalName && p.legalName !== p.name ? `${p.legalName} · ` : ''}
                  ABN {p.abn ?? '—'}
                </div>
                {/*
                  The readiness sentence, not a count. A count reads as
                  readiness and is not — the same trap the hub itself avoids.
                */}
                {p.headline && <p className={styles.rowHeadline}>{p.headline}</p>}
                {pending && <p className={styles.rowHeadline}>{strings.practices.pendingBody}</p>}
                {rejected && <p className={styles.rowHeadline}>{strings.practices.rejectedBody}</p>}
              </div>

              <div className={styles.rowAside}>
                {rejected ? (
                  <Chip tone="stop">{strings.practices.rejected}</Chip>
                ) : pending ? (
                  <Chip tone="warn">
                    <Clock size={13} aria-hidden="true" />
                    {strings.practices.pending}
                  </Chip>
                ) : p.ready === null ? (
                  <Chip tone="neutral">{strings.practices.unknown}</Chip>
                ) : p.ready ? (
                  <Chip tone="ok">
                    <CheckCircle2 size={13} aria-hidden="true" />
                    {strings.practices.capturing}
                  </Chip>
                ) : (
                  <Chip tone="warn">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {strings.practices.needsWork}
                  </Chip>
                )}
                <span className={styles.rowOpen}>
                  {pending || rejected ? strings.practices.openPending : strings.practices.open}
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </div>
            </>
          );

          return (
            <li key={p.id}>
              <Link
                href={href}
                className={styles.row}
                onClick={() => window.localStorage.setItem(SELECTION_KEY, p.id)}
                data-testid={`practice-${p.id}`}
              >
                {body}
              </Link>
            </li>
          );
        })}
      </ul>

      <Notice tone="warn" title={strings.practices.scopeHeading}>
        {strings.practices.scopeBody}
      </Notice>
    </Shell>
  );
}

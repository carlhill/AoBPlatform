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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock } from 'lucide-react';
import { Chip, Notice, Shell, ui } from '../ui';
import { strings } from '../strings';
import styles from './practice.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';
const SELECTION_KEY = 'aob.practiceId';

interface Practice {
  id: string;
  name: string;
  legalName: string | null;
  abn: string | null;
  abnStatus: string | null;
  validationState: string;
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
  const [practices, setPractices] = useState<WithReadiness[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
                headers: { 'x-practice-id': p.id },
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

  if (error) {
    return (
      <Shell right={strings.setup.audience}>
        <Notice tone="stop" title={strings.practices.notLoaded}>
          {error}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell right={strings.setup.audience}>
      <h1 className={ui.pageTitle}>{strings.practices.title}</h1>
      <p className={ui.pageLead}>{strings.practices.lead}</p>

      {practices === null && <p className={ui.hint}>{strings.review.loading}</p>}

      {practices !== null && practices.length === 0 && (
        <div className={styles.empty}>
          <Building2 size={26} aria-hidden="true" />
          <p className={styles.emptyTitle}>{strings.practices.emptyTitle}</p>
          <p className={ui.hint}>{strings.practices.emptyBody}</p>
        </div>
      )}

      <ul className={styles.list}>
        {(practices ?? []).map((p) => {
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

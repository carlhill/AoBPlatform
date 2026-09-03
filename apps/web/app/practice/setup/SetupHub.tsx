'use client';

/**
 * The practice setup hub.
 *
 * NOT A WIZARD, and that is the load-bearing decision. A wizard implies a
 * finish; a practice adds locations and practitioners for years after it
 * onboards. So: cards, worked in any order, each carrying its own state,
 * revisited indefinitely.
 *
 * IT LEADS WITH WHAT IS NOT YET POSSIBLE. This is the rule everything else
 * serves. Card counts alone let a practice believe capture is live when in fact
 * no practitioner has accepted an affiliation — "3 practitioners, 2 locations"
 * reads as readiness and is not. So the first thing on the page is not a count
 * but a statement of what can and cannot happen right now.
 *
 * And it says what is NOT affected: a practice reading "capture is not
 * available" on a clinical morning must not think their clinic has stopped.
 * Patients can be seen and billed throughout. What is missing is our record of
 * their consent.
 *
 * WORST ROW FIRST inside every card, and worst CARD first on the page. A card
 * that lists rows alphabetically asks the reader to scan for the problem; one
 * that promotes it has already answered.
 *
 * CARDS SUMMARISE; THE PAGE HOLDS THE LIST. Every card caps at a roll-up plus
 * two rows and opens a full table. The card never scrolls — a scrolling card
 * hides exactly the row the promotion rule just surfaced.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Circle,
  Download,
  ClipboardList,
  MapPin,
  Radio,
  Users,
  UserSquare,
  Send,
} from 'lucide-react';
import { type CardState } from '@aobplatform/domain';
import { Chip, Notice, Shell, ui, type Tone } from '../../ui';
import { useRefreshable } from '../../refresh';
import { toViewPath } from '../../viewPath';
import { strings } from '../../strings';
import { apiHeaders } from '../../auth';
import styles from './setup.module.css';
import { SessionControl } from '../../SessionControl';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Row {
  label: string;
  note: string;
  needsWork: boolean;
}

interface Card {
  key: string;
  title: string;
  state: CardState;
  rollup: string;
  rows: Row[];
  more: number;
  href: string | null;
}

interface Hub {
  practice: {
    id: string;
    name: string;
    legalName: string | null;
    abn: string | null;
    abnStatus: string | null;
    validationState: string;
    validatedByName: string | null;
    validatedAt: string | null;
    pms: string;
    credentialCount: number;
  };
  readiness: { ready: boolean; readyCount: number; blockers: string[]; headline: string };
  cards: Card[];
}


/**
 * The hub's cards, left to right, top to bottom.
 *
 * `affiliations` sits beside `practitioners` because the pair is one question —
 * who works here, and where — read together far more often than either alone.
 * `channels` comes last of the grid because it is set up once and then not
 * looked at.
 *
 * ANYTHING NOT NAMED HERE STILL APPEARS, at the end. A new card must not be
 * able to vanish by being forgotten in this list.
 */
/*
 * "Open the your application" was on screen, because the label was built as
 * `"Open the" + title.toLowerCase()` and half the titles already begin with
 * an article. English has one determiner slot; this fills it once.
 */
function openLabel(title: string): string {
  const lowered = title.toLowerCase();
  return /^(the|your) /.test(lowered) ? `Open ${lowered}` : `Open the ${lowered}`;
}

const CARD_ORDER: readonly string[] = ['entity', 'locations', 'practitioners', 'affiliations', 'channels'];

const CARD_ICONS: Record<string, typeof Building2> = {
  entity: Building2,
  locations: MapPin,
  practitioners: UserSquare,
  affiliations: Users,
  channels: Radio,
};

const STATE_TONE: Record<CardState, Tone> = {
  blocked: 'stop',
  attention: 'warn',
  not_started: 'neutral',
  done: 'ok',
};

export function SetupHub({
  practiceId,
  viewOnly = false,
}: {
  practiceId: string;
  /**
   * LOOKING, not working.
   *
   * A platform operator often wants to SEE a practice's setup -- what is
   * missing, who works there, how far along it is -- and the only way in was to
   * act as them: a recorded impersonation that tells the practice and forces a
   * reapproval. That is a heavy price for reading, and a price heavy enough
   * that people avoid looking, which is worse for everybody.
   *
   * So: the same hub, read-only, with the cards leading to read-only pages. It
   * grants nothing new -- an operator has no practice claim, so every mutating
   * endpoint behind these pages already refuses them. What it changes is that
   * the console now SHOWS what the server would do, instead of offering
   * controls that fail.
   */
  viewOnly?: boolean;
}) {
  const [hub, setHub] = useState<Hub | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hoisted so the top-bar refresh can re-run it. The hub is the page most
  // worth re-reading: it is a summary of work other people are doing.
  const load = useCallback(() => {
    let live = true;
    setError(null);
    fetch(`${CORE_URL}/organisations/setup`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Hub) => live && setHub(data))
      .catch((e: Error) =>
        live && setError(e instanceof TypeError ? strings.review.unreachableBody : e.message),
      );
    return () => {
      live = false;
    };
  }, [practiceId]);

  useEffect(() => load(), [load]);
  useRefreshable(load);

  if (error) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <Notice tone="stop" title={strings.setup.notLoaded}>
          {error}
        </Notice>
      </Shell>
    );
  }

  if (!hub) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <p className={ui.hint}>{strings.review.loading}</p>
      </Shell>
    );
  }

  /*
   * NOT YET APPROVED. The hub is what approval opens, so there is nothing to
   * set up — and rendering the cards with everything "not started" would imply
   * work the practice could be getting on with. It cannot.
   *
   * Shown in the CONSOLE rather than by sending the reader to the applicant's
   * token page: a signed-in administrator bounced to a bearer-token URL
   * addressed to somebody with no account looks like being logged out.
   */
  if (hub.practice.validationState !== 'validated') {
    const refused = hub.practice.validationState === 'rejected';
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{hub.practice.name}</h1>
        <p className={ui.pageLead}>
          {refused ? strings.setup.reviewRejectedLead : strings.setup.reviewLead}
        </p>

        <Notice tone={refused ? 'stop' : 'warn'} title={refused ? strings.setup.reviewRejectedTitle : strings.setup.reviewTitle}>
          {refused ? strings.practices.rejectedBody : strings.setup.reviewGateHuman}
        </Notice>

        <dl className={ui.facts}>
          <dt>ABN</dt>
          <dd className={ui.mono}>{hub.practice.abn ?? '—'}</dd>
          {hub.practice.legalName && (
            <>
              <dt>{strings.review.legalName}</dt>
              <dd>{hub.practice.legalName}</dd>
            </>
          )}
          <dt>{strings.setup.reviewReference}</dt>
          <dd className={ui.mono}>{hub.practice.id}</dd>
        </dl>

        {/*
          Straight to the reviewer's dossier for this practice.
          
          The console does NOT carry its own correction surface. Three would be
          two too many: the applicant corrects through the time-boxed link they
          were emailed, and the reviewer works in the dossier. A third copy of
          the same form in the practice console is a third place for the rules
          to drift.

          /review is gated to platform_admin, so a practice administrator
          clicking this is refused by name rather than shown a reviewer's
          checklist — which is the correct answer, and the reason this can be a
          plain link.
        */}
        {!refused && (
          <div style={{ marginTop: 'var(--s5)' }}>
            <Link href={`/review/${hub.practice.id}`} className={ui.buttonLink} data-testid="hub-review">
              <ClipboardList size={15} aria-hidden="true" />
              {strings.setup.openReview}
            </Link>
            <p className={ui.hint} style={{ marginTop: 'var(--s2)' }}>
              {strings.setup.openReviewHint}
            </p>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell
      right={<SessionControl audience={strings.setup.audience} />}
      /*
        THE TITLE AND ITS ONE LINE, handed to the Shell so they are PINNED.
        Rendered inside `<main>` they scrolled away, and on a hub of six cards
        that means losing which practice you are set up in half way down.
      */
      title={`${strings.setup.title} ${hub.practice.name}`}
      lead={
        <>
          {hub.practice.validationState === 'validated' && hub.practice.validatedByName ? (
            <>
              {strings.setup.approvedBy} {hub.practice.validatedByName}
              {hub.practice.validatedAt && <> · {new Date(hub.practice.validatedAt).toLocaleDateString('en-AU')}</>}
              {' · '}
            </>
          ) : null}
          ABN {hub.practice.abn ?? '—'} · {hub.practice.abnStatus ?? '—'}
        </>
      }
    >

      {/*
        THE FIRST THING ON THE PAGE, and never a count. Counts read as readiness
        and are not: a practice with three practitioners and two locations can
        still be unable to capture a single consent.
      */}
      <div
        className={`${styles.readiness} ${hub.readiness.ready ? styles.readinessOk : styles.readinessBlocked}`}
        data-testid="setup-readiness"
      >
        <div className={styles.readinessHead}>
          {hub.readiness.ready ? (
            <CheckCircle2 size={20} aria-hidden="true" />
          ) : (
            <AlertTriangle size={20} aria-hidden="true" />
          )}
          {hub.readiness.headline}
        </div>
        {hub.readiness.blockers.length > 0 && (
          <ol className={styles.blockers}>
            {/* In the order they must be fixed, not the order they were found. */}
            {hub.readiness.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ol>
        )}
      </div>

      {/*
        A FIXED ORDER, chosen by Carl, and it is worth saying why fixed beats
        clever here.
        
        The server returns these in the order it builds them, which is the order
        somebody happened to write the code. That put "Capture channels" first
        and "The entity" second, so the card a practice opens most often moved
        depending on what the server thought about that day. A hub is a place
        people learn the position of things; a layout that reorders itself makes
        them read every card every time.
        
        Entity and locations first because they are what the practice IS; then
        the people; then how it reaches patients. Anything the server sends that
        is not named here still appears, at the end, so a new card cannot vanish
        by being forgotten in this list.
      */}
      <div className={styles.cards}>
        {[...hub.cards]
          .sort((a, b) => {
            const rank = (k: string) => {
              const i = CARD_ORDER.indexOf(k);
              return i === -1 ? CARD_ORDER.length : i;
            };
            return rank(a.key) - rank(b.key);
          })
          .map((card) => {
          const Icon = CARD_ICONS[card.key] ?? Circle;
          return (
            <section className={styles.card} key={card.key} aria-label={card.title} data-testid={`card-${card.key}`}>
              <div className={styles.cardHead}>
                <span className={styles.cardIcon}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                <h2 className={styles.cardTitle}>{card.title}</h2>
                <Chip tone={STATE_TONE[card.state]}>{strings.setup.states[card.state]}</Chip>
              </div>

              <p className={styles.cardRollup}>{card.rollup}</p>

              <ul className={styles.cardRows}>
                {card.rows.length === 0 && <li className={ui.hint}>{strings.setup.nothingYet}</li>}
                {/*
                  KEYED BY POSITION, not by content. Two rows can legitimately
                  read the same — two practitioners with the same status, two
                  locations with the same note — and label+note then collides,
                  which React reports as "two children with the same key" and
                  answers by dropping one of them. A list that silently omits a
                  row is worse than an ugly key.
                */}
                {card.rows.map((row, i) => (
                  <li className={styles.cardRow} key={`${card.key}-${i}`}>
                    <span className={styles.rowLabel}>{row.label}</span>
                    {/* The note carries the state in WORDS — the colour of the
                        dot is reinforcement, never the message. */}
                    <span className={row.needsWork ? styles.rowNoteWork : styles.rowNote}>{row.note}</span>
                  </li>
                ))}
                {card.more > 0 && (
                  <li className={ui.hint}>{strings.setup.andMore.replace('{n}', String(card.more))}</li>
                )}
              </ul>

              {card.href && (
                <Link href={viewOnly ? toViewPath(card.href, practiceId) : card.href} className={styles.cardLink}>
                  {openLabel(card.title)}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              )}
            </section>
          );
        })}

        {/*
          The sixth panel, and DASHED because we do not control it yet. The
          write-back mechanism is an open decision (D-01), so this promises a
          download and nothing more. A solid card here would imply a working
          integration that does not exist.
        */}
        <section className={`${styles.card} ${styles.cardUnsettled}`} aria-label={strings.setup.pmsTitle}>
          <div className={styles.cardHead}>
            <span className={styles.cardIcon}>
              <Download size={16} aria-hidden="true" />
            </span>
            <h2 className={styles.cardTitle}>{strings.setup.pmsTitle}</h2>
            <Chip tone="neutral">{strings.setup.states.not_started}</Chip>
          </div>
          <p className={styles.cardRollup}>{hub.practice.pms}</p>
          <p className={ui.hint}>{strings.setup.pmsBody}</p>
          <p className={ui.hint}>{strings.setup.pmsUnsettled}</p>
          <Link href={viewOnly ? toViewPath('/practice/pms', practiceId) : '/practice/pms'} className={styles.cardLink}>
            {strings.setup.open} {strings.pms.title.toLowerCase()}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>

        {/*
          The queue. Last, because it is the one card nobody opens until
          something has gone wrong — "they say they never got it" is the
          question it answers.
        */}
        <section className={styles.card} aria-label={strings.queue.hubTitle}>
          <div className={styles.cardHead}>
            <span className={styles.cardIcon}>
              <Send size={16} aria-hidden="true" />
            </span>
            <h2 className={styles.cardTitle}>{strings.queue.hubTitle}</h2>
          </div>
          <p className={ui.hint}>{strings.queue.hubBody}</p>
          {/*
            The application, filled in. Different question from the entity
            dossier: that one is for reading, this is "what did we submit,
            and what can I change".
          */}
          <Link href={viewOnly ? toViewPath('/practice/application', practiceId) : '/practice/application'} className={styles.cardLink} data-testid="hub-to-application">
            {openLabel(strings.application.title)}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href={viewOnly ? toViewPath('/practice/reports', practiceId) : '/practice/reports'} className={styles.cardLink} data-testid="hub-to-reports">
            {openLabel(strings.reports.title)}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href={viewOnly ? toViewPath('/practice/users', practiceId) : '/practice/users'} className={styles.cardLink} data-testid="hub-to-users">
            {openLabel(strings.users.title)}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          {/*
            SCOPED TO THIS PRACTICE in view-only. These two used to point at the
            global platform queues, which threw the reader out of the practice
            they were examining and into everything at once -- and the Back
            press from there lost the practice entirely. The twin routes carry
            the id in the path, so the queue and the review list show this
            practice's items and nobody else's.
          */}
          <Link href={viewOnly ? toViewPath('/practice/reviews', practiceId) : '/practice/reviews'} className={styles.cardLink} data-testid="hub-to-reviews">
            {openLabel(strings.reviews.title)}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href={viewOnly ? toViewPath('/practice/queue', practiceId) : '/practice/queue'} className={styles.cardLink} data-testid="hub-to-queue">
            {openLabel(strings.queue.title)}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link
            href={viewOnly ? toViewPath('/practice/reconciliation', practiceId) : '/practice/reconciliation'}
            className={styles.cardLink}
            data-testid="hub-to-reconciliation"
          >
            {openLabel(strings.reconciliation.title)}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </Shell>
  );
}

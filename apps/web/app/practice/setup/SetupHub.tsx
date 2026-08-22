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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
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
import { mayChoosePractice, type CardState } from '@aobplatform/domain';
import { Chip, Notice, Shell, ui, type Tone } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders, currentSession } from '../../auth';
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

export function SetupHub({ practiceId }: { practiceId: string }) {
  /*
   * Whether this person may look at any OTHER practice. A token claim fixes it
   * to one, so the chooser is not merely unnecessary for them — it is a page
   * that redirects them back here.
   */
  const session = currentSession();
  const scoped = session ? !mayChoosePractice({ roles: session.roles, practiceId: session.practiceId }) : false;

  const [hub, setHub] = useState<Hub | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
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
        <Link href="/practice" className={ui.backLink} data-testid="hub-to-list">
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.setup.backToPractices}
        </Link>
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
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      {/*
        A group manager must never be stranded on one practice — but a SCOPED
        user has exactly one and the list would bounce them straight back here.
        Offering a link that returns you to where you started is worse than
        offering none.
      */}
      {!scoped && (
        <Link href="/practice" className={ui.backLink} data-testid="hub-to-list">
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.setup.backToPractices}
        </Link>
      )}
      <h1 className={ui.pageTitle}>
        {strings.setup.title} {hub.practice.name}
      </h1>
      <p className={ui.pageLead}>
        {hub.practice.validationState === 'validated' && hub.practice.validatedByName ? (
          <>
            {strings.setup.approvedBy} {hub.practice.validatedByName}
            {hub.practice.validatedAt && <> · {new Date(hub.practice.validatedAt).toLocaleDateString('en-AU')}</>}
            {' · '}
          </>
        ) : null}
        ABN {hub.practice.abn ?? '—'} · {hub.practice.abnStatus ?? '—'}
      </p>

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

      <div className={styles.cards}>
        {hub.cards.map((card) => {
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
                {card.rows.map((row) => (
                  <li className={styles.cardRow} key={row.label + row.note}>
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
                <Link href={card.href} className={styles.cardLink}>
                  {/*
                    The article is stripped, not the title edited: "The entity"
                    is right as a heading and wrong after "Open the".
                  */}
                  {strings.setup.open} {card.title.toLowerCase().replace(/^the /, '')}
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
          <Link href="/practice/pms" className={styles.cardLink}>
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
          <Link href="/practice/application" className={styles.cardLink} data-testid="hub-to-application">
            {strings.setup.open} {strings.application.title.toLowerCase()}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href="/practice/reviews" className={styles.cardLink} data-testid="hub-to-reviews">
            {strings.setup.open} {strings.reviews.title.toLowerCase()}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link href="/practice/queue" className={styles.cardLink} data-testid="hub-to-queue">
            {strings.setup.open} {strings.queue.title.toLowerCase()}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </Shell>
  );
}

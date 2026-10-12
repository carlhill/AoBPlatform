'use client';

/**
 * `/practice/today` — THE DAY'S WORK, AND WHERE PRACTICE STAFF LAND (Carl,
 * 12 September 2026; PRACTICE-NAVIGATION.md §2).
 *
 * WHY IT EXISTS. The setup hub had grown to twelve destinations in 752 lines
 * because it was where everything already was, so a receptionist starting a
 * shift and an administrator changing the letterhead landed on one screen and
 * each read past the other's work. The fault was that the hub is organised by
 * WHAT A THING IS, and nobody arrives at a practice console thinking "I need a
 * configuration page" (§1). This page is organised by why somebody came: five
 * destinations, all of them today's, and a person who never opens anything
 * else can do their whole job from here.
 *
 * FIVE, AND NOTHING ELSE. The temptation the hub lost to was that every new
 * page is "only one more card". A sixth thing here must first be shown to be
 * touched during a shift (§5 rule 1); if it is not, it belongs on
 * `/practice/setup`, and if it is genuinely both it goes here and is linked
 * from there.
 *
 * IT HAS NO READ OF ITS OWN, deliberately. Nothing on it can fail to load,
 * time out, or be stale, because there is nothing behind it: it is a set of
 * links whose destinations each answer for themselves. That is also why the
 * platform never blocks care through this page (hard rule 8) — there is
 * nothing here to be down.
 *
 * `canOpen` IS THE SAME `mayReach` EACH DESTINATION APPLIES, asked here rather
 * than judged again, so a card and the page it opens cannot drift apart — the
 * failure the setup hub has already had twice with the queue and reviews
 * cards.
 *
 * VIEW-ONLY AND ACTING-AS BOTH KEEP WORKING (§5 rule 4), and they are two
 * different mechanisms. Acting as a practice grants a practice claim, so an
 * operator holding one reaches these routes as the practice does and the links
 * are the ordinary ones. A read-only operator has no claim, so every link is
 * rewritten by `toViewPath` to its `/platform/practices/<id>` twin — exactly
 * as the setup hub does it, and through the same single mapping so a twin
 * added later needs no second edit here.
 */

import Link from 'next/link';
import { ArrowRight, ConciergeBell, CalendarClock, Mail, Send, UserRound } from 'lucide-react';
import { audiencesOf, mayReach, profileAllows, type Audience } from '@aobplatform/domain';
import { Notice, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { strings } from '../../strings';
import { toViewPath } from '../../viewPath';
import { currentSession } from '../../auth';
import { useSurfaceProfile } from '../../surfaceProfile';
import styles from './today.module.css';

interface Destination {
  key: string;
  path: string;
  icon: typeof ConciergeBell;
  title: string;
  body: string;
  link: string;
}

/**
 * THE FIVE, IN THE ORDER OF THE MORNING (§2), and the order is not accidental:
 * the desk, then who they are waiting for, then the two ways of working a
 * patient, then what has been sent. A list in a different order every time is
 * a list somebody has to read from the top.
 */
const DESTINATIONS: readonly Destination[] = [
  {
    key: 'frontdesk',
    path: '/practice/frontdesk',
    icon: ConciergeBell,
    title: strings.today.frontdeskTitle,
    body: strings.today.frontdeskBody,
    link: strings.today.frontdeskLink,
  },
  {
    /*
     * RECEPTION'S VIEW OF THE PRACTITIONER QUEUE, which is the page Carl was
     * asking for when he stopped a thirteenth card going on the hub (§4). One
     * page, one set of data: a practitioner sees their own list and practice
     * staff see every practitioner's, grouped, and the SERVER decides which
     * from the token rather than this link.
     */
    key: 'waiting',
    path: '/practice/practitioner/waiting',
    icon: CalendarClock,
    title: strings.today.waitingTitle,
    body: strings.today.waitingBody,
    link: strings.today.waitingLink,
  },
  {
    key: 'tablet',
    path: '/practice/tablet',
    icon: Send,
    title: strings.today.tabletTitle,
    body: strings.today.tabletBody,
    link: strings.today.tabletLink,
  },
  {
    key: 'patients',
    path: '/practice/patients',
    icon: UserRound,
    title: strings.today.patientsTitle,
    body: strings.today.patientsBody,
    link: strings.today.patientsLink,
  },
  {
    key: 'messages',
    path: '/practice/correspondence',
    icon: Mail,
    title: strings.today.messagesTitle,
    body: strings.today.messagesBody,
    link: strings.today.messagesLink,
  },
];

export function TodayView({
  practiceId,
  viewOnly = false,
}: {
  practiceId: string;
  /** Looking, not working — the same read-only mode the setup hub has. */
  viewOnly?: boolean;
}) {
  const session = currentSession();
  const audiences: Audience[] = audiencesOf({
    roles: session?.roles ?? [],
    practiceId,
    practitionerId: session?.practitionerId,
    consoleRole: session?.consoleRole,
  });
  /*
   * AND WHAT THIS PRACTICE USES (D-2026-09-14-04). The same reasoning as
   * `mayReach` above it: asked here rather than judged again, so a card and
   * the page it opens cannot drift apart. A practice on the DB4 path loses the
   * front desk card and keeps the tablet desk, the patients and the day.
   *
   * VIEW-ONLY IS EXEMPT FROM NEITHER CHECK AND BOTH. A read-only operator
   * already bypasses `mayReach` here because the twin routes are theirs, and
   * the same holds for this: they are looking at a practice's console, not
   * working in it, and hiding half of it would misrepresent what the practice
   * has.
   */
  const { profile } = useSurfaceProfile(practiceId);
  const canOpen = (path: string) =>
    viewOnly || (mayReach(path, audiences) && profileAllows(profile, path));

  const open = DESTINATIONS.filter((destination) => canOpen(destination.path));

  return (
    <Shell
      right={<SessionControl audience={strings.today.audience} />}
      title={strings.today.title}
      lead={strings.today.lead}
    >
      {open.length === 0 ? (
        <Notice tone="warn" title={strings.today.nothingOpen} data-testid="today-nothing-open">
          {strings.today.nothingOpenWhy}
        </Notice>
      ) : (
        <div className={styles.cards}>
          {open.map((destination) => {
            const Icon = destination.icon;
            const href = viewOnly ? toViewPath(destination.path, practiceId) : destination.path;
            return (
              <section
                className={styles.card}
                key={destination.key}
                aria-label={destination.title}
                data-testid={`today-card-${destination.key}`}
              >
                <h2 className={styles.cardTitle}>
                  <Icon size={18} aria-hidden="true" />
                  {destination.title}
                </h2>
                <p className={styles.cardBody}>{destination.body}</p>
                <Link href={href} className={ui.buttonLink} data-testid={`today-to-${destination.key}`}>
                  {destination.link}
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </section>
            );
          })}
        </div>
      )}

      {/*
        WHICH DESK IS WHICH (§7). Two desks side by side is the one thing on
        this page a person can get wrong, and the answer is a sentence rather
        than a label on either card — it is a comparison, and a comparison
        written on one of the two things being compared is only half said.
        Shown only when both are actually on the page.
      */}
      {canOpen('/practice/frontdesk') && canOpen('/practice/tablet') && (
        <p className={ui.hint} data-testid="today-two-desks">
          {strings.today.twoDesks}
        </p>
      )}
    </Shell>
  );
}

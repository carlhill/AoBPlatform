'use client';

/**
 * Where "up" is, on every page that has an up.
 *
 * DERIVED FROM THE PATH, IN ONE PLACE. A `back` prop on `Shell` would mean
 * forty call sites, thirty-nine of which get it and one of which is the page
 * somebody is stuck on. The parent of a page is a fact about the page, so it is
 * written down once here rather than passed in from wherever the page happens
 * to be rendered.
 *
 * NAMED, NOT `history.back()`. Browser history is where you CAME FROM, which is
 * frequently somewhere useless — a page you were redirected off, the sign-in you
 * arrived through, an external link. A back control that sometimes drops you
 * into a redirect loop teaches people not to press it. This always goes to the
 * page above, whether or not you came from there.
 *
 * NOTHING IS SHOWN when a page has no parent. A back link on a top-level page is
 * a lie about the shape of the product.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { audiencesOf, mayReach, type Audience } from '@aobplatform/domain';
import { currentSession } from './auth';
import { useEffectivePractice } from './effectivePractice';
import { strings } from './strings';
import styles from './ui/ui.module.css';

/**
 * Exact paths first, then the prefix rules for pages with an id in them.
 *
 * Note that the three platform screens living under `/practice/` do NOT go up
 * to the practice hub — they are not practice pages, despite their paths, and
 * sending an operator "up" into a practice console would be wrong in the same
 * way the access table says it is.
 */
const PARENTS: Readonly<Record<string, string>> = {
  '/practice/setup': '/practice',
  '/practice/entity': '/practice/setup',
  '/practice/application': '/practice/setup',
  '/practice/locations': '/practice/setup',
  '/practice/channels': '/practice/setup',
  '/practice/pms': '/practice/setup',
  '/practice/practitioners': '/practice/setup',
  '/practice/affiliations': '/practice/setup',
  '/practice/users': '/practice/setup',
  '/practice/devices': '/practice/setup',
  // "Send to the tablet" sits beside the tablets themselves: a receptionist
  // who has just paired one is one press from using it, and the one who
  // wonders why a push refused goes the other way.
  '/practice/tablet': '/practice/setup',
  // The agreement document -- letterhead, logo, wording (W1; Carl, 7 Sep 2026: 'need a backlink').
  '/practice/templates': '/practice/setup',
  // '/practice/reports' is decided per audience in parentOf -- it belongs under
  // the practice hub for a practice user and under the organisation list for an
  // operator, because those are the places each of them came from.

  '/practice/queuebyOrg': '/practice/queue',
  '/practice/queuebyOrgLocDepartment': '/practice/queue',
  '/review/identity': '/review',
  '/platform/acting-as/history': '/platform/acting-as',

  /*
   * THE PLATFORM'S TOP-LEVEL PAGES GO UP TO THE ORGANISATION LIST.
   *
   * They looked like roots, so they had no back link and an operator opening
   * one had no way out but the menu. They are not roots: an operator's work
   * starts from a PRACTICE -- which one is stuck, whose practitioners need
   * checking, who to act as -- and the list is the only page that leads to
   * both doors into every practice. These are the queues you visit FROM there.
   */
  '/review': '/practice',
  '/practice/reviews': '/practice',
  '/practice/queue': '/practice',
  '/practice/reconciliation': '/practice',
  '/practice/correspondence': '/practice',
  '/platform/acting-as': '/practice',
  '/practice/reports': '/practice',

  '/practitioner/affiliations': '/practitioner',
  '/practitioner/messages': '/practitioner',
};

/** Pages with an id in the path. Longest match wins, so order matters. */
const PREFIX_PARENTS: ReadonlyArray<readonly [string, string]> = [
  ['/practitioner/practices/', '/practitioner'],
  ['/review/', '/review'],
];

/**
 * A practice viewed AS THE PLATFORM, where "up" depends how deep you are.
 *
 * `/platform/practices/<id>/practitioners` goes up to that practice's own hub,
 * not out to the organisation list. Going straight out skipped the level the
 * reader is actually working in: they came to look at ONE practice, and the
 * first press of Back threw away the practice as well as the page.
 *
 * From the hub itself, up is the organisation list -- which is where they
 * chose the practice in the first place.
 */
function platformPracticeParent(pathname: string): string | null {
  const match = /^\/platform\/practices\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const [, practiceId, rest] = match;
  return rest && rest !== '/' ? `/platform/practices/${practiceId}` : '/practice';
}

function parentOf(pathname: string, hasPractice: boolean): string | null {
  /*
   * ONE PAGE, TWO PARENTS. Reports belong under a practice's hub for a practice
   * user and under the organisation list for an operator, because those are the
   * places each of them came from. A single answer would send one of them
   * somewhere they have never been.
   */
  if (pathname === '/practice/reports') return hasPractice ? '/practice/setup' : '/practice';
  const platformPractice = platformPracticeParent(pathname);
  if (platformPractice) return platformPractice;
  if (PARENTS[pathname]) return PARENTS[pathname];
  for (const [prefix, parent] of PREFIX_PARENTS) {
    if (pathname.startsWith(prefix) && pathname !== parent) return parent;
  }
  return null;
}

export function BackLink() {
  const pathname = usePathname() ?? '/';
  const session = currentSession();
  const { practiceId } = useEffectivePractice();

  const audiences: Audience[] = audiencesOf({
    roles: session?.roles ?? [],
    practiceId,
    practitionerId: session?.practitionerId,
    consoleRole: session?.consoleRole,
  });

  const parent = parentOf(pathname, audiences.includes('practice'));
  if (!parent) return null;

  /*
   * NOT OFFERED IF IT WOULD REFUSE YOU. The same rule the menu follows: a
   * control that navigates somewhere you will be turned away from spends
   * somebody's attention and then takes it back.
   */
  if (!mayReach(parent, audiences)) return null;

  const isPlatform = audiences.includes('platform');
  const hasPractice = audiences.includes('practice');

  /*
   * A PRACTICE'S OWN HUB is named for what it is rather than for the platform
   * tree it sits in. "Their setup" is what the reader came to look at.
   */
  /*
   * NAMED FOR THE DESTINATION, not for its path. A table rather than a ladder
   * of ternaries: the ladder had grown to six rungs and the next person adding
   * a parent would have had to find the right rung to put it on.
   */
  const LABELS: Record<string, string> = {
    '/practice/setup': strings.nav.setup,
    '/practice/queue': strings.nav.outbound,
    '/review': strings.nav.reviewDossiers,
    '/platform/acting-as': strings.nav.actingAsRegister,
    '/practitioner': strings.nav.practitionerHub,
  };

  const label = parent.startsWith('/platform/practices/')
    ? // A practice's own hub, named for what the reader came to look at rather
      // than for the platform tree it sits in.
      strings.viewOnly.toHub
    : parent === '/practice'
      ? isPlatform && !hasPractice
        ? strings.nav.allOrganisations
        : strings.nav.yourPractices
      : (LABELS[parent] ?? strings.nav.practitionerHub);

  return (
    <Link href={parent} className={styles.backLink} data-testid="shell-back">
      <ArrowLeft size={14} aria-hidden="true" />
      {strings.nav.backTo.replace('{page}', label)}
    </Link>
  );
}

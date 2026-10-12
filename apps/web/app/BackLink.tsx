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
  /*
   * THE TWO PRACTICE HOMES GO UP TO THE LIST OF PRACTICES, and neither goes up
   * to the other. `today` is the day's work and `setup` is configuration and
   * oversight (PRACTICE-NAVIGATION.md §2); they are siblings, and a back link
   * from one to the other would say that one contains the other — which is the
   * arrangement the split exists to end. The link BETWEEN them is on the setup
   * hub itself, in the body, pointing at the day's work.
   */
  '/practice/today': '/practice',
  '/practice/correspondence': '/practice',
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
  // The practice's AOBPRINTER host, opened from its card on the setup hub (PRINTER-HEARTBEAT.md §4).
  '/practice/aobprinter-host': '/practice/setup',
  /*
   * THE SHIFT'S PAGES GO UP TO THE SHIFT'S HOME (Carl, 12 Sep 2026;
   * PRACTICE-NAVIGATION.md §2). All three used to go up to `/practice/setup`,
   * because that is where the cards that opened them lived. The cards moved to
   * `/practice/today`, and 'up' has to move with them: a back press that lands
   * a receptionist in the administrator's configuration hub is the same
   * mis-sorting the split was made to fix, arriving by a different door.
   */
  '/practice/tablet': '/practice/setup',
  '/practice/frontdesk': '/practice/today',
  /*
   * THE SMALL-SCREEN DESK GOES UP TO THE HUB THE CARD THAT OPENS IT LIVES ON
   * (Carl, 12 Sep 2026: *"add it to the same card on /setup under
   * frontdesk"*), which is the same rule `/practice/tablet` follows and for
   * the same reason: 'up' has to be somewhere the page can be reached from
   * again.
   *
   * NOT `/practice/today`, EVEN THOUGH THE WIDE DESK GOES THERE. That page is
   * five destinations and a named test — `is five things and no more` — holds
   * it at five, because the setup hub reached twelve one reasonable card at a
   * time. Adding a sixth is a change to PRACTICE-NAVIGATION.md §2 and Carl's
   * to make, so until he does, Back lands where the link is.
   *
   * NOT `/practice/frontdesk` EITHER. Somebody who opened the small-screen
   * desk chose it; a back press that put them on the wide one would hand them
   * the layout they deliberately did not want.
   */
  '/practice/frontdesksmall': '/practice/setup',
  /*
   * THE DAY REGISTER GOES UP TO THE DESK IT IS OPENED FROM (Carl, 12 Sep
   * 2026), not to `/practice/today`. The button that leads here is below the
   * three rails on the front desk page, and 'up' has to be where somebody came
   * from — a back press that skipped the desk would put a receptionist two
   * screens away from the patient they were working on.
   */
  '/practice/day': '/practice/frontdesk',
  /*
   * RECEPTION'S QUEUE SITS BESIDE THE TABLETS IT FEEDS (Carl, 7 Sep 2026 —
   * it had no back link at all, so the only way off it was the menu). It is
   * the same working area: the patients with something open, and the devices
   * their agreements go to.
   *
   * The platform twin at `/platform/practices/<id>/patients` needs no entry:
   * `platformPracticeParent` already sends every page under a practice up to
   * that practice's own hub.
   */
  '/practice/patients': '/practice/setup',
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
  // '/practice/correspondence' is decided per audience in parentOf -- it is
  // one of the day's five destinations for a practice user and a
  // cross-practice screen for an operator.

  '/platform/acting-as': '/practice',
  // Every practice's AOBPRINTER host, worst first (PRINTER-HEARTBEAT.md §4). Each row's twin goes up to its
  // practice's hub through platformPracticeParent, like every twin.
  '/platform/aobprinter-hosts': '/practice',
  '/practice/reports': '/practice',

  /*
   * `/practice/practitioner` HAS NO PARENT, deliberately: it is where a
   * practitioner lands, and a back link on a landing page is a lie about the
   * shape of the product.
   *
   * `/practice/practitioner/waiting` is NOT in this table. It has two
   * audiences and therefore two parents, so it is decided per audience in
   * `parentOf` beside reports and correspondence.
   */

  '/practitioner/affiliations': '/practitioner',
  '/practitioner/messages': '/practitioner',
  /*
   * `/practitioner` HAS NO PARENT (Carl, 12 Sep 2026, reversing his own earlier
   * request once he saw it): "there should be no link 'Back to Your page at
   * this practice' when the practitioner lands on this first page".
   *
   * IT IS A LANDING PAGE IN ITS OWN RIGHT. A practitioner signing in with their
   * person-level passkey arrives HERE, and a back link on the page you landed
   * on points at somewhere you have not been. The link the other way — from the
   * practice page to this one — is a button in the body, which is the honest
   * direction: the practice page is the narrower view and this is the wider one.
   */
};

/** Pages with an id in the path. Longest match wins, so order matters. */
const PREFIX_PARENTS: ReadonlyArray<readonly [string, string]> = [
  ['/practitioner/practices/', '/practitioner'],
  ['/review/', '/review'],
  /*
   * ONE PATIENT'S WORK PAGE GOES UP TO THE QUEUE IT WAS OPENED FROM. The page
   * carries its own "← All patients with something open today" link in the
   * body; this is the shell's, so the control is in the same place it is on
   * every other page rather than only where somebody remembered to put one.
   */
  ['/practice/patients/', '/practice/patients'],
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
  /*
   * AND CORRESPONDENCE, FOR THE SAME REASON AND A DIFFERENT HOME. For a
   * practice user it is Messages, one of the five things on `today`
   * (PRACTICE-NAVIGATION.md §2); for an operator it is one practice's log
   * reached from the organisation list. A single answer would send one of them
   * somewhere they have never been.
   */
  if (pathname === '/practice/correspondence') return hasPractice ? '/practice/today' : '/practice';
  /*
   * AND THE WAITING LIST, WHICH HAS TWO AUDIENCES AND SO TWO WAYS BACK (Carl,
   * 12 Sep 2026, looking at the page as reception: *"needs a link back to
   * today"*, and then *"no back to today link in header"*).
   *
   * It is the same reasoning as reports and correspondence, arriving from
   * PRACTITIONER-QUEUE-PAGE.md §5a rather than from the navigation split. For
   * reception, a manager or an administrator this page is one of the day's
   * jobs and "up" is the day's work. For a PRACTITIONER it cannot be:
   * `/practice/today` is a `practice` page and their token carries no practice
   * claim, so up is their own landing page instead.
   *
   * A single answer would give one of the two a door that does not open —
   * which is what it did, in both directions at once: the table sent everybody
   * to `/practice/practitioner`, `mayReach` correctly refused it to reception,
   * and reception was left with no back link at all.
   *
   * BELT AND BRACES: whichever way this decides, `mayReach` below still checks
   * the destination against the reader's own audiences, so a wrong answer here
   * shows nothing rather than a dead end.
   */
  if (pathname === '/practice/practitioner/waiting') {
    return hasPractice ? '/practice/today' : '/practice/practitioner';
  }
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
    '/practice/today': strings.today.title,
    '/practice/setup': strings.nav.setup,
    '/practice/patients': strings.patients.navLabel,
    '/practice/queue': strings.nav.outbound,
    '/review': strings.nav.reviewDossiers,
    '/platform/acting-as': strings.nav.actingAsRegister,
    '/practitioner': strings.nav.practitionerHub,
    '/practice/practitioner': strings.practitionerQueue.landing.title,
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

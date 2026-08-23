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
  '/practice/reports': '/practice/setup',

  '/practice/queuebyOrg': '/practice/queue',
  '/practice/queuebyOrgLocDepartment': '/practice/queue',
  '/review/identity': '/review',

  '/practitioner/affiliations': '/practitioner',
  '/practitioner/messages': '/practitioner',
};

/** Pages with an id in the path. Longest match wins, so order matters. */
const PREFIX_PARENTS: ReadonlyArray<readonly [string, string]> = [
  ['/practitioner/practices/', '/practitioner'],
  ['/review/', '/review'],
];

function parentOf(pathname: string): string | null {
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

  const parent = parentOf(pathname);
  if (!parent) return null;

  const audiences: Audience[] = audiencesOf({
    roles: session?.roles ?? [],
    practiceId,
    practitionerId: session?.practitionerId,
    consoleRole: session?.consoleRole,
  });

  /*
   * NOT OFFERED IF IT WOULD REFUSE YOU. The same rule the menu follows: a
   * control that navigates somewhere you will be turned away from spends
   * somebody's attention and then takes it back.
   */
  if (!mayReach(parent, audiences)) return null;

  const isPlatform = audiences.includes('platform');
  const hasPractice = audiences.includes('practice');

  const label =
    parent === '/practice'
      ? isPlatform && !hasPractice
        ? strings.nav.allOrganisations
        : strings.nav.yourPractices
      : parent === '/practice/setup'
        ? strings.nav.setup
        : parent === '/practice/queue'
          ? strings.nav.outbound
          : parent === '/review'
            ? strings.nav.reviewDossiers
            : strings.nav.practitionerHub;

  return (
    <Link href={parent} className={styles.backLink} data-testid="shell-back">
      <ArrowLeft size={14} aria-hidden="true" />
      {strings.nav.backTo.replace('{page}', label)}
    </Link>
  );
}

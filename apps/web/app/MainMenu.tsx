'use client';

/**
 * The menu, on every page.
 *
 * BUILT FROM THE ACCESS TABLE, NOT FROM A LIST TYPED HERE. `pagesFor` returns
 * exactly what this audience may open, so the menu cannot offer a door that the
 * guard then shuts — which is the failure mode of every hand-written nav: it
 * drifts the moment somebody adds a page or changes who may reach one, and the
 * drift shows up as a person clicking a link and being told no.
 *
 * A path with no label here simply does not appear. That is the safe direction:
 * a page missing from the menu is reachable by its URL and merely undiscovered,
 * whereas a page listed but forbidden is a promise broken in front of somebody.
 *
 * THE TOKEN-BEARING PAGES ARE ABSENT ON PURPOSE. `/verify/:token`,
 * `/invitation/:token`, `/status/:token` and the two email-change pages are
 * reachable without a session because the token IS the authorisation. Listing
 * them in a menu would offer a door that only opens for somebody holding a
 * link, and they are answered from an email in any case.
 *
 * A DIALOG RATHER THAN A HAND-ROLLED DROPDOWN. Radix supplies focus trapping,
 * Escape, and the aria wiring; WCAG 2.2 AA is a requirement here and a
 * hand-rolled panel is where that quietly fails (CLAUDE.md §4).
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import { audiencesOf, mayReach, type Audience } from '@aobplatform/domain';
import { currentSession } from './auth';
import { strings } from './strings';
import styles from './ui/ui.module.css';

type Item = { path: string; label: string };
type Group = { heading: string; items: Item[] };

export function MainMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /*
   * READ AT RENDER, not held in state. A session begins and ends without this
   * component being told, and a menu built once at mount would go on offering
   * a signed-out person the pages they had a minute ago.
   */
  const session = currentSession();
  const audiences: Audience[] = audiencesOf({
    roles: session?.roles ?? [],
    practiceId: session?.practiceId,
    practitionerId: session?.practitionerId,
    consoleRole: session?.consoleRole,
  });

  const isPlatform = audiences.includes('platform');
  const hasPractice = audiences.includes('practice');

  /*
   * ONE PATH, TWO HONEST NAMES. `/practice` lists every organisation for an
   * operator and the ones you hold for a practice user — the same page doing
   * genuinely different jobs, so calling it one thing would be wrong for one of
   * them. An operator looking for "all organisations" should not have to guess
   * that it is filed under "your practices".
   */
  const practiceListLabel = isPlatform && !hasPractice ? strings.nav.allOrganisations : strings.nav.yourPractices;

  const groups: Group[] = [
    {
      heading: strings.nav.platformHeading,
      items: [
        { path: '/practice', label: practiceListLabel },
        { path: '/review', label: strings.nav.reviewDossiers },
        { path: '/practice/reviews', label: strings.nav.reviewQueue },
        { path: '/practice/queue', label: strings.nav.outbound },
        { path: '/practice/queuebyOrg', label: strings.nav.outboundByOrg },
        { path: '/practice/queuebyOrgLocDepartment', label: strings.nav.outboundByPlace },
      ],
    },
    {
      heading: strings.nav.practiceHeading,
      items: [
        // Repeated deliberately when somebody holds both: a practice user's
        // list of their own practices belongs beside their practice pages, not
        // under a heading about the platform.
        ...(hasPractice ? [{ path: '/practice', label: practiceListLabel }] : []),
        { path: '/practice/setup', label: strings.nav.setup },
        { path: '/practice/entity', label: strings.nav.entity },
        { path: '/practice/application', label: strings.nav.application },
        { path: '/practice/locations', label: strings.nav.locations },
        { path: '/practice/practitioners', label: strings.nav.practitioners },
        { path: '/practice/affiliations', label: strings.nav.affiliations },
        { path: '/practice/channels', label: strings.nav.channels },
        { path: '/practice/pms', label: strings.nav.pms },
        { path: '/practice/users', label: strings.nav.users },
      ],
    },
    {
      heading: strings.nav.reportsHeading,
      items: [{ path: '/practice/reports', label: strings.nav.reports }],
    },
    {
      heading: strings.nav.yoursHeading,
      items: [
        { path: '/practitioner', label: strings.nav.practitionerHub },
        { path: '/practitioner/affiliations', label: strings.nav.myAffiliations },
        { path: '/practitioner/messages', label: strings.nav.myMessages },
      ],
    },
    {
      heading: strings.nav.everyoneHeading,
      items: [
        { path: '/', label: strings.nav.home },
        { path: '/apply', label: strings.nav.apply },
        { path: '/help', label: strings.nav.help },
      ],
    },
  ];

  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => mayReach(i.path, audiences)) }))
    // A heading with nothing under it says a section exists and is empty, which
    // is a different and untrue statement from "you have no such section".
    .filter((g) => g.items.length > 0);

  /*
   * `/practice` under BOTH headings when somebody holds both roles would list
   * one page twice. Dropped from the platform group in that case, because the
   * practice group is where a practice user looks for it.
   */
  if (hasPractice && visible[0]?.heading === strings.nav.platformHeading) {
    visible[0] = { ...visible[0], items: visible[0].items.filter((i) => i.path !== '/practice') };
    if (visible[0].items.length === 0) visible.shift();
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>
        <button type="button" className={styles.menuButton} aria-label={strings.nav.open} data-testid="main-menu">
          <Menu size={18} aria-hidden="true" />
        </button>
      </RadixDialog.Trigger>

      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.menuPanel} data-testid="main-menu-panel">
          <div className={styles.menuHead}>
            <RadixDialog.Title className={styles.dialogTitle}>{strings.nav.title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button type="button" className={styles.menuButton} aria-label={strings.nav.close}>
                <X size={18} aria-hidden="true" />
              </button>
            </RadixDialog.Close>
          </div>

          <RadixDialog.Description className={styles.menuHint}>
            {session ? strings.nav.hint : strings.nav.hintSignedOut}
          </RadixDialog.Description>

          {visible.map((group) => (
            <div key={group.heading} className={styles.menuGroup}>
              <p className={styles.menuHeading}>{group.heading}</p>
              {group.items.map((item) => (
                <Link
                  key={`${group.heading}:${item.path}`}
                  href={item.path}
                  className={pathname === item.path ? styles.menuLinkActive : styles.menuLink}
                  // Closed on the way out, so the panel is not still covering
                  // the page it just navigated to.
                  onClick={() => setOpen(false)}
                  data-testid={`menu-${item.path}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
          {/*
            WHAT IS DELIBERATELY ABSENT, said out loud.

            A platform operator opening this sees the platform pages and no
            practice pages, which looks exactly like a menu that forgot them.
            It is a rule — practice pages need a practice claim, which acting as
            a practice is what grants — and a rule nobody states reads as a
            fault. So it is stated, next to the gap it explains.
          */}
          {(isPlatform || !session) && (
            <div className={styles.menuGroup}>
              <p className={styles.menuHeading}>{strings.nav.absentTitle}</p>
              {!session && <p className={styles.menuHint}>{strings.nav.absentSignedOut}</p>}
              {isPlatform && !hasPractice && <p className={styles.menuHint}>{strings.nav.absentPractice}</p>}
              {isPlatform && <p className={styles.menuHint}>{strings.nav.absentPractitioner}</p>}
            </div>
          )}

        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

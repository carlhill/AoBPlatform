'use client';

/**
 * "You are signed in, and we cannot tell what you should see."
 *
 * WHY THIS PAGE EXISTS. Somebody in this state used to land on the developer
 * scaffold — a page headed "Scaffold status view" offering practice onboarding
 * and a console for organisations that are not theirs. Alarming in production,
 * useless everywhere, and silent about the one thing they need to know.
 *
 * IT IS A REAL STATE, not an error. An account created before it was scoped, a
 * claim that failed to map, an affiliation that ended while they were signed
 * in. None of those is the person's fault and none of them is fixable by the
 * person, so the page's whole job is to say who they are, say plainly that we
 * cannot place them, and give them somebody to ask.
 *
 * IT NEVER INVENTS CONTACT DETAILS. If SUPPORT_EMAIL and SUPPORT_PHONE are not
 * configured it says so rather than showing a plausible-looking address that
 * goes nowhere — a wrong address is worse than none, because somebody writes
 * to it and waits.
 */

import { LifeBuoy, Mail, Phone } from 'lucide-react';
import { Notice, Shell, ui } from '../ui';
import { SessionControl } from '../SessionControl';
import { currentSession } from '../auth';
import { strings } from '../strings';

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '';
const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '';

export function HelpView() {
  const session = currentSession();
  const haveContact = Boolean(SUPPORT_EMAIL || SUPPORT_PHONE);

  return (
    <Shell right={<SessionControl audience={strings.help.audience} />}>
      <h1 className={ui.pageTitle}>
        <LifeBuoy size={20} aria-hidden="true" /> {strings.help.title}
      </h1>
      <p className={ui.pageLead}>{strings.help.lead}</p>

      {/*
        WHO WE THINK THEY ARE, shown back to them. It is the single most useful
        thing on the page: half the time somebody in this state is signed in as
        an account they did not mean to use, and seeing the address is enough
        to work that out without asking anybody.
      */}
      {session && (
        <Notice title={strings.help.whoTitle}>
          {strings.help.whoBody.replace('{who}', session.username ?? strings.help.unknownAccount)}
        </Notice>
      )}

      <h2 className={ui.sectionTitle}>{strings.help.contactTitle}</h2>

      {haveContact ? (
        <ul className={ui.list}>
          {SUPPORT_EMAIL && (
            <li>
              <Mail size={14} aria-hidden="true" />{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </li>
          )}
          {SUPPORT_PHONE && (
            <li>
              <Phone size={14} aria-hidden="true" /> <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE}</a>
            </li>
          )}
        </ul>
      ) : (
        /*
         * Not configured. Said plainly rather than papered over with a
         * plausible-looking address — somebody would write to it and wait.
         */
        <Notice tone="warn" title={strings.help.noContactTitle}>
          {strings.help.noContactBody}
        </Notice>
      )}

      <h2 className={ui.sectionTitle}>{strings.help.tryTitle}</h2>
      <ul className={ui.list}>
        <li>{strings.help.trySignOut}</li>
        <li>{strings.help.tryInvite}</li>
        <li>{strings.help.tryAsk}</li>
      </ul>

      <p className={ui.hint}>{strings.help.notYourFault}</p>
    </Shell>
  );
}

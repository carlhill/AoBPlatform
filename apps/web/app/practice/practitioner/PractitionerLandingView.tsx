'use client';

/**
 * `/practice/practitioner` — WHERE A PRACTITIONER LANDS WHEN THEY SIGN IN AT A
 * PRACTICE (PRACTITIONER-QUEUE-PAGE.md §1; Carl, 12 September 2026).
 *
 * DELIBERATELY SMALL. Who they are, which practice, and the way to their
 * waiting list. §1: it exists so *"the practitioner does not land on the
 * practice/setup"* — the setup hub is the administrator's page, and sending a
 * provider there is how a person learns to ignore their own home screen. A
 * second hub with twelve cards on it would be the same mistake in a new place.
 *
 * NOT A DUPLICATE OF `/practitioner`, and it links to it rather than
 * duplicating it. `/practitioner` is about ME, ACROSS PRACTICES — my details,
 * my affiliations, what has been sent to me — and it follows the person
 * wherever they work. This is MY WORK AT THIS PRACTICE, TODAY, and it
 * disappears when the affiliation does.
 *
 * `/practitioner/me` IS THE ONLY READ, and it is the right one: the id comes
 * off the token, so there is no parameter to tamper with and no ownership
 * check to forget, and the affiliations it returns are the practitioner's own
 * across every practice. Nothing here is practice-scoped, because at this
 * point we do not yet know which practice they mean.
 *
 * MORE THAN ONE PRACTICE IS ORDINARY, NOT AN ERROR. A practitioner works at
 * several and which ones changes; the page asks with the names in front of
 * them rather than picking one, and the choice travels to the queue as
 * `?practice=` — which GRANTS NOTHING. The server checks it against this
 * practitioner's own live affiliations before it opens any scope, so a hand-
 * typed id is refused rather than honoured.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, IdCard } from 'lucide-react';
import { Notice, Shell, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { strings } from '../../strings';
import { useRefreshable } from '../../refresh';
import { apiHeaders } from '../../auth';
import styles from './practitioner.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Statuses that mean somebody is working at a practice now. */
const LIVE = ['active', 'ending'];

interface Affiliation {
  id: string;
  practiceId?: string | null;
  practiceName?: string | null;
  /** The location's single-line address, as `list_practitioner_affiliations` returns it. */
  locationAddress?: string | null;
  status: string;
}

interface Me {
  id: string;
  givenNames: string;
  familyName: string;
  affiliations: Affiliation[];
}

/**
 * One row per practice they currently work at, de-duplicated by id. The
 * address is the FIRST live location's — a practitioner at two sites of one
 * practice is one practice here, and the title names one address rather than
 * two (Carl, 12 Sep 2026).
 */
export function livePractices(
  affiliations: readonly Affiliation[],
): Array<{ id: string; name: string; address: string | null }> {
  const out = new Map<string, { name: string; address: string | null }>();
  for (const affiliation of affiliations) {
    if (!LIVE.includes(affiliation.status)) continue;
    const id = affiliation.practiceId;
    if (!id) continue;
    if (!out.has(id)) {
      out.set(id, { name: affiliation.practiceName ?? id, address: affiliation.locationAddress ?? null });
    }
  }
  return [...out].map(([id, v]) => ({ id, ...v }));
}

export function PractitionerLandingView() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me`, { headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as Me & { message?: string };
      if (!res.ok) throw new Error(body.message ?? String(res.status));
      setMe(body);
      setError(null);
    } catch (err) {
      setError(err instanceof TypeError ? strings.status.unreachable : (err as Error).message);
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    void load();
  }, [load]);

  const practices = me ? livePractices(me.affiliations) : [];
  const only = practices.length === 1 ? practices[0] : null;

  /*
   * THE PRACTICE TRAVELS ON THE LINK WHENEVER WE KNOW IT, and the queue falls
   * back to resolving it server-side when we do not. It GRANTS NOTHING — the
   * server checks it against this practitioner's own live affiliations before
   * it opens any scope — so being explicit costs nothing and saves the queue a
   * round trip it would otherwise make to answer a question this page has
   * already answered.
   */
  const waitingHref = (practiceId?: string) =>
    practiceId ? `/practice/practitioner/waiting?practice=${encodeURIComponent(practiceId)}` : '/practice/practitioner/waiting';

  return (
    <Shell
      right={<SessionControl audience={strings.practitionerQueue.audience} />}
      /*
       * THE TITLE NAMES THE PRACTICE AND ITS ADDRESS when there is exactly one
       * (Carl, 12 Sep 2026: "Your page at Practice: <practice-name and
       * address>"). A doctor at two clinics gets the plain title and the choice
       * beneath it — naming one of two addresses in the heading would be a
       * guess dressed as a fact.
       */
      title={
        only
          ? strings.practitionerQueue.landing.titleAt(only.name, only.address)
          : strings.practitionerQueue.landing.title
      }
      lead={strings.practitionerQueue.landing.lead}
    >
      {error && (
        <Notice tone="stop" title={strings.practitionerQueue.notLoaded}>
          {error}
        </Notice>
      )}

      {me && (
        <p className={ui.hint} data-testid="practitioner-who">
          {strings.practitionerQueue.landing.signedInAs(`${me.givenNames} ${me.familyName}`.trim())}
          {only ? ` ${strings.practitionerQueue.landing.atPractice(only.name)}` : ''}
        </p>
      )}

      {me && practices.length === 0 && (
        <Notice tone="warn" title={strings.practitionerQueue.landing.noPractice} data-testid="practitioner-no-practice">
          {strings.practitionerQueue.landing.noPracticeWhy}
        </Notice>
      )}

      {/*
        THE CHOICE, WITH THE NAMES IN FRONT OF THEM. "Choose the practice
        first" in prose with nowhere to choose is the generic fallback
        CLAUDE.md §7 calls a defect; these are the destinations themselves.
      */}
      {practices.length > 1 && (
        <Notice tone="warn" title={strings.practitionerQueue.landing.choosePractice}>
          <ul className={ui.plainList} data-testid="practitioner-practices">
            {practices.map((practice) => (
              <li key={practice.id}>
                <Link href={waitingHref(practice.id)} className={ui.buttonLink}>
                  {practice.name}
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <div className={styles.cards}>
        {/*
          THE ONE THING THIS PAGE IS FOR. Shown whether or not the practice is
          resolved: with one practice it goes straight there, and with several
          the chooser above is the way in — but the card must still say what
          the page has, rather than vanishing and leaving a blank home screen.
        */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            <CalendarClock size={18} aria-hidden="true" />
            {strings.practitionerQueue.landing.waitingTitle}
          </h2>
          <p className={styles.cardBody}>{strings.practitionerQueue.landing.waitingBody}</p>
          <Link
            href={waitingHref(only?.id)}
            className={ui.buttonLink}
            data-testid="practitioner-to-waiting"
          >
            {strings.practitionerQueue.landing.waitingLink}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </section>

        {/*
          AND THE OTHER PAGE, NAMED RATHER THAN HIDDEN (§1). They answer
          different questions and both should exist; a practitioner who cannot
          find the one about themselves will look for it on this one.
        */}
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>
            <IdCard size={18} aria-hidden="true" />
            {strings.practitionerQueue.landing.aboutYouTitle}
          </h2>
          <p className={styles.cardBody}>{strings.practitionerQueue.landing.aboutYouBody}</p>
          <Link href="/practitioner" className={ui.buttonLink} data-testid="practitioner-to-self">
            {strings.practitionerQueue.landing.aboutYouLink}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </Shell>
  );
}

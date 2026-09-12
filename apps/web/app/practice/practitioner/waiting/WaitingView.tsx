'use client';

/**
 * `/practice/practitioner/waiting` — WHO IS WAITING, AND IS THEIR PAPERWORK
 * DONE (PRACTITIONER-QUEUE-PAGE.md §3; Carl, 12 September 2026).
 *
 * THIS PAGE IS ABOUT PAPERWORK, NOT ABOUT THE WAITING ROOM (§2).
 * `VISIT-WORKFLOW.md` is explicit: *"The PMS is the register of patients.
 * AoBPlatform keeps no shadow patient list."* A page called "your waiting
 * patients" is the most likely place in the whole product to breach that by
 * accident and quietly become a second, competing waiting room. So it answers
 * ONE question per person — is this patient's agreement in place — and it shows
 * who is waiting only because that is the list the answer attaches to. There is
 * no reason for the visit on it, no note, no triage, no duration and nothing a
 * practice management system would call an appointment status; the SERVER's row
 * has no field for any of them, so a component here cannot leak one.
 *
 * NO BUTTON ACTS ON AN AGREEMENT, and there is nothing on the page that could
 * (§3): *"a practitioner does not send tablets or correct addresses, and a
 * control they will never legitimately use is a control that will one day be
 * pressed by mistake."* The only request this file makes is a GET.
 *
 * "ASK RECEPTION" IS NOT BUILT. §6 lists it as undecided — *"is it worth
 * building in the first version, or is the read-only list enough to start"* —
 * and a half-built control that flags somebody's morning is worse than none.
 * The read-only list is the first version.
 *
 * IT NEVER GATES A CONSULTATION, AND IT SAYS SO (hard rule 8, §4.1). The
 * notice is not decoration: the person reading this is the one who could act
 * on a doubt, so the doubt is answered before it is had rather than left to be
 * inferred.
 *
 * TWO MODES, ONE TABLE (Carl, 12 Sep 2026, widening §3). A practitioner sees
 * their own list; an administrator, a manager or a receptionist sees every
 * practitioner's, grouped, because knowing who is waiting for whom is the front
 * desk's job. The BROWSER does not choose between them and cannot: the server
 * decides from the token and says which it gave in `scope`. A page that picked
 * its own mode would be a page that could be made to pick the wrong one.
 *
 * IT REFRESHES QUIETLY (§6's suggestion, taken). A poll, no sound, no badge,
 * and rows are keyed on the arrival so a re-read replaces text in place rather
 * than tearing the table down under somebody mid-consultation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { WaitingList } from '@aobplatform/domain';
import { Notice, Shell } from '../../../ui';
import { SessionControl } from '../../../SessionControl';
import { strings } from '../../../strings';
import { useRefreshable } from '../../../refresh';
import { apiHeaders } from '../../../auth';
import { usePractice } from '../../usePractice';
import styles from '../practitioner.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * THIRTY SECONDS, NOT THREE.
 *
 * The front desk polls every three because a receptionist is watching a
 * patient tick boxes. This is read between patients, and §6 is explicit that
 * *"a list that changes under a practitioner mid-consultation is a
 * distraction"*. Slower is the feature.
 */
const POLL_MS = 30_000;

/**
 * THE TIME THEY ARRIVED, IN THE PRACTICE'S OWN CLOCK-FACE TERMS.
 *
 * NOT A COUNTDOWN AND NOT A TARGET (§3). "Waiting 42 minutes" invites a page
 * to grow a threshold, a colour and then an escalation, and none of those are
 * this platform's business. It is the arrival time, said plainly.
 *
 * EXPORTED FOR ITS OWN TEST, because "23:xx" and an unparseable value are both
 * worth pinning and neither is easy to see on a screenshot.
 */
export function arrivedAtLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * THE WORD FOR A STATE, AND THE CODE ITSELF WHEN THERE IS NO WORD.
 *
 * "Shortcuts to the answer, not directions to a screen" (CLAUDE.md §7): a
 * generic fallback is a defect, and an unmapped code SHOWS ITS CODE so it can
 * be diagnosed rather than rendering blank. On this page a blank paperwork cell
 * would read as "there is no paperwork", which is the most dangerous thing it
 * could say.
 */
export function paperworkLabel(state: string): string {
  return strings.practitionerQueue.waiting.paperwork[state] ?? state;
}

export function WaitingView() {
  const { practiceId, checked } = usePractice();
  const search = useSearchParams();
  const [list, setList] = useState<WaitingList | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * WHICH PRACTICE, AND THE ORDER IS THE RULE.
   *
   *  1. A PRACTICE CLAIM WINS, because it is the server's own answer about
   *     this session and `apiHeaders` re-stamps it regardless of what is
   *     passed. Reception, a manager and an administrator all land here.
   *  2. THEN `?practice=`, which the landing page adds only when a
   *     practitioner works at more than one. It GRANTS NOTHING: the server
   *     checks it against that practitioner's own live affiliations before it
   *     opens any scope, so a hand-typed id is refused rather than honoured.
   *  3. THEN NOTHING AT ALL, which is the ordinary practitioner case — the
   *     server resolves their single practice from their affiliations, and
   *     asking the browser to know it first would be asking it to be told
   *     something it has no way to check.
   */
  const chosen = practiceId ?? search.get('practice') ?? undefined;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/practitioner-queue/waiting`, { headers: apiHeaders(chosen) });
      const body = (await res.json().catch(() => ({}))) as WaitingList & { message?: string };
      if (!res.ok) throw new Error(body.message ?? String(res.status));
      setList(body);
      setError(null);
    } catch (err) {
      setError(err instanceof TypeError ? strings.status.unreachable : (err as Error).message);
    }
  }, [chosen]);

  useRefreshable(load);

  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    // Wait for the practice question to be settled before asking: a first read
    // with no scope, answered a moment later by one with a scope, is the
    // second-fetch race that flickers a list under somebody's hand.
    if (!checked) return undefined;
    void latest.current();
    const timer = setInterval(() => void latest.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [checked, chosen]);

  const groups = list?.groups ?? [];
  const nobody = list !== null && groups.every((group) => group.rows.length === 0);
  /*
   * ONE GROUP AND NO HEADINGS FOR A PRACTITIONER. Their own list is theirs;
   * printing their own name above it would be a screen telling them who they
   * are. Reception's is grouped, because that IS the page for them.
   */
  const grouped = list?.scope === 'practice';

  return (
    <Shell
      right={<SessionControl audience={strings.practitionerQueue.audience} />}
      title={strings.practitionerQueue.waiting.title}
      lead={strings.practitionerQueue.waiting.lead}
    >
      {/*
        THE WAY BACK IS IN THE HEADER, WITH EVERY OTHER PAGE'S (Carl, 12 Sep
        2026: *"no back to today link in header"*). It was in the body here,
        because this page's parent depends on WHO IS READING and the shell's
        map is by path. `BackLink` decides it per audience now — reception, a
        manager or an administrator go up to the day's work, a practitioner to
        their own landing page — so this page carries no back link of its own.
      */}

      {/* Hard rule 8, said out loud to the one person who could act on a doubt. */}
      <Notice tone="ok" data-testid="waiting-never-blocks">
        {strings.practitionerQueue.waiting.neverBlocks}
      </Notice>

      {error && (
        <Notice tone="stop" title={strings.practitionerQueue.notLoaded} data-testid="waiting-error">
          {error}
        </Notice>
      )}

      {list && nobody && (
        <p className={styles.empty} data-testid="waiting-nobody">
          {grouped
            ? strings.practitionerQueue.waiting.nobodyWaitingPractice
            : strings.practitionerQueue.waiting.nobodyWaiting}
        </p>
      )}

      {grouped && !nobody && <h2 className={styles.groupTitle}>{strings.practitionerQueue.waiting.everyone}</h2>}

      <div className={styles.groups} data-testid="waiting-groups">
        {groups
          .filter((group) => group.rows.length > 0)
          .map((group) => (
            <section
              key={group.affiliationId ?? 'unmatched'}
              className={styles.group}
              data-testid={`waiting-group-${group.affiliationId ?? 'unmatched'}`}
            >
              {grouped && (
                <div className={styles.groupHead}>
                  <h3 className={styles.groupTitle}>
                    {group.practitionerName ?? strings.practitionerQueue.waiting.unmatched}
                  </h3>
                  <span className={styles.groupCount}>
                    {strings.practitionerQueue.waiting.count(group.rows.length)}
                  </span>
                </div>
              )}

              {/*
                THE TABLE SCROLLS INSIDE ITSELF RATHER THAN PUSHING THE PAGE
                SIDEWAYS (WCAG 2.2 AA, 1.4.10).
              */}
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className={styles.visuallyHidden}>
                    {group.practitionerName ?? strings.practitionerQueue.waiting.unmatched}
                  </caption>
                  <thead>
                    <tr>
                      {/*
                        NO CARD-NUMBER COLUMN. §3 wants the practice's queue
                        ticket "where the practice uses them", and
                        `Arrival.queueTicket` does not exist yet — a column
                        that is always blank is worse than no column, and a
                        number derived from something else would be mistaken
                        for the one the room is being called by.
                      */}
                      <th scope="col">{strings.practitionerQueue.waiting.columnName}</th>
                      <th scope="col">{strings.practitionerQueue.waiting.columnWaitingSince}</th>
                      <th scope="col">{strings.practitionerQueue.waiting.columnPaperwork}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.arrivalId} data-testid={`waiting-row-${row.arrivalId}`}>
                        <td>
                          <span className={styles.name}>{row.patientName}</span>
                          {/*
                            WHOSE AGREEMENT IT IS, WHERE THAT IS SOMEBODY ELSE
                            (§6a). For a nurse the agreement is under the
                            supervising provider: "Dr Chen's agreement" is
                            honest and "your agreement" would not be. The
                            server sends this only when the two differ.
                          */}
                          {row.agreementProviderName && (
                            <span className={styles.under} data-testid={`waiting-under-${row.arrivalId}`}>
                              {strings.practitionerQueue.waiting.agreementUnder(row.agreementProviderName)}
                            </span>
                          )}
                        </td>
                        <td className={styles.time}>{arrivedAtLabel(row.waitingSince)}</td>
                        <td className={styles.paperwork} data-testid={`waiting-paperwork-${row.arrivalId}`}>
                          {paperworkLabel(row.paperwork)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </div>

      {/* What the three words mean, once, rather than in a tooltip nobody opens. */}
      <p className={styles.key} data-testid="waiting-key">
        {strings.practitionerQueue.waiting.paperworkKey}
      </p>
      {/* And what this page is NOT (§2), said on the page rather than only in a plan. */}
      <p className={styles.key} data-testid="waiting-paperwork-only">
        {strings.practitionerQueue.waiting.paperworkOnly}
      </p>
    </Shell>
  );
}

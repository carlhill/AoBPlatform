'use client';

/**
 * PRACTICE FRONTDESK — the queue rail (FRONT-DESK-PAGE.md §12, Carl 12 Sep
 * 2026: *"we need to have like a queue on the left or the right of the page to
 * show which patients are in flight and which patients are yet to arrive"*).
 *
 * WHAT THIS FIRST SLICE IS, AND WHAT IT IS NOT. It is the rail, the route and
 * the card. The action panel of §4 — one situation, one sentence, one button —
 * is NOT here: its words and its situations need Carl's sign-off before they
 * are drawn, and a half-worded action panel on a beginner's page is worse than
 * an honest placeholder. So the right-hand side names the person, says what
 * happens next for them in a sentence, and says plainly that the buttons are
 * still being built, with a link to the page where the work is done today.
 *
 * THE RAIL IS A PLACE TO LOOK; THE PANEL IS WHERE YOU ACT (§12.2). That is
 * why choosing a name is the only thing the rail can do, and why it carries no
 * chip, no reason and no control. Three rules hold it to that, and each is a
 * named test:
 *
 *  - CHOOSING NEVER ACTS (`front_desk_rail_never_acts_on_selection`). Every
 *    row is a `<button>` whose entire effect is `setChosen`. Nothing in this
 *    file sends, recalls, resends, confirms or corrects anything — there is no
 *    non-GET request in it at all.
 *  - IT DOES NOT RE-SORT UNDER THE HAND
 *    (`front_desk_rail_keeps_its_order_between_polls`). The desk polls every
 *    three seconds and a list that reorders while somebody is reaching for it
 *    is how the wrong patient gets chosen. Rows hold the place they were first
 *    seen in; new ones arrive at the end. See `stableByFirstSeen`.
 *  - A NAME, A TIME AND A GROUP, AND NOTHING ELSE
 *    (`front_desk_rail_shows_no_clinical_detail`). A rail at a front desk
 *    faces the room, which is the same reasoning that keeps the waiting list
 *    off the tablet. No condition, no provider, no reason code, no date of
 *    birth, no identifier of any kind (hard rules 1 and 9), no amount (hard
 *    rule 4).
 *
 * WHERE EVERY FACT COMES FROM, AND NOTHING IS RE-DERIVED (§7). "Here now" and
 * "On a tablet" are the SAME `GET /tablet-sessions/pushable` the tablet desk
 * reads — already ordered by arrival through the supersession chain, so this
 * page never sorts it — split on whether the row has a live session. "Expected"
 * is the one new read, `GET /arrivals/expected`, and §12.4 says why it is
 * allowed: the data exists, nothing else exposes it, and the alternative is
 * this page inferring who is missing, which it must not do.
 *
 * NOTHING HERE BLOCKS CARE (hard rule 8). Every read is independent: the
 * devices read only names a tablet, and the expected read is routinely empty,
 * so neither failing may take the queue down with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ExpectedAppointment } from '@aobplatform/contracts';
import type { DeviceRow } from '@aobplatform/domain';
import { Notice, Shell } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { strings } from '../../strings';
import { useRefreshable } from '../../refresh';
import { apiHeaders } from '../../auth';
/*
 * THE QUEUE ROW'S SHAPE, FROM THE ONE PLACE THAT DEFINES IT. A type-only
 * import: it is erased at compile, so this page does not pull the tablet
 * desk's controls in behind it — but a field added or renamed on the server's
 * row still breaks here rather than being quietly re-declared into a second,
 * drifting copy.
 */
import type { PushableRow } from '../tablet/pushDesk';
import styles from './frontdesk.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * THE SAME THREE SECONDS THE TABLET DESK POLLS ON (`pushDesk.POLL_MS`).
 *
 * Written out rather than imported, because importing the constant would pull
 * that whole module — and its controls — into a page whose entire point is
 * that it has none. The number is the same for the same reason: reception is
 * one hop behind the tablet rather than in front of it.
 */
const POLL_MS = 3000;

/** Which group a chosen name came from — the panel says a different thing for each. */
type Group = 'here' | 'tablet' | 'expected';

interface Chosen {
  readonly group: Group;
  readonly key: string;
}

/**
 * HOLD THE ORDER SOMEBODY IS LOOKING AT (§12.3).
 *
 * WHAT IT DOES. Every key is remembered the first time it is seen, in the
 * order the server gave it; the list is then rendered in that remembered
 * order. On the FIRST load the memory is empty, so the result is exactly the
 * server's own order — which for `pushable` is arrival order through the
 * supersession chain, and this page must not second-guess it. On every later
 * poll, rows already on screen keep their place and new ones join the end.
 *
 * WHY, IN ONE SENTENCE. A list that reorders while somebody is reaching for it
 * is how the wrong patient gets chosen, and at a front desk the wrong patient
 * is a real person handed the wrong screen.
 *
 * A ROW THAT LEAVES IS FORGOTTEN, so the memory cannot grow all morning — and
 * one that comes back later comes back at the end, which is the truth: it is
 * new to the list again.
 *
 * EXPORTED FOR ITS OWN TEST. The rule is worth asserting directly as well as
 * through the rendered rail.
 */
export function stableByFirstSeen<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  memory: Map<string, number>,
): T[] {
  let next = 0;
  for (const rank of memory.values()) next = Math.max(next, rank + 1);
  for (const item of items) {
    const key = keyOf(item);
    if (!memory.has(key)) {
      memory.set(key, next);
      next += 1;
    }
  }
  const live = new Set(items.map(keyOf));
  for (const key of [...memory.keys()]) if (!live.has(key)) memory.delete(key);
  return [...items].sort((a, b) => (memory.get(keyOf(a)) ?? 0) - (memory.get(keyOf(b)) ?? 0));
}

/** The time on a row, or the honest statement that the booking carried none. */
export function timeLabel(time: string | null): string {
  return time && time.trim() !== '' ? time : strings.frontdesk.rail.noTime;
}

/**
 * WHICH TABLET, BY THE NAME THE DESK USES FOR IT — "the blue one" is how the
 * room talks (§12.2). Null when the devices read has not landed or failed,
 * and the panel then says "one of your tablets" rather than inventing a name.
 */
export function deviceLabelFor(deviceId: string | null | undefined, devices: readonly DeviceRow[]): string | null {
  if (!deviceId) return null;
  return devices.find((device) => device.id === deviceId)?.label ?? null;
}

export function FrontDeskView({ practiceId }: { practiceId: string }) {
  const [rows, setRows] = useState<PushableRow[] | null>(null);
  const [expected, setExpected] = useState<ExpectedAppointment[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);

  /*
   * TWO MEMORIES, NOT ONE. The queue and the expected list are pruned against
   * their own contents, and a single shared map would have each list deleting
   * the other's places on every poll — which is the exact re-sort this exists
   * to prevent.
   */
  const queueOrder = useRef(new Map<string, number>());
  const expectedOrder = useRef(new Map<string, number>());

  /*
   * A CHOICE BELONGS TO ONE PRACTICE AND NEVER FOLLOWS THE PAGE TO ANOTHER,
   * and neither does the order it was made in. The same reasoning the tablet
   * desk applies to a half-typed panel.
   */
  useEffect(() => {
    setChosen(null);
    queueOrder.current = new Map();
    expectedOrder.current = new Map();
  }, [practiceId]);

  const load = useCallback(async () => {
    /*
     * THE QUEUE IS THE PAGE; THE OTHER TWO ARE NOT. A failure to name a tablet
     * or to say who is booked in must never empty the list of people standing
     * at the counter (hard rule 8), so those two are caught here and the queue
     * alone decides whether the page could be loaded.
     */
    const [q, d, e] = await Promise.all([
      fetch(`${CORE_URL}/tablet-sessions/pushable`, { headers: apiHeaders(practiceId) }).catch((error: unknown) => {
        throw error;
      }),
      fetch(`${CORE_URL}/devices`, { headers: apiHeaders(practiceId) }).catch(() => null),
      fetch(`${CORE_URL}/arrivals/expected`, { headers: apiHeaders(practiceId) }).catch(() => null),
    ]).catch((error: unknown) => {
      setLoadError(error instanceof TypeError ? strings.status.unreachable : (error as Error).message);
      return [null, null, null] as const;
    });

    if (!q) return;
    if (!q.ok) {
      setLoadError(String(q.status));
      return;
    }

    setRows((await q.json()) as PushableRow[]);
    setLoadError(null);

    const deviceBody = d && d.ok ? ((await d.json()) as { devices?: DeviceRow[] }) : null;
    setDevices(deviceBody?.devices ?? []);

    const expectedBody = e && e.ok ? ((await e.json()) as unknown) : null;
    setExpected(Array.isArray(expectedBody) ? (expectedBody as ExpectedAppointment[]) : []);
  }, [practiceId]);

  // The top bar's refresh button, on every page that has anything to re-read.
  useRefreshable(load);

  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    void latest.current();
    const timer = setInterval(() => void latest.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [practiceId]);

  /*
   * THE TWO GROUPS THE QUEUE ANSWERS, SPLIT ON THE ONE FIELD THAT DECIDES IT
   * (§12.4). The server's order is preserved inside each; nothing here sorts.
   */
  const queue = useMemo(
    () => stableByFirstSeen(rows ?? [], (row) => row.agreementId, queueOrder.current),
    [rows],
  );
  const here = queue.filter((row) => row.activeSession === null);
  const onTablet = queue.filter((row) => row.activeSession !== null);

  /*
   * AND NOBODY IS IN TWO PLACES AT ONCE. A booking can have a draft waiting on
   * it before the patient walks in, so the same person could be named both in
   * the queue and among the expected. The queue wins: it is the list with work
   * on it, and a name under "yet to arrive" while there is something to do for
   * them at the desk would be a screen arguing with itself.
   */
  const inQueue = new Set(queue.map((row) => row.patientId));
  const waiting = stableByFirstSeen(
    expected.filter((appointment) => !inQueue.has(appointment.patientId)),
    (appointment) => appointment.appointmentId,
    expectedOrder.current,
  );

  /*
   * A CHOICE THAT HAS LEFT THE LIST IS NO CHOICE. The person signed, walked
   * away or arrived; keeping their name on the panel would leave somebody
   * acting on a person who is no longer there.
   */
  useEffect(() => {
    if (!chosen) return;
    const live =
      chosen.group === 'expected'
        ? waiting.some((appointment) => appointment.appointmentId === chosen.key)
        : queue.some((row) => row.agreementId === chosen.key);
    if (!live) setChosen(null);
  });

  const chosenRow = chosen && chosen.group !== 'expected'
    ? queue.find((row) => row.agreementId === chosen.key) ?? null
    : null;
  const chosenAppointment = chosen && chosen.group === 'expected'
    ? waiting.find((appointment) => appointment.appointmentId === chosen.key) ?? null
    : null;

  if (loadError && rows === null) {
    return (
      <Shell
        right={<SessionControl audience={strings.frontdesk.audience} />}
        title={strings.frontdesk.title}
        lead={strings.frontdesk.lead}
      >
        <Notice tone="stop" title={strings.frontdesk.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell
      right={<SessionControl audience={strings.frontdesk.audience} />}
      title={strings.frontdesk.title}
      lead={strings.frontdesk.lead}
    >
      {/* Hard rule 8, said out loud to the person most likely to doubt it. */}
      <Notice tone="ok" data-testid="frontdesk-never-blocks">{strings.frontdesk.neverBlocks}</Notice>

      {loadError && (
        <Notice tone="warn" title={strings.frontdesk.notLoaded}>
          {loadError}
        </Notice>
      )}

      <div className={styles.layout}>
        <nav className={styles.rail} aria-label={strings.frontdesk.rail.label} data-testid="frontdesk-rail">
          <RailGroup
            group="here"
            testId="here"
            title={strings.frontdesk.rail.hereNow}
            empty={strings.frontdesk.rail.hereNoneYet}
            chosen={chosen}
            onChoose={setChosen}
            items={here.map((row) => ({
              key: row.agreementId,
              name: row.patientName,
              time: timeLabel(row.appointmentTime),
            }))}
          />

          <RailGroup
            group="tablet"
            testId="tablet"
            title={strings.frontdesk.rail.onATablet}
            empty={strings.frontdesk.rail.tabletNoneYet}
            chosen={chosen}
            onChoose={setChosen}
            items={onTablet.map((row) => ({
              key: row.agreementId,
              name: row.patientName,
              time: timeLabel(row.appointmentTime),
            }))}
          />

          {/*
            EXPECTED IS ALWAYS HERE, EVEN — ESPECIALLY — WHEN IT IS EMPTY
            (§12.5, and Carl's recommendation there). Appointments only reach
            us when the practice's software sends them, which is behind blocker
            D-01, so this list is empty in every practice today. Hiding it
            would make that a silent gap; showing it with the reason turns "why
            can't I see my bookings" into an answer from the screen.
          */}
          <RailGroup
            group="expected"
            testId="expected"
            title={strings.frontdesk.rail.expected}
            empty={strings.frontdesk.rail.expectedNoneYet}
            why={waiting.length === 0 ? strings.frontdesk.rail.expectedWhy : undefined}
            chosen={chosen}
            onChoose={setChosen}
            items={waiting.map((appointment) => ({
              key: appointment.appointmentId,
              name: appointment.patientName,
              time: timeLabel(appointment.time),
            }))}
          />
        </nav>

        <section className={styles.panel} aria-label={strings.frontdesk.title} data-testid="frontdesk-panel">
          {!chosen && (
            <>
              <h2 className={styles.panelName}>{strings.frontdesk.panel.nothingChosen}</h2>
              <p className={styles.panelLead}>{strings.frontdesk.panel.nothingChosenLead}</p>
            </>
          )}

          {chosen && chosenRow && (
            <>
              <h2 className={styles.panelName} data-testid="frontdesk-chosen-name">
                {chosenRow.patientName}
              </h2>
              <p className={styles.panelLead} data-testid="frontdesk-chosen-what">
                {chosen.group === 'tablet'
                  ? tabletSentence(chosenRow, devices)
                  : strings.frontdesk.panel.hereNow(chosenRow.patientName)}
              </p>
              <p className={styles.panelNext}>
                {chosen.group === 'tablet'
                  ? strings.frontdesk.panel.onATabletNext
                  : strings.frontdesk.panel.hereNowNext}
              </p>
            </>
          )}

          {chosen && chosenAppointment && (
            <>
              <h2 className={styles.panelName} data-testid="frontdesk-chosen-name">
                {chosenAppointment.patientName}
              </h2>
              <p className={styles.panelLead} data-testid="frontdesk-chosen-what">
                {strings.frontdesk.panel.expected(chosenAppointment.patientName)}
              </p>
              <p className={styles.panelNext}>{strings.frontdesk.panel.expectedNext}</p>
            </>
          )}

          {/*
            AND WHAT IS NOT BUILT YET, SAID PLAINLY, WITH SOMEWHERE TO GO. A
            page that shows a person and then stops reads as broken; "see the
            practice queue" in prose is the generic fallback CLAUDE.md §7 calls
            a defect. This names what is missing and links to the page where
            the same list is worked today.
          */}
          {chosen && (
            <>
              <Notice tone="warn" title={strings.frontdesk.panel.notYet} data-testid="frontdesk-not-yet">
                {strings.frontdesk.panel.notYetWhere}
              </Notice>
              <Link href="/practice/tablet" className={styles.toTablet} data-testid="frontdesk-to-tablet">
                {strings.frontdesk.panel.toTablet}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

/** Which tablet they have, by its name where we know it. */
function tabletSentence(row: PushableRow, devices: readonly DeviceRow[]): string {
  const label = deviceLabelFor(row.activeSession?.deviceId, devices);
  return label
    ? strings.frontdesk.panel.onATablet(row.patientName, label)
    : strings.frontdesk.panel.onATabletUnnamed(row.patientName);
}

interface RailItem {
  readonly key: string;
  readonly name: string;
  readonly time: string;
}

/**
 * ONE GROUP OF THE RAIL.
 *
 * THE COUNT IS THE LIVE REGION, NOT THE ROWS (§12.3). A patient moving from
 * Expected to Here now is worth announcing; every poll is not. The spoken
 * version names its group — "Here now: 2 people" — because a bare number
 * announced on its own, minutes after the heading was read, tells nobody
 * anything.
 *
 * EVERY ROW IS A BUTTON AND EVERY BUTTON ONLY CHOOSES. `aria-pressed` says
 * which one is chosen, so the choice is carried by more than a background
 * colour, and the whole row is the target rather than the name inside it.
 */
function RailGroup({
  group,
  testId,
  title,
  empty,
  why,
  items,
  chosen,
  onChoose,
}: {
  group: Group;
  testId: string;
  title: string;
  empty: string;
  why?: string;
  items: readonly RailItem[];
  chosen: Chosen | null;
  onChoose: (chosen: Chosen) => void;
}) {
  const count = strings.frontdesk.rail.count(items.length);
  return (
    <div className={styles.group} data-testid={`frontdesk-group-${testId}`}>
      <div className={styles.groupHead}>
        <h2 className={styles.groupTitle}>{title}</h2>
        <span className={styles.groupCount} aria-hidden="true" data-testid={`frontdesk-count-${testId}`}>
          {count}
        </span>
        <span className={styles.visuallyHidden} aria-live="polite">
          {`${title}: ${count}`}
        </span>
      </div>

      {items.length === 0 ? (
        <p className={styles.empty} data-testid={`frontdesk-empty-${testId}`}>
          {empty}
        </p>
      ) : (
        <ul className={styles.rows}>
          {items.map((item) => (
            <li key={item.key} className={styles.row}>
              <button
                type="button"
                className={styles.pick}
                aria-pressed={chosen?.group === group && chosen.key === item.key}
                onClick={() => onChoose({ group, key: item.key })}
                data-testid={`frontdesk-row-${item.key}`}
              >
                <span className={styles.name}>{item.name}</span>
                <span className={styles.time}>{item.time}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {why && (
        <p className={styles.why} data-testid={`frontdesk-why-${testId}`}>
          {why}
        </p>
      )}
    </div>
  );
}

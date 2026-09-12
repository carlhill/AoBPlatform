/**
 * ONE DAY, AS THE PRACTICE MEANS IT.
 *
 * WHY THIS FILE EXISTS. "Who came in today" is asked by a person standing in a
 * room in Australia, and it has to be answered with the day THEY are having.
 * The platform has three different answers to that question today and they do
 * not agree:
 *
 *   - `today()` in `tablet-sessions.service.ts` is `new Date().toISOString()
 *     .slice(0, 10)` — the UTC date, which in Sydney is YESTERDAY for the whole
 *     morning (8am AEST is 22:00 UTC the day before). It is a known defect.
 *   - `startOfDay` in `practitioner-queue.service.ts` and
 *     `arrivals.service.ts` is `new Date(); setHours(0, 0, 0, 0)` — the day the
 *     SERVER is having. Correct on a laptop in Sydney, and identical to the
 *     UTC date on Fargate and in CI, which both run UTC. That is why nothing
 *     catches it.
 *   - `partsInReportTimezone` in `reporting.ts` is the only one that is right
 *     wherever it runs, and it is right for exactly the reason this file needs:
 *     *"Bucketing in UTC would file a notice sent at 9am in Sydney under the
 *     previous day."*
 *
 * So this builds on the third rather than adding a fourth. `REPORT_TIMEZONE`
 * is imported rather than restated — one zone, one constant, and two names for
 * it would be two things to change when a practice outside NSW/VIC/QLD/TAS
 * needs its own.
 *
 * WHAT IT IS NOT. There is no per-practice timezone column on `Practice`
 * (`schema.prisma`), so "the practice's clock" is the platform's one Australian
 * clock until there is somewhere to record a different one. Whether a practice
 * in Perth or Brisbane gets its own is a product decision, not a build's —
 * flagged rather than guessed (CLAUDE.md §7, wow.md §9).
 *
 * NOTHING HERE READS A CLOCK OF ITS OWN unless asked to. `now` is a parameter
 * on every function, so a test can pin an instant instead of skipping when it
 * runs at the wrong hour (wow.md §2 item 6).
 */

import { REPORT_TIMEZONE, partsInReportTimezone } from './reporting';

/**
 * THE ZONE A PRACTICE'S DAY IS MEASURED IN — the reporting zone, deliberately
 * the same object rather than a copy.
 *
 * If the two ever diverged, a day register and the report of the same day would
 * disagree about which visits happened on it, and neither screen would say so.
 */
export const PRACTICE_TIMEZONE = REPORT_TIMEZONE;

/** `YYYY-MM-DD`, and nothing else. Shape only — `2026-02-31` passes this. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Thrown for a date that is not a real calendar day. Callers map it to a 400. */
export class NotACalendarDay extends Error {}

/**
 * ONE DAY IN THE PRACTICE'S ZONE, AS A HALF-OPEN INTERVAL OF INSTANTS.
 *
 * HALF-OPEN — `from <= t < to` — because the alternative is a row landing in
 * two days or in none. `arrivedAt` is a `timestamptz`, so the query is an
 * instant comparison and the boundary has to be exact.
 */
export interface PracticeDayWindow {
  /** The day being asked about, `YYYY-MM-DD`, in `PRACTICE_TIMEZONE`. */
  readonly day: string;
  /** Named on the wire so a screen never has to assume which zone it got. */
  readonly timezone: string;
  /** Midnight at the start of that day, as an instant. */
  readonly from: Date;
  /** Midnight at the start of the NEXT day, exclusive. */
  readonly to: Date;
}

/**
 * HOW FAR THE PRACTICE'S ZONE IS FROM UTC AT ONE INSTANT.
 *
 * VIA `Intl`, NEVER A FIXED NUMBER, and it is the same reason
 * `partsInReportTimezone` gives: Sydney is +10 or +11 depending on the date, so
 * a constant offset is wrong for roughly half the year and the error is a
 * silent one-hour shift rather than a crash.
 */
function offsetMsAt(at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRACTICE_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(at).map((part) => [part.type, part.value]));
  const wallClock = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    // Some locales render midnight as hour 24. Both mean the same instant.
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  // The formatter has no milliseconds, so neither may the instant it is compared to.
  return wallClock - (at.getTime() - at.getMilliseconds());
}

/** `YYYY-MM-DD` for a `Date`'s calendar day in the practice's zone. */
function dayOf(at: Date): string {
  const { year, month, day } = partsInReportTimezone(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * MIDNIGHT AT THE START OF A CALENDAR DAY IN THE PRACTICE'S ZONE.
 *
 * TWO PASSES, AND THE SECOND IS NOT BELT-AND-BRACES. The offset has to be
 * looked up at an instant, and the instant is what is being solved for — so the
 * first pass asks at the wrong one. On the two days a year that straddle a
 * transition the two answers differ, and the second pass is what makes the
 * result the real midnight rather than one an hour out. (Sydney switches at
 * 2am, so midnight itself always exists; a zone that skipped midnight would
 * land on the first instant that does, which is the honest answer either way.)
 */
function startOfDayInPracticeZone(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const wallClock = Date.UTC(year, month - 1, date, 0, 0, 0, 0);
  const firstPass = wallClock - offsetMsAt(new Date(wallClock));
  const secondPass = wallClock - offsetMsAt(new Date(firstPass));
  return new Date(secondPass);
}

/** Today's calendar day in the practice's zone — never `toISOString().slice(0, 10)`. */
export function practiceToday(now: Date = new Date()): string {
  return dayOf(now);
}

/**
 * THE WINDOW FOR ONE DAY, OR FOR TODAY WHEN NOBODY NAMED ONE.
 *
 * AN ABSENT DAY IS NOT AN ERROR — it is the ordinary case, and it means today
 * by the practice's clock. A day that is not a real calendar day IS an error
 * and is refused rather than nudged: `2026-02-31` silently becoming 3 March
 * would put a register under a heading that never happened.
 *
 * THE ROUND TRIP IS THE VALIDATION. The shape check passes `2026-02-31`; the
 * only honest way to know a day exists is to build it and ask the calendar what
 * it came to.
 */
export function practiceDayWindow(day: string | null | undefined, now: Date = new Date()): PracticeDayWindow {
  const asked = day && day.length > 0 ? day : practiceToday(now);

  if (!CALENDAR_DAY.test(asked)) {
    throw new NotACalendarDay(`"${asked}" is not a date. Ask for one written as YYYY-MM-DD, or ask for none and get today.`);
  }

  const from = startOfDayInPracticeZone(asked);
  if (dayOf(from) !== asked) {
    throw new NotACalendarDay(`"${asked}" is not a day that exists. Ask for one written as YYYY-MM-DD.`);
  }

  const [year, month, date] = asked.split('-').map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  const to = startOfDayInPracticeZone(
    `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`,
  );

  return { day: asked, timezone: PRACTICE_TIMEZONE, from, to };
}

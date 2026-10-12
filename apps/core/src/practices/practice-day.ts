import type { Prisma } from '@prisma/client';
import { DEFAULT_PRACTICE_TIMEZONE, practiceDayOf, startOfPracticeDay } from '@aobplatform/domain';

/**
 * ONE PRACTICE'S "TODAY" AT ONE INSTANT (D-2026-10-10-03).
 *
 * The one place core turns `practices.timezone` and a clock into a day. Every
 * statutory date written at draft or lock (D2, D5) and every "today" used to
 * choose one is read through here, so the desk, the lock and the auto-capture
 * day can never disagree about which day it is (D-2026-09-12-17 item 2).
 */
export interface PracticeDay {
  /** The IANA zone on `practices.timezone`. */
  timeZone: string;
  /** `YYYY-MM-DD` in that zone — the ISO date every particular is written in. */
  todayIso: string;
  /** The instant of local midnight at the start of `todayIso`. */
  startOfDay: Date;
}

/**
 * THE PRACTICE'S ZONE, read INSIDE the caller's `withPractice` transaction so
 * it is scoped by the same RLS as the rows it dates. A missing row (it cannot
 * be, inside a practice scope) falls back to the column default, never to UTC.
 */
export async function readPracticeTimeZone(tx: Prisma.TransactionClient): Promise<string> {
  const practice = await tx.practice.findFirst({ select: { timezone: true } });
  return practice?.timezone ?? DEFAULT_PRACTICE_TIMEZONE;
}

/** `PracticeDay` for `now`, in the zone of the practice `tx` is scoped to. */
export async function readPracticeDay(tx: Prisma.TransactionClient, now: Date): Promise<PracticeDay> {
  const timeZone = await readPracticeTimeZone(tx);
  return { timeZone, todayIso: practiceDayOf(now, timeZone), startOfDay: startOfPracticeDay(now, timeZone) };
}

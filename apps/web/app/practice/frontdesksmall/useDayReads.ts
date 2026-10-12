'use client';

/**
 * THE TWO READS THE TABLET DESK DOES NOT MAKE — today's booking list and
 * today's register — polled on the same three seconds `usePushDesk` uses.
 *
 * WHY THIS FILE EXISTS, SAID PLAINLY. It is the SECOND copy of these two
 * fetches. The first is inside `FrontDeskView.tsx` as two `useCallback`s that
 * are not exported and cannot be imported without editing that file, which was
 * being edited by somebody else when this page was built (wow.md §5). This is
 * the "duplicate the minimum, flagged" case from that rule, and the flag is
 * here rather than only in a report: **the third caller extracts it, and
 * `FrontDeskView` moves onto this hook in the same commit** (wow.md §10, the
 * rule of three).
 *
 * WHAT IS AND IS NOT DUPLICATED. Only the two `fetch` calls and their poll.
 * Every DECISION about what the answers mean — which rail, which state, what
 * the day's total is — is `dayRails`, imported by both pages, so the two
 * screens cannot come to disagree about a morning even while this stays
 * copied.
 *
 * A FAILURE LEAVES THE REGISTER AS IT WAS rather than blanking it, so a single
 * dropped poll does not make the chips flicker out from under somebody
 * mid-patient. Null means "never read", not "nobody came in", and the page
 * degrades to the queue-only view — hard rule 8, REQ-REC-04: a read that
 * failed slows the evidence and never the service.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DayRegister, ExpectedAppointment } from '@aobplatform/contracts';
import { apiHeaders } from '../../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** The same three seconds the tablet desk polls on, so the halves never drift. */
const POLL_MS = 3000;

export interface DayReads {
  readonly expected: readonly ExpectedAppointment[];
  /** Null until the register has landed, and null for as long as it never does. */
  readonly register: DayRegister | null;
  /** Re-read both, for the top bar's refresh. */
  readonly load: () => Promise<void>;
}

export function useDayReads(practiceId: string): DayReads {
  const [expected, setExpected] = useState<readonly ExpectedAppointment[]>([]);
  const [register, setRegister] = useState<DayRegister | null>(null);

  /*
   * A READ BELONGS TO ONE PRACTICE AND NEVER FOLLOWS THE PAGE TO ANOTHER. The
   * same reasoning the tablet desk applies to a half-typed panel.
   */
  useEffect(() => {
    setExpected([]);
    setRegister(null);
  }, [practiceId]);

  /*
   * THE BOOKING LIST, WHOSE FAILURE IS NEVER THE PAGE'S. Nobody is waiting on
   * it, and a desk that emptied because an appointment feed was down would be
   * the platform blocking work over something nobody needs (hard rule 8).
   */
  const loadExpected = useCallback(async () => {
    const answer = await fetch(`${CORE_URL}/arrivals/expected`, {
      headers: apiHeaders(practiceId),
    }).catch(() => null);
    const body = answer && answer.ok ? ((await answer.json()) as unknown) : null;
    setExpected(Array.isArray(body) ? (body as ExpectedAppointment[]) : []);
  }, [practiceId]);

  /*
   * AND THE READ THAT MAKES THE CHIPS ADD UP — the same `GET /arrivals/day`,
   * with NO DATE, that `/practice/day` and `/practice/frontdesk` both make,
   * because the day is the server's answer by the practice's clock. Three
   * screens asking one endpoint the same question is what "reconcile by
   * construction" means here; a desk that worked out its own day would be one
   * more definition of "today" in a codebase that already has too many.
   */
  const loadDay = useCallback(async () => {
    const answer = await fetch(`${CORE_URL}/arrivals/day`, {
      headers: apiHeaders(practiceId),
    }).catch(() => null);
    if (!answer || !answer.ok) return;
    const body = (await answer.json().catch(() => null)) as DayRegister | null;
    if (!body || !Array.isArray(body.rows)) return;
    setRegister(body);
  }, [practiceId]);

  /*
   * THE LOADERS ARE READ THROUGH A REF, so the identity a caller registers
   * with `useRefreshable` is STABLE. Without it the top bar de-registers and
   * re-registers its refresh three times a second once the poll is running.
   */
  const latest = useRef({ expected: loadExpected, day: loadDay });
  latest.current = { expected: loadExpected, day: loadDay };

  const load = useCallback(async () => {
    await Promise.all([latest.current.expected(), latest.current.day()]);
  }, []);

  useEffect(() => {
    const both = () => {
      void latest.current.expected();
      void latest.current.day();
    };
    both();
    const timer = setInterval(both, POLL_MS);
    return () => clearInterval(timer);
  }, [practiceId]);

  return { expected, register, load };
}

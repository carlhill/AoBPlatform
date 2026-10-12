'use client';

/**
 * WHICH PARTS OF AoB DOES THIS PRACTICE USE — the console's half of
 * D-2026-09-14-04.
 *
 * WHY IT IS A SECOND HOOK AND NOT PART OF `useEffectivePractice`. That one
 * answers "which practice am I in", which every page needs and which is
 * answered from the token or from the acting-as session. This answers "and
 * what has that practice bought", which is a read of the practice row. Two
 * questions, two lifetimes, two failure modes — and folding them together
 * would make every page that only needs the practice id wait for a read it
 * does not care about.
 *
 * IT FAILS OPEN, AND THAT IS DELIBERATE — the opposite of
 * `useEffectivePractice`, which fails closed, so the difference is worth
 * saying out loud. That one decides whether somebody holds a practice claim,
 * where being wrong shows another practice's work. This decides whether a
 * practice has bought a part of the product, where being wrong offers a link
 * early. The server refuses the endpoints behind every one of those links with
 * its own reason code, so the cost of guessing "everything" is a door that
 * explains itself when opened; the cost of guessing "nothing" is a practice
 * whose console empties out because one settings read failed, which would look
 * exactly like an outage (hard rule 8).
 *
 * CACHED, because three components on every page would otherwise each fetch it
 * on every navigation, and the answer changes about once in the life of a
 * practice. `forgetSurfaceProfile` drops it the moment the setting is saved,
 * so the person who just changed it sees the change rather than waiting out a
 * timer.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_SURFACE_PROFILE } from '@aobplatform/domain';
import { apiHeaders } from './auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Long, because a practice's profile is changed about once and then never. */
const CACHE_MS = 300_000;

let cached: { at: number; practiceId: string; profile: string } | null = null;
let inFlight: Promise<string> | null = null;

/*
 * SUBSCRIBERS, for the same reason `effectivePractice.ts` has them: `Shell`
 * renders on every page and does not unmount when you navigate, so dropping
 * the cache tells nobody unless somebody is listening.
 */
let version = 0;
const listeners = new Set<() => void>();

/** Dropped when the setting is saved, so the next read is honest. */
export function forgetSurfaceProfile(): void {
  cached = null;
  inFlight = null;
  version += 1;
  for (const notify of listeners) notify();
}

export async function fetchSurfaceProfile(practiceId: string): Promise<string> {
  if (cached && cached.practiceId === practiceId && Date.now() - cached.at < CACHE_MS) return cached.profile;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${CORE_URL}/practices/${practiceId}`, { headers: apiHeaders(practiceId) });
      if (!res.ok) return DEFAULT_SURFACE_PROFILE;
      const body = (await res.json()) as { surfaceProfile?: string };
      const profile = typeof body.surfaceProfile === 'string' ? body.surfaceProfile : DEFAULT_SURFACE_PROFILE;
      cached = { at: Date.now(), practiceId, profile };
      return profile;
    } catch {
      // Silent, and everything. Not being able to read a setting is not a
      // reason to take a practice's console away from them.
      return DEFAULT_SURFACE_PROFILE;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * The practice's profile, and whether we know yet.
 *
 * `settled` matters for the same reason it does in `useEffectivePractice`:
 * deciding before the answer arrives means a guard refusing a page for the
 * half-second before it learns the practice does use it — a flash of "this
 * practice does not use that" at a practice that does.
 *
 * NO PRACTICE MEANS NOTHING TO ASK. A platform operator with no session open,
 * a signed-out visitor, a patient on a token page: there is no practice whose
 * profile could answer, so the default stands and nothing is fetched.
 */
export function useSurfaceProfile(practiceId?: string): { profile: string; settled: boolean } {
  const [profile, setProfile] = useState(DEFAULT_SURFACE_PROFILE);
  const [settled, setSettled] = useState(!practiceId);
  const [tick, setTick] = useState(version);

  useEffect(() => {
    const notify = () => setTick(version);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  useEffect(() => {
    if (!practiceId) {
      setProfile(DEFAULT_SURFACE_PROFILE);
      setSettled(true);
      return;
    }
    let live = true;
    setSettled(false);
    void fetchSurfaceProfile(practiceId).then((answer) => {
      if (!live) return;
      setProfile(answer);
      setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [practiceId, tick]);

  return { profile, settled };
}

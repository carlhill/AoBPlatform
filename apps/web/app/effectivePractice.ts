'use client';

/**
 * WHICH PRACTICE AM I EFFECTIVELY IN — the browser's answer to the question the
 * server already answers for itself.
 *
 * WHY THIS HAD TO EXIST. A platform operator's token carries no practice claim.
 * Acting as a practice is what grants one, and that session lives on the SERVER:
 * the acting-as interceptor puts the claim on the principal, so every endpoint
 * behind a practice page correctly lets an operator with an open session
 * through.
 *
 * The browser never knew. `AccessGuard` and the menu both read
 * `currentSession().practiceId`, which is the OIDC token and nothing else — so
 * an operator with a perfectly valid open session was refused by the guard and
 * bounced away four seconds later, and the menu showed them no practice pages
 * at all. The design said "you reach practice pages by acting as a practice";
 * the browser made that untrue.
 *
 * So both now ask here, and here asks the server.
 *
 * CACHED, because two components on every page would otherwise each fetch it on
 * every navigation. Short-lived, because an acting-as session ENDS — on its own
 * after thirty minutes, or because somebody closed it — and a cache that
 * outlived it would leave the console showing practice pages to an operator
 * whose standing to open them had gone.
 *
 * FAILS CLOSED. If the answer cannot be had, there is no practice claim. An
 * operator sees the platform pages, which is what they are entitled to with no
 * session open, rather than practice pages they may no longer reach.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiHeaders, currentSession } from './auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Well inside the thirty-minute cap, and cheap enough to be unnoticeable. */
const CACHE_MS = 20_000;

export type ActingAs = { practiceId: string; practiceName?: string | null } | null;

let cached: { at: number; value: ActingAs } | null = null;
let inFlight: Promise<ActingAs> | null = null;

/*
 * SUBSCRIBERS, because clearing the cache is not enough on its own.
 *
 * `Shell` renders on every page and does not unmount when you navigate, so the
 * hook below is long-lived. Dropping the cached answer told nobody: the effect
 * had already run, its dependencies had not changed, and it never fetched
 * again. An operator who had just started a session was therefore pushed to the
 * console and refused by a guard still holding the answer from before they
 * started -- which is exactly the bounce this file was written to fix, moved
 * one step later.
 */
let version = 0;
const listeners = new Set<() => void>();

/** Dropped when a session starts or ends, so the next read is honest. */
export function forgetActingAs(): void {
  cached = null;
  inFlight = null;
  version += 1;
  for (const notify of listeners) notify();
}

export async function fetchActingAs(): Promise<ActingAs> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${CORE_URL}/acting-as/current`, { headers: apiHeaders() });
      if (!res.ok) return null;
      const body = (await res.json()) as { acting?: boolean; session?: { practiceId?: string; practiceName?: string } };
      const value: ActingAs =
        body.acting && body.session?.practiceId
          ? { practiceId: body.session.practiceId, practiceName: body.session.practiceName ?? null }
          : null;
      cached = { at: Date.now(), value };
      return value;
    } catch {
      // Silent, and null. Not being able to tell is not something to shout at
      // somebody who is probably not acting as anybody at all.
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * The practice claim this browser effectively holds, and whether we know yet.
 *
 * `settled` matters. Deciding before the answer arrives means a guard refusing
 * an operator for the half-second before it learns they are acting as somebody
 * — a flash of "this page is not yours" at somebody it is.
 */
export function useEffectivePractice(): { practiceId?: string; settled: boolean } {
  const fromToken = currentSession()?.practiceId;
  const pathname = usePathname();
  const [acting, setActing] = useState<ActingAs>(null);
  // A token that already carries the claim needs no round trip, and there is
  // nothing to wait for.
  const [settled, setSettled] = useState(Boolean(fromToken) || !currentSession());
  const [tick, setTick] = useState(version);

  // Told when a session starts or ends, rather than waiting for the cache to
  // age out. Half a minute of the console showing the wrong scope is half a
  // minute too long.
  useEffect(() => {
    const notify = () => setTick(version);
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);

  useEffect(() => {
    if (fromToken || !currentSession()) {
      setSettled(true);
      return;
    }

    let live = true;
    // NOT settled while this is in flight, so a guard does not decide on the
    // previous page's answer.
    setSettled(false);
    void fetchActingAs().then((v) => {
      if (!live) return;
      setActing(v);
      setSettled(true);
    });
    return () => {
      live = false;
    };
    // `pathname` because navigating is exactly when the answer matters, and
    // `tick` because starting or ending a session changes it without navigating.
  }, [fromToken, pathname, tick]);

  return { practiceId: fromToken ?? acting?.practiceId, settled };
}

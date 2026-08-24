'use client';

/**
 * "Refresh this page" without reloading the browser.
 *
 * WHY IT MATTERS MORE HERE THAN IN MOST PRODUCTS. The access token is held in
 * memory only, deliberately — nothing about this session survives in
 * localStorage where a script could reach it. The cost is that F5 throws the
 * session away, and the browser then has to re-establish it. Carl's words:
 * "otherwise I have to reload the page, which prompts me to sign in again."
 *
 * So a reload is expensive in a way it is not elsewhere, and every screen needs
 * a way to say "ask the server again" that is not a reload.
 *
 * WHY A REGISTRY RATHER THAN A PROP. `Shell` wraps every page and is where a
 * control belongs that appears on every page. But Shell cannot know how to
 * reload a page's data — only the page knows that. So pages register their own
 * loader and Shell renders the button.
 *
 * AND THE BUTTON IS HIDDEN WHEN NOBODY HAS REGISTERED. A refresh control that
 * does nothing is worse than none: it teaches somebody that refreshing does not
 * work, and they go back to pressing F5, which is the thing this exists to
 * avoid. If a page has nothing to re-fetch, it shows no button.
 *
 * NOT A CURE. The real fix is that a reload should restore the session silently
 * rather than asking somebody to sign in again — `attemptSilentLogin` already
 * exists and one page uses it. This makes the symptom bearable; it does not
 * make F5 safe.
 */

import { useEffect, useState } from 'react';

type Loader = () => void | Promise<unknown>;

const loaders = new Set<Loader>();
const watchers = new Set<() => void>();

function announce(): void {
  for (const w of watchers) w();
}

/**
 * Register this page's reload. Call it with whatever `load` the page already
 * has — usually a `useCallback`, which keeps the identity stable so this does
 * not re-register on every render.
 */
export function useRefreshable(load: Loader): void {
  useEffect(() => {
    loaders.add(load);
    announce();
    return () => {
      loaders.delete(load);
      announce();
    };
  }, [load]);
}

/** Whether anything on this page can be refreshed. Drives the button. */
export function useHasRefresh(): boolean {
  const [has, setHas] = useState(loaders.size > 0);
  useEffect(() => {
    const w = () => setHas(loaders.size > 0);
    watchers.add(w);
    w();
    return () => {
      watchers.delete(w);
    };
  }, []);
  return has;
}

/**
 * Run every registered loader.
 *
 * ALL of them, not the most recent. A page can have more than one independent
 * read — a roster and a summary, say — and refreshing one while leaving the
 * other stale produces two numbers on one screen that disagree, which is worse
 * than both being a minute old.
 */
export async function refreshAll(): Promise<void> {
  await Promise.all([...loaders].map((load) => Promise.resolve().then(load).catch(() => undefined)));
}

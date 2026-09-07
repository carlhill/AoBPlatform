import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The acting-as key that rides along with every vault event.
 *
 * WHY AMBIENT RATHER THAN A PARAMETER. Carl's requirement was that when a
 * platform user enters acting-as mode, "a unique key should be generated and
 * written to all records that are created/updated". There are around forty
 * `enqueueVaultEvent` call sites, and threading a parameter through all of
 * them would mean the guarantee holds only until somebody adds the
 * forty-first and forgets.
 *
 * The same reasoning as AttributionInterceptor: a rule that depends on every
 * future caller remembering is not a rule. This one cannot be forgotten,
 * because the caller never sees it.
 *
 * SET ONCE PER REQUEST, by the interceptor that knows whether the session is
 * live. Outside a request — the queue worker, a scheduled sweep — there is no
 * store, `actingAsKey()` answers undefined, and events are written exactly as
 * before.
 */
const store = new AsyncLocalStorage<{ actingAsSessionId: string }>();

/** Runs `fn` with every vault event inside it tagged with this session. */
export function withActingAs<T>(actingAsSessionId: string, fn: () => T): T {
  return store.run({ actingAsSessionId }, fn);
}

/** The current session id, if this code is running inside one. */
export function actingAsKey(): string | undefined {
  return store.getStore()?.actingAsSessionId;
}

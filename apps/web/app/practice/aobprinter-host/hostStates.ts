/**
 * WHICH OF THE TEN STATES A HOST IS IN, WORST FIRST (PRINTER-HEARTBEAT.md §4,
 * D-2026-10-10-02).
 *
 * ONE ORDER, TWO PAGES. The practice's page lists every state that applies to
 * a host in this order, and the platform overview sorts hosts by the first
 * state that applies. Both read this file, so "worst" cannot mean one thing on
 * one page and another on the other.
 *
 * NOTHING HERE DECIDES A THRESHOLD THE SERVER OWNS. Liveness arrives decided
 * (decision 2), the chain status arrives decided, and `staleQueued` is the
 * host's own count. The one threshold the console applies is the clock-skew
 * warning, and that is the domain's constant (decision 15), not a literal.
 *
 * Offline and stale are both state 4 and share its place; they have separate
 * keys because they say different things.
 */
import { AOBPRINTER_CLOCK_SKEW_WARN_MS } from '@aobplatform/domain';

/** The states, worst first. `healthy` applies only when nothing above it does; `never_reported` stands alone. */
export const AOBPRINTER_HOST_STATES = [
  'regressed',
  'second_host',
  'local_check_failed',
  'offline',
  'stale',
  'open_exceptions',
  'filed_unconfirmed',
  'old_queue',
  'clock_skew',
  'healthy',
  'never_reported',
] as const;
export type AobPrinterHostState = (typeof AOBPRINTER_HOST_STATES)[number];

/**
 * What a state is decided from. The practice page builds it from a full host
 * row; the overview from its summary row. Strings rather than the contract
 * unions for liveness and status, because a value this build has never met
 * must still be renderable (as its code) rather than a type error.
 */
export interface AobPrinterHostSignal {
  readonly liveness: string;
  readonly chainStatus: string;
  readonly secondHostReporting: boolean;
  readonly localCheckFailed: boolean;
  readonly openExceptions: number;
  readonly filedUnconfirmed: number;
  readonly staleQueued: number;
  /** Host clock minus server clock; null where it is not known. */
  readonly clockSkewMs: number | null;
}

/** Every state that applies, worst first. Never empty. */
export function aobPrinterHostStates(signal: AobPrinterHostSignal): AobPrinterHostState[] {
  if (signal.liveness === 'never_reported') return ['never_reported'];

  const states: AobPrinterHostState[] = [];
  if (signal.chainStatus === 'regressed') states.push('regressed');
  if (signal.secondHostReporting) states.push('second_host');
  if (signal.localCheckFailed) states.push('local_check_failed');
  if (signal.liveness === 'offline') states.push('offline');
  if (signal.liveness === 'stale') states.push('stale');
  if (signal.openExceptions > 0) states.push('open_exceptions');
  if (signal.filedUnconfirmed > 0) states.push('filed_unconfirmed');
  if (signal.staleQueued > 0) states.push('old_queue');
  if (signal.clockSkewMs !== null && Math.abs(signal.clockSkewMs) > AOBPRINTER_CLOCK_SKEW_WARN_MS) {
    states.push('clock_skew');
  }
  return states.length > 0 ? states : ['healthy'];
}

/** The worst state's place in `AOBPRINTER_HOST_STATES` — lower is worse. */
export function aobPrinterHostRank(signal: AobPrinterHostSignal): number {
  return AOBPRINTER_HOST_STATES.indexOf(aobPrinterHostStates(signal)[0]);
}

/** The first 8 characters of a hash — what every screen shows of one (decision 13). */
export function hash8(hash: string): string {
  return hash.slice(0, 8);
}

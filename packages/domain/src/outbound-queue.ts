/**
 * The outbound queue: what leaves the platform, and what happened to it.
 *
 * WHY A QUEUE AT ALL, in the order the reasons actually matter.
 *
 * 1. A NOTICE IS EVIDENCE, AND EVIDENCE MUST NOT EVAPORATE. This is the
 *    reason that would justify a queue even at ten messages a day. If a send
 *    is attempted inline and the provider is down for twenty minutes, the
 *    notices attempted in that window are gone — and what is lost is not a
 *    convenience, it is the record that a statutory notice was issued. The
 *    queue makes the intent DURABLE BEFORE the attempt, so a provider outage
 *    delays evidence instead of destroying it.
 *
 * 2. THE ENQUEUE IS TRANSACTIONAL WITH THE EVIDENCE WRITE. This is the
 *    decisive architectural argument, and it is why the queue lives in
 *    Postgres rather than in Redis or a broker. Writing the Notice row and
 *    enqueuing its dispatch in ONE transaction makes two failures impossible:
 *    a notice with no send, and a send with no notice. Any out-of-process
 *    broker reintroduces both, and then needs an outbox pattern to fix them —
 *    which is this table.
 *
 * 3. RATE LIMITS ARE THE BINDING CONSTRAINT, NOT OUR THROUGHPUT. At the top
 *    end Carl models 750,000 notices a day. Spread over a 10-hour clinical
 *    day that is ~21/second average and perhaps 60–100/second at the peaks
 *    around the end of consultation blocks. Postgres does not care. Email
 *    providers do: SES starts at 14/second, and every provider answers a burst
 *    with 429 rather than more capacity. The queue is what turns "429" into
 *    "sent forty seconds later" instead of "lost".
 *
 * 4. THE KIOSK CANNOT BE PUSHED TO. A tablet on a practice counter has no
 *    address we can reach; it asks. So half the volume needs a PULL model
 *    whatever the throughput, and that is structural rather than a scaling
 *    concern. The same leasing that lets a device claim its work also lets a
 *    retry worker claim a batch without two workers sending twice.
 *
 * 5. BACK-PRESSURE MUST NOT REACH CAPTURE. A patient is standing at a screen
 *    consenting. A slow SMTP handshake must never be on that path.
 *
 * WHAT THIS IS NOT. It is not a second evidence store. `Notice` and
 * `NoticeDeliveryEvent` already hold the delivery chain (composed, dispatched,
 * delivered, read, failed — REQ-DEL-01) and they remain authoritative. This is
 * TRANSPORT: it carries a payload to a destination, records attempts, and
 * tells the evidence layer what happened. Conflating the two would put
 * operational churn — retries, leases, backoff — into an append-only record
 * that has to survive two years.
 */

/**
 * Where a thing is going.
 *
 * `email` and `webhook` are PUSHED — a worker takes them and delivers.
 * `device` is PULLED — a kiosk or tablet asks for its own work. The
 * distinction is not cosmetic: a pushed item fails if we cannot reach the
 * destination, and a pulled item simply waits until somebody comes for it.
 */
export const OUTBOUND_CHANNELS = ['email', 'sms', 'webhook', 'device'] as const;
export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number];

export function isPullChannel(channel: string): boolean {
  return channel === 'device';
}

/**
 * The states, and there are deliberately few.
 *
 * `leased` is not a state a caller sets — it is what a worker or a device does
 * to a pending item to say "mine, briefly". Without it two workers send the
 * same notice twice, which for a statutory notice is not a duplicate email,
 * it is a second assertion that notice was given.
 */
export const OUTBOUND_STATES = ['pending', 'leased', 'sent', 'failed', 'dead'] as const;
export type OutboundState = (typeof OUTBOUND_STATES)[number];

/**
 * How long a worker holds an item before others may reclaim it.
 *
 * Long enough for a slow provider, short enough that a worker killed mid-send
 * does not strand its batch for the rest of the shift. A reclaim after this
 * window may re-send an item whose provider call actually succeeded — which is
 * why the send path carries an idempotency key, and why at-least-once is the
 * honest description of this queue rather than exactly-once.
 */
export const LEASE_SECONDS = 120;

/**
 * A device's lease is longer, because a tablet on a counter may be picked up,
 * carried to a patient, and put down again before it confirms.
 */
export const DEVICE_LEASE_SECONDS = 600;

/** After this many failed attempts an item stops trying and waits for a human. */
export const MAX_ATTEMPTS = 8;

/**
 * Backoff, in seconds, indexed by attempts already made.
 *
 * Roughly doubling, capped at an hour, reaching about six hours in total
 * before it gives up. That covers the ordinary provider outage without
 * hammering a service that is already struggling, and without a notice
 * sitting unsent for a day because the schedule was too patient.
 */
export const BACKOFF_SECONDS = [30, 60, 120, 300, 900, 1800, 3600, 3600] as const;

export function backoffFor(attempts: number): number {
  if (attempts < 0) return BACKOFF_SECONDS[0];
  return BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length - 1)];
}

export class OutboundQueueError extends Error {}

export interface OutboundItemLike {
  state: string;
  attempts: number;
  availableAt?: Date | string | null;
  leaseExpiresAt?: Date | string | null;
  channel: string;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Is this item available to be taken right now?
 *
 * A LEASED ITEM WHOSE LEASE HAS EXPIRED IS AVAILABLE AGAIN. That is the whole
 * mechanism for a worker that died: nothing has to notice the death, detect
 * it, or clean up. The lease simply stops being true.
 */
export function isClaimable(item: OutboundItemLike, now: Date): boolean {
  if (item.state === 'sent' || item.state === 'dead') return false;

  const availableAt = asDate(item.availableAt);
  if (availableAt && availableAt > now) return false;

  if (item.state === 'leased') {
    const expires = asDate(item.leaseExpiresAt);
    // No expiry on a leased item is a bug, not a permanent lease. Treat it as
    // claimable so one bad row cannot strand work for ever.
    return !expires || expires <= now;
  }

  return item.state === 'pending' || item.state === 'failed';
}

/** How long a lease should run for this channel. */
export function leaseSecondsFor(channel: string): number {
  return isPullChannel(channel) ? DEVICE_LEASE_SECONDS : LEASE_SECONDS;
}

export interface FailureOutcome {
  state: OutboundState;
  attempts: number;
  /** When it may next be tried. Null once it is dead. */
  availableAt: Date | null;
  /** True when this attempt exhausted the budget. */
  exhausted: boolean;
}

/**
 * What happens after a failed attempt.
 *
 * DEAD IS NOT DELETED, and nothing here ever removes a row. An item that gave
 * up is the record that we tried eight times over six hours and could not
 * deliver a statutory notice — which is precisely the thing somebody will need
 * to explain later. Deleting it would erase the evidence of our own failure.
 */
export function afterFailure(item: { attempts: number }, now: Date): FailureOutcome {
  const attempts = item.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    return { state: 'dead', attempts, availableAt: null, exhausted: true };
  }
  return {
    state: 'failed',
    attempts,
    availableAt: new Date(now.getTime() + backoffFor(attempts) * 1000),
    exhausted: false,
  };
}

/**
 * A permanent failure — a malformed address, a destination that does not
 * exist. Retrying cannot help, so it does not.
 *
 * Distinguishing this from a transient failure is worth the effort: eight
 * retries against an address with a typo is six hours of pointless load and
 * six hours of delay before a human is told the thing they need to fix.
 */
export function afterPermanentFailure(item: { attempts: number }): FailureOutcome {
  return { state: 'dead', attempts: item.attempts + 1, availableAt: null, exhausted: true };
}

/**
 * A stable key for one logical send, so a retry cannot become a duplicate.
 *
 * Built from what the send IS, never from a timestamp or a random value — the
 * point is that the same logical send produces the same key on a different
 * day, in a different process, after a crash.
 */
export function idempotencyKey(input: {
  practiceId: string;
  channel: string;
  subjectType: string;
  subjectId: string;
  /** Distinguishes a deliberate re-send from a retry of the same one. */
  attemptGroup?: string;
}): string {
  const parts = [input.practiceId, input.channel, input.subjectType, input.subjectId];
  if (input.attemptGroup) parts.push(input.attemptGroup);
  return parts.join(':');
}

/**
 * Sanity limits on what may be queued.
 *
 * A payload cap matters more here than it looks. This table is on the same
 * database as the consent records; a caller queueing a 50 MB attachment would
 * be putting operational bulk into the store that has to stay fast for two
 * years of evidence.
 */
export const MAX_PAYLOAD_BYTES = 256 * 1024;

export function assertQueueable(input: { channel: string; payloadBytes: number; destination?: string | null }): OutboundChannel {
  const channel = OUTBOUND_CHANNELS.find((c) => c === input.channel);
  if (!channel) {
    throw new OutboundQueueError(
      `"${input.channel}" is not an outbound channel. One of: ${OUTBOUND_CHANNELS.join(', ')}.`,
    );
  }
  if (input.payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new OutboundQueueError(
      `That payload is ${Math.round(input.payloadBytes / 1024)}KB, over the ${MAX_PAYLOAD_BYTES / 1024}KB limit. ` +
        'Large content belongs in the artefact store, with a reference queued instead — this table shares a ' +
        'database with the consent records and has to stay fast for two years.',
    );
  }
  /*
   * A PUSHED item needs somewhere to go. A PULLED one does not: a kiosk item
   * is addressed to whichever device at that practice comes for it, and
   * demanding a device id up front would mean knowing which tablet a patient
   * will walk up to.
   */
  if (!isPullChannel(channel) && !input.destination?.trim()) {
    throw new OutboundQueueError(`A ${channel} item needs a destination. Only device items may be unaddressed.`);
  }
  return channel;
}

/**
 * WHY A MESSAGE IS BEING SENT AGAIN.
 *
 * A resend is a second assertion that notice was given. The record already
 * distinguishes it from a retry — a retry is us failing, a resend is somebody
 * deciding — and the only thing that makes the second one accountable is
 * knowing who decided and why.
 *
 * "Optional, and it is what the next person reads" was the old hint, which is
 * two incompatible claims: if the next person reads it, it is not optional.
 *
 * THE LIST OF REASONS IS NOT HERE. It lives in `resend_reasons`, a table,
 * because a catalogue of common answers is DATA — somebody will think of a
 * sixth one, and that should not be a code change, a review and a deploy.
 *
 * What stays here is the RULE, which is not data: how much somebody has to say.
 * The difference matters. A rule that moved into the table could be edited to
 * nothing by whoever was tired of typing.
 */

/**
 * AT LEAST THREE WORDS, and it is not arbitrary.
 *
 * One word is a label — "resent", "again", "requested" — and tells the next
 * person nothing they did not already know from the fact of the resend. Three
 * is the shortest thing that can carry a subject and something about it:
 * "patient rang twice", "bounced, address fixed".
 *
 * A floor, not a target. Enforced on the SERVER as well, because a disabled
 * button is a suggestion.
 */
export const MIN_RESEND_REASON_WORDS = 3;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The note, checked against the rule. The reason KEY is checked by the caller
 * against the table, because only the caller can see it.
 */
export function assertResendNote(note: string): void {
  if (countWords(note) < MIN_RESEND_REASON_WORDS) {
    throw new OutboundQueueError(
      `Say a little more about why — at least ${MIN_RESEND_REASON_WORDS} words. A resend is a second time ` +
        'we assert that notice was given, and the next person reading this record needs to know what ' +
        'happened rather than merely that it happened.',
    );
  }
}

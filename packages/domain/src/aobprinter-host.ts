/**
 * THE AOBPRINTER HOST, AS THE PLATFORM JUDGES IT (PRINTER-HEARTBEAT.md §3,
 * D-2026-10-10-02).
 *
 * Every minute the host at a practice reports the head of its local audit
 * chain and, when asked, the hash it holds at the seq the platform named last
 * time (the anchor). Two questions are decided here, once, so the server and
 * the console cannot disagree:
 *
 *  - is the chain still the chain the platform last saw (`aobPrinterChainVerdict`);
 *  - is the host still there (`aobPrinterHostLiveness`).
 *
 * PURE. No clock unless one is passed, no I/O, no ids beyond the chain's own
 * hash. The server runs the verdict inside the transaction that holds the row
 * `FOR UPDATE`, and writes whatever vault event the verdict implies through
 * the outbox in that same transaction (hard rule 11).
 *
 * THE VOCABULARY LIVES HERE, NOT IN CONTRACTS. `@aobplatform/contracts`
 * depends on this package and not the other way round, so the lists the
 * verdict answers in are declared once here and the contract re-exports their
 * types — the same arrangement as the signature stroke types. The migration's
 * CHECKs copy these lists (wow.md §2 item 7).
 */

/** The three states a host's chain can be in, as the platform has judged it. */
export const AOBPRINTER_CHAIN_STATUSES = ['unverified', 'consistent', 'regressed'] as const;
/** `unverified`, `consistent` or `regressed`. */
export type AobPrinterChainStatus = (typeof AOBPRINTER_CHAIN_STATUSES)[number];

/**
 * WHY A CHAIN IS `regressed`. One of four, and the console shows one string
 * per kind (an unmapped kind shows its code).
 *
 *  - `went_backwards` — the head is behind the head or the anchor already seen.
 *  - `same_seq_different_hash` — the head seq is the one already seen, with another hash.
 *  - `anchor_mismatch` — the hash at the anchor is not the one recorded, or is gone.
 *  - `chain_replaced` — a chain the platform has never seen, at a practice that
 *    already has one that is not retired (decision 6).
 */
export const AOBPRINTER_CHAIN_REGRESSIONS = [
  'went_backwards',
  'same_seq_different_hash',
  'anchor_mismatch',
  'chain_replaced',
] as const;
/** One of the four regression kinds. */
export type AobPrinterChainRegression = (typeof AOBPRINTER_CHAIN_REGRESSIONS)[number];

/** A position in a host's audit chain: a seq and the hash stored there (null where there is none). */
export interface AobPrinterChainPoint {
  readonly seq: number;
  readonly hash: string | null;
}

/** What the platform already holds for one chain — the columns the verdict reads. */
export interface AobPrinterHostChainRow {
  readonly chainId: string;
  readonly headSeq: number;
  readonly headHash: string | null;
  readonly anchorSeq: number;
  readonly anchorHash: string | null;
  readonly chainStatus: AobPrinterChainStatus;
}

/**
 * Another chain the same practice has reported, for rule 1.
 *
 * `retiredAt` is what rule 1 reads. A chain is retired when a platform
 * operator re-baselines a `chain_replaced` row: that accepts the NEW chain as
 * the practice's chain, so every other chain stops being one a newcomer could
 * be replacing.
 *
 * `rebaselinedAt` is carried so the distinction stays visible, and rule 1
 * deliberately ignores it. Re-baselining accepts a chain's CURRENT HEAD; it
 * does not retire the chain. A re-baselined chain that is still the
 * practice's chain is exactly what a later rewrite would replace (decision 6,
 * D-2026-10-10-02 amendment).
 */
export interface AobPrinterOtherChain {
  readonly chainId: string;
  readonly rebaselinedAt: Date | string | null;
  readonly retiredAt: Date | string | null;
}

/** The chain part of a heartbeat. A full `AobPrinterHeartbeat` (contracts) satisfies it. */
export interface AobPrinterBeatChain {
  /** The hash of audit event seq 1. */
  readonly chainId: string;
  readonly head: AobPrinterChainPoint;
  /** The host's answer at the seq the platform named last time. Absent after a restart. */
  readonly atAnchor?: AobPrinterChainPoint;
}

/** A regression found by THIS beat: what the platform expected, and what the host sent. */
export interface AobPrinterChainRegressionFinding {
  readonly kind: AobPrinterChainRegression;
  readonly expected: AobPrinterChainPoint;
  readonly received: AobPrinterChainPoint;
}

/** The platform's answer to one beat: status, head, anchor, and any regression this beat found. */
export interface AobPrinterChainVerdict {
  readonly status: AobPrinterChainStatus;
  /** Always the head the host reported: the head is updated even on a regressed row. */
  readonly head: AobPrinterChainPoint;
  /** Where the anchor is now. It moves only on `consistent` (rule 7) or a first beat (rule 1). */
  readonly anchor: AobPrinterChainPoint;
  /** True only when this beat answered the anchor correctly — the server stamps `anchorVerifiedAt`. */
  readonly anchorVerified: boolean;
  /**
   * Set only on the TRANSITION into `regressed` — the one beat that writes
   * `aobprinter.chain_regressed` (decision 4). Null on a row that was already
   * regressed, so the event cannot be written twice.
   */
  readonly newRegression: AobPrinterChainRegressionFinding | null;
}

/**
 * THE SEVEN RULES, IN ORDER (PRINTER-HEARTBEAT.md §3). The first that applies
 * answers.
 *
 * 1. No row for this chain: `chain_replaced` if the practice has any other
 *    chain that is not retired (re-baselined or not); otherwise `unverified`,
 *    anchor at the head.
 * 2. Already `regressed`: stays regressed. Head updated, anchor not moved.
 * 3. Head behind the stored head or the anchor: `went_backwards`.
 * 4. Same seq as the stored head, different hash: `same_seq_different_hash`.
 * 5. The answer at the anchor has a different hash, or none: `anchor_mismatch`.
 * 6. No answer at the anchor, or one for another seq (the host restarted):
 *    status unchanged — which for a row that was never verified is `unverified`.
 * 7. Otherwise `consistent`, and the anchor moves to the head.
 *
 * `otherChains` may include the row for this chain; it is ignored.
 */
export function aobPrinterChainVerdict(
  existing: AobPrinterHostChainRow | null,
  otherChains: readonly AobPrinterOtherChain[],
  beat: AobPrinterBeatChain,
): AobPrinterChainVerdict {
  const head: AobPrinterChainPoint = { seq: beat.head.seq, hash: beat.head.hash };

  // Rule 1.
  if (!existing) {
    // Every other chain that is not RETIRED, re-baselined or not (see `AobPrinterOtherChain`).
    const previous = otherChains.find((c) => c.chainId !== beat.chainId && !c.retiredAt);
    if (previous) {
      /*
       * The chain id IS the hash of seq 1, so a replaced chain is "seq 1 with
       * a different hash" and names the previous chain in the same terms as
       * every other regression.
       */
      return {
        status: 'regressed',
        head,
        anchor: head,
        anchorVerified: false,
        newRegression: {
          kind: 'chain_replaced',
          expected: { seq: 1, hash: previous.chainId },
          received: { seq: 1, hash: beat.chainId },
        },
      };
    }
    return { status: 'unverified', head, anchor: head, anchorVerified: false, newRegression: null };
  }

  const anchor: AobPrinterChainPoint = { seq: existing.anchorSeq, hash: existing.anchorHash };
  const storedHead: AobPrinterChainPoint = { seq: existing.headSeq, hash: existing.headHash };
  const regressed = (kind: AobPrinterChainRegression, expected: AobPrinterChainPoint, received: AobPrinterChainPoint) =>
    ({ status: 'regressed', head, anchor, anchorVerified: false, newRegression: { kind, expected, received } }) as const;

  // Rule 2.
  if (existing.chainStatus === 'regressed') {
    return { status: 'regressed', head, anchor, anchorVerified: false, newRegression: null };
  }

  // Rule 3.
  if (head.seq < existing.headSeq) return regressed('went_backwards', storedHead, head);
  if (head.seq < existing.anchorSeq) return regressed('went_backwards', anchor, head);

  // Rule 4.
  if (head.seq === existing.headSeq && head.hash !== existing.headHash) {
    return regressed('same_seq_different_hash', storedHead, head);
  }

  const answer = beat.atAnchor;
  // Rule 5.
  if (answer && answer.seq === existing.anchorSeq && (answer.hash === null || answer.hash !== existing.anchorHash)) {
    return regressed('anchor_mismatch', anchor, { seq: answer.seq, hash: answer.hash });
  }

  // Rule 6.
  if (!answer || answer.seq !== existing.anchorSeq) {
    return { status: existing.chainStatus, head, anchor, anchorVerified: false, newRegression: null };
  }

  // Rule 7.
  return { status: 'consistent', head, anchor: head, anchorVerified: true, newRegression: null };
}

/**
 * WHETHER THE HOST IS STILL THERE. `never_reported` is neutral, not an
 * outage: a practice that has not installed AOBPRINTER yet has nothing to be
 * offline from.
 */
export const AOBPRINTER_HOST_LIVENESS = ['live', 'stale', 'offline', 'never_reported'] as const;
/** `live`, `stale`, `offline` or `never_reported`. */
export type AobPrinterHostLiveness = (typeof AOBPRINTER_HOST_LIVENESS)[number];

/**
 * STALE AFTER THREE MISSED BEATS, at the interval the host itself reported
 * (D-2026-10-10-02, decision 2). Three rather than the tablet's two: the host
 * is on a practice's own link, often beside the server, and one slow minute
 * there is ordinary.
 */
export const AOBPRINTER_STALE_AFTER_BEATS = 3;

/**
 * OFFLINE AFTER FIFTEEN MINUTES whatever the interval (D-2026-10-10-02,
 * decision 2). The host is meant to be always on, so offline overnight is a
 * real finding. Also the window `secondHostReporting` uses (decision 6) and
 * the one the five-minute sweep alerts on (decision 3).
 */
export const AOBPRINTER_OFFLINE_AFTER_MS = 15 * 60 * 1000;

/** The console warns when the host's clock is more than this far out (D-2026-10-10-02, decision 15). */
export const AOBPRINTER_CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;

/** `aobprinter.chain_anchored` reaches the vault at most this often (D-2026-10-10-02, decision 5). */
export const AOBPRINTER_VAULT_ANCHOR_MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Decided by the server, rendered by the console (decision 2). Offline is
 * asked first, so a host on a ten-minute interval is offline at fifteen even
 * though three beats would be thirty. An interval that is not a positive
 * number cannot make a host stale; only the offline rule applies.
 */
export function aobPrinterHostLiveness(
  lastSeenAt: Date | string | null | undefined,
  intervalMs: number,
  now: Date = new Date(),
): AobPrinterHostLiveness {
  if (!lastSeenAt) return 'never_reported';
  const at = typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : lastSeenAt.getTime();
  if (Number.isNaN(at)) return 'never_reported';
  const silentFor = now.getTime() - at;
  if (silentFor > AOBPRINTER_OFFLINE_AFTER_MS) return 'offline';
  if (Number.isFinite(intervalMs) && intervalMs > 0 && silentFor > AOBPRINTER_STALE_AFTER_BEATS * intervalMs) {
    return 'stale';
  }
  return 'live';
}

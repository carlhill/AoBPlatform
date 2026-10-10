/**
 * THE AOBPRINTER HEARTBEAT (PRINTER-HEARTBEAT.md §1, D-2026-10-10-02).
 *
 * Every minute the host at a practice posts `AobPrinterHeartbeat` to
 * `POST /inbound/print-jobs/heartbeat` and reads back
 * `AobPrinterHeartbeatReply`. The console reads `AobPrinterHostsView`.
 *
 * COUNTS, HASHES, IDS, CODES AND VERSIONS. Every field is named, nothing is
 * spread, and there is no free text: never a form reference, a chart number,
 * a path, a name or a note (hard rule 9, REQ-LOG-08). A reason is a code, and
 * the console shows the code where it has no words for it.
 *
 * THE CHAIN VOCABULARY IS DOMAIN'S. The verdict that answers in it lives in
 * `@aobplatform/domain` (`aobprinter-host.ts`), which this package depends
 * on, so the status, regression and liveness lists are declared there once
 * and only their types are re-exported here — the same arrangement as the
 * signature stroke types in `signature.ts`.
 */
import type {
  AobPrinterChainPoint,
  AobPrinterChainRegression,
  AobPrinterChainStatus,
  AobPrinterHostLiveness,
} from '@aobplatform/domain';
import type { Db4PlacementReason } from './print-capture';

export type {
  AobPrinterChainPoint,
  AobPrinterChainRegression,
  AobPrinterChainStatus,
  AobPrinterHostLiveness,
} from '@aobplatform/domain';

/* ---------------------------------------------------------------------------
 * The host's own stages (D-2026-09-29-01). Its SQLite CHECKs copy these.
 * ------------------------------------------------------------------------ */

/** The stages a print passes through on the host. */
export const AOBPRINTER_PRINT_STAGES = ['received', 'parse_exception', 'queued', 'sent', 'send_exception'] as const;
/** One of `AOBPRINTER_PRINT_STAGES`. */
export type AobPrinterPrintStage = (typeof AOBPRINTER_PRINT_STAGES)[number];

/** The stages a Signed-DB4 return passes through on the host. */
export const AOBPRINTER_RETURN_STAGES = [
  'received',
  'received_exception',
  'filed',
  'filing_exception',
  'confirmed',
] as const;
/** One of `AOBPRINTER_RETURN_STAGES`. */
export type AobPrinterReturnStage = (typeof AOBPRINTER_RETURN_STAGES)[number];

/** The four stages an open exception can be in — two per direction. */
export const AOBPRINTER_EXCEPTION_STAGES = [
  'parse_exception',
  'send_exception',
  'received_exception',
  'filing_exception',
] as const;
/** One of `AOBPRINTER_EXCEPTION_STAGES`. */
export type AobPrinterExceptionStage = (typeof AOBPRINTER_EXCEPTION_STAGES)[number];

/* ---------------------------------------------------------------------------
 * Agreed bounds. Both sides read these; neither writes its own literal.
 * ------------------------------------------------------------------------ */

/**
 * HOW OFTEN THE HOST BEATS (D-2026-10-10-02, decision 1). Every 60 s by
 * default; configurable from 15 s to 10 min, and outside that the program
 * refuses to start. The first beat goes 5 s after start.
 */
export const AOBPRINTER_HEARTBEAT_INTERVAL = {
  defaultMs: 60_000,
  minMs: 15_000,
  maxMs: 600_000,
  firstDelayMs: 5_000,
} as const;

/**
 * HOW MUCH ONE BEAT MAY CARRY (D-2026-10-10-02, decision 9; §1). Prints sent
 * in the last 14 days with no platform outcome, at most 100; returns in
 * `filed`, at most 100; open exceptions oldest first, at most 25. The DTO
 * caps its arrays at the same numbers.
 */
export const AOBPRINTER_HEARTBEAT_LIMITS = {
  openExceptions: 25,
  awaitingOutcome: 100,
  filedUnconfirmed: 100,
  sentWindowDays: 14,
} as const;

/* ---------------------------------------------------------------------------
 * Host → platform.
 * ------------------------------------------------------------------------ */

/** How many prints and returns are at each stage on the host, and how old the oldest waiting ones are. */
export interface AobPrinterStageCounts {
  readonly prints: Readonly<Record<AobPrinterPrintStage, number>>;
  readonly returns: Readonly<Record<AobPrinterReturnStage, number>>;
  readonly openExceptions: {
    readonly parse: number;
    readonly send: number;
    readonly received: number;
    readonly filing: number;
  };
  readonly oldestQueuedAt: string | null;
  readonly oldestFiledUnconfirmedAt: string | null;
  readonly staleQueued: number;
  readonly gapsLast24h: number;
}

/** Ids and codes only. Never a form reference, chart number, path or note. */
export interface AobPrinterOpenException {
  readonly direction: 'out' | 'in';
  readonly stage: AobPrinterExceptionStage;
  /** A code; shown as the code if unmapped. */
  readonly reason: string;
  readonly since: string;
  /** Present on `out`: the print's hash. No platform page shows a print job (decision 13). */
  readonly sourceSha256?: string;
  /** Present on `in`: the agreement the return belongs to. */
  readonly agreementId?: string;
}

/**
 * THE HOST'S OWN CHECK OF ITS CHAIN (decision 14). Verified forward in chunks
 * from a frontier held in memory; a failure names the seq and whether the link
 * or the content broke.
 */
export type AobPrinterLocalCheck =
  | { readonly ok: true; readonly verifiedThroughSeq: number }
  | { readonly ok: false; readonly brokenAtSeq: number; readonly why: 'link' | 'content' };

/** A return the host has filed and not yet seen confirmed (decision 9). */
export interface AobPrinterFiledReturn {
  readonly agreementId: string;
  readonly sha256: string;
}

/** What the host posts every beat. */
export interface AobPrinterHeartbeat {
  /** The hash of audit event seq 1. */
  readonly chainId: string;
  readonly head: AobPrinterChainPoint;
  /** The hash at the seq the platform named last time. Absent until asked, and after a restart. */
  readonly atAnchor?: AobPrinterChainPoint;
  readonly localCheck: AobPrinterLocalCheck;
  readonly counts: AobPrinterStageCounts;
  /** Oldest first, at most `AOBPRINTER_HEARTBEAT_LIMITS.openExceptions`. */
  readonly openExceptions: readonly AobPrinterOpenException[];
  readonly printerVersion: string;
  readonly templateVersion: string;
  readonly schemaVersion: number;
  /** `process.version` on the host. */
  readonly runtimeVersion: string;
  readonly startedAt: string;
  /** The host's clock when it sent this, for skew (decision 15). */
  readonly sentAt: string;
  readonly intervalMs: number;
  readonly queueCount: number;
  readonly collecting: boolean;
  readonly retentionEnabled: boolean;
  /** Source hashes of prints in `sent` with no platform outcome (decision 9). */
  readonly awaitingOutcome: readonly string[];
  readonly filedUnconfirmed: readonly AobPrinterFiledReturn[];
}

/* ---------------------------------------------------------------------------
 * Platform → host.
 * ------------------------------------------------------------------------ */

/** What the platform knows of a print job the host asked about. `unknown`: the platform never had it. */
export type AobPrinterJobState = 'waiting' | 'done' | 'dead' | 'unknown';

/** The platform's answer for one print in `awaitingOutcome`. */
export interface AobPrinterJobOutcome {
  readonly sourceSha256: string;
  readonly state: AobPrinterJobState;
  readonly placed: boolean | null;
  readonly reason: Db4PlacementReason | null;
  readonly agreementId: string | null;
}

/** The platform's answer for one return in `filedUnconfirmed`. */
export interface AobPrinterReturnOutcome {
  readonly agreementId: string;
  readonly writtenBack: boolean;
  readonly sha256Matches: boolean;
  /** Still offered for collection. */
  readonly listed: boolean;
}

/** What the platform answers every beat. `anchorSeq` is the seq to answer at next time. */
export interface AobPrinterHeartbeatReply {
  readonly receivedAt: string;
  readonly chain: { readonly status: AobPrinterChainStatus; readonly anchorSeq: number };
  readonly jobs: readonly AobPrinterJobOutcome[];
  readonly returns: readonly AobPrinterReturnOutcome[];
}

/* ---------------------------------------------------------------------------
 * The console (§1 "Console types", §4).
 * ------------------------------------------------------------------------ */

/** A regression as stored on the row: the finding, and when it was made. */
export interface AobPrinterChainRegressionView {
  readonly kind: AobPrinterChainRegression;
  readonly at: string;
  readonly expected: AobPrinterChainPoint;
  readonly received: AobPrinterChainPoint;
}

/** An open exception as the console shows it. Returns carry their patient, resolved on the server. */
export interface AobPrinterHostException extends AobPrinterOpenException {
  readonly patientId?: string;
}

/**
 * WHAT THE PLATFORM SAYS ABOUT A RETURN FILED BUT NOT RECORDED AS CONFIRMED
 * (§4 state 6):
 *  - `written_back` — recorded, and the file the host filed is the one the
 *    platform wrote back; reconciles on the next report;
 *  - `written_back_different_file` — recorded, but the platform's file has a
 *    different hash from the one the host filed. The host keeps such a return
 *    filed (it never confirms a file it does not hold), so it never reconciles;
 *  - `offered` — not recorded, still offered for collection;
 *  - `not_offered` — not recorded and no longer offered.
 */
export type AobPrinterFiledUnconfirmedVerdict = 'written_back' | 'written_back_different_file' | 'offered' | 'not_offered';

/** A filed return with the platform's verdict and its patient. */
export interface AobPrinterFiledUnconfirmedRow extends AobPrinterFiledReturn {
  readonly verdict: AobPrinterFiledUnconfirmedVerdict;
  readonly patientId: string | null;
}

/** The chain as the console shows it. */
export interface AobPrinterHostChainView {
  readonly status: AobPrinterChainStatus;
  readonly regression: AobPrinterChainRegressionView | null;
  readonly anchorSeq: number;
  readonly anchorVerifiedAt: string | null;
}

/** One host as the console shows it: the stored fields plus what the server computed. */
export interface AobPrinterHostRow {
  /** The row's id — the `:hostId` of the re-baseline route. */
  readonly id: string;
  readonly practiceId: string;
  readonly chainId: string;
  readonly lastSeenAt: string;
  readonly hostSentAt: string;
  readonly intervalMs: number;
  readonly printerVersion: string;
  readonly templateVersion: string;
  readonly schemaVersion: number;
  readonly runtimeVersion: string;
  readonly startedAt: string;
  readonly collecting: boolean;
  readonly retentionEnabled: boolean;
  readonly queueCount: number;
  readonly counts: AobPrinterStageCounts;
  readonly localCheck: AobPrinterLocalCheck;
  readonly head: AobPrinterChainPoint;
  readonly headAdvancedAt: string | null;
  readonly vaultAnchoredAt: string | null;
  readonly rebaselinedAt: string | null;
  /** A principal id, never a name. */
  readonly rebaselinedBy: string | null;
  /** Decided by the server (decision 2). */
  readonly liveness: AobPrinterHostLiveness;
  readonly chain: AobPrinterHostChainView;
  /** Host clock minus server clock at the last beat. */
  readonly clockSkewMs: number;
  readonly exceptions: readonly AobPrinterHostException[];
  readonly filedUnconfirmed: readonly AobPrinterFiledUnconfirmedRow[];
}

/** `GET /aobprinter-hosts`. `secondHostReporting`: two chains seen within the offline window (decision 6). */
export interface AobPrinterHostsView {
  readonly hosts: readonly AobPrinterHostRow[];
  readonly secondHostReporting: boolean;
}

/**
 * ONE ROW OF `GET /platform/aobprinter-hosts` — one host, as the platform's
 * overview lists it, worst first (§4, decision 10). Counts, versions, times
 * and status, plus the practice so the row can open that practice's twin.
 * Never an agreement id, a print hash or a patient. Liveness and status are
 * strings so a value a console build has not met renders as its code.
 */
export interface AobPrinterHostOverviewRow {
  readonly practiceId: string;
  readonly practiceName: string | null;
  readonly liveness: string;
  readonly chainStatus: string;
  readonly regressionKind: string | null;
  readonly localCheckOk: boolean;
  readonly secondHostReporting: boolean;
  readonly lastSeenAt: string | null;
  readonly printerVersion: string | null;
  readonly openExceptions: number;
  readonly filedUnconfirmed: number;
  readonly staleQueued: number;
  readonly clockSkewMs: number | null;
}

/** `GET /platform/aobprinter-hosts`. */
export interface AobPrinterHostsOverview {
  readonly hosts: readonly AobPrinterHostOverviewRow[];
}

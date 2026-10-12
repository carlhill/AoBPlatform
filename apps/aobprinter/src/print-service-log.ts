/**
 * The reconciliation alarm: a form that was printed but never became a record
 * must not vanish quietly.
 *
 * WHAT THE REST OF THIS PROGRAM ALREADY GUARANTEES, AND WHERE IT STOPS. The
 * outbox never loses a form once it has been CLAIMED: it is on disk before
 * the first attempt, it survives a restart, and it is never discarded
 * (`outbox.ts`). None of that says anything about a form that was never
 * claimed at all — the spooler wrote it to a queue nobody was watching, or
 * wrote it twice into the same one-slot port within the settle window, or the
 * watcher was stopped for ten minutes while the practice kept printing. In
 * every one of those cases the practice believes a form was captured and this
 * program has never heard of it. That is the exact failure LAN mode makes
 * more likely, because there are now several queues and only one process
 * watching them.
 *
 * SO WE ASK WINDOWS. The print spooler already counts what it printed:
 * `Microsoft-Windows-PrintService/Operational` event 307, one per completed
 * job, carrying the printer it went to. Comparing the spooler's count per
 * queue against ours over the same window turns "a form went nowhere" from
 * something nobody discovers into a line in the log.
 *
 * WHAT IS READ FROM THE EVENT, AND WHAT IS DELIBERATELY NOT. Event 307's
 * properties include the DOCUMENT NAME, which for a DB4 printed out of
 * PracSoft can carry a patient's name or chart number. This reads property
 * index 4 — the printer name — and the count. Never `.Message` (which
 * contains the document name in prose), never property 1, never the user or
 * the machine. The same discipline `log.ts` applies to what we write, applied
 * to what we read: not handing ourselves the data is the first line, and
 * `redact` is only the second (hard rule 9).
 *
 * IT FAILS CLOSED AND QUIET. No PowerShell (this suite runs on Linux CI), the
 * log disabled, a query that throws, output that does not parse — every one
 * of those returns null, warns ONCE, and the program carries on capturing
 * forms exactly as before. Nothing in this file may slow or block printing,
 * and an alarm that could stop the watcher would be worse than no alarm at
 * all (hard rule 8).
 *
 * IT IS AN ALARM, NOT A LEDGER. The claimed counts live in memory and the
 * window resets on restart, so a gap that straddles a restart is not
 * reported. That is an accepted limitation of a secondary check — the system
 * of record is the outbox and its receipts, and this exists to catch what
 * never reached them.
 */
import { execFile } from 'node:child_process';
import { redactError, type Logger } from './log';

export const PRINT_SERVICE_LOG = 'Microsoft-Windows-PrintService/Operational';
/** "Document printed" — one per completed job. */
export const PRINTED_EVENT_ID = 307;

/**
 * Counts per printer name over a window, or null when the question could not
 * be asked at all. Null is not "nothing printed": the two must never be
 * confused, because "nothing printed" is a comparison and "could not ask" is
 * a degraded mode.
 *
 * Injected the way `keystore.ts` injects its `KeyWrapper`, so a test never
 * spawns PowerShell and CI never needs Windows.
 */
export type EventCountReader = (
  queueNames: readonly string[],
  sinceIso: string,
  untilIso: string,
) => Promise<Map<string, number> | null>;

/** ISO instants are the only thing interpolated into the script; validated anyway, because a script built from a string is a script built from a string. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Long enough for a busy log, short enough that it can never be mistaken for a hang. */
const QUERY_TIMEOUT_MS = 15_000;

/**
 * The real reader: `Get-WinEvent` over the Print Service operational log.
 *
 * WHY THE FILTER IS A HASHTABLE AND NOT `Where-Object`. `-FilterHashtable`
 * filters inside the event-log service, so a busy log is not paged into
 * PowerShell and discarded — it is the difference between a query that costs
 * nothing and one that costs a second of a receptionist's CPU every cycle.
 *
 * WHY THE PRINTER NAMES ARE NOT PASSED IN TO THE SCRIPT. The script returns
 * counts for every printer in the window and Node filters to the configured
 * queues. That keeps practice-chosen strings out of a generated script
 * entirely, and it means a queue name with a quote or a bracket in it cannot
 * change what the script does.
 *
 * "NO EVENTS FOUND" IS NOT AN ERROR. `Get-WinEvent` raises a terminating
 * error when a filter matches nothing, which is the ordinary case at three in
 * the morning. That one is swallowed; a missing or DISABLED log is not — it
 * is thrown deliberately so the caller degrades loudly instead of quietly
 * reporting that nothing was ever printed.
 */
/**
 * ASYNCHRONOUS, AND THAT IS NOT A STYLE CHOICE.
 *
 * This was `spawnSync` and it ran on the same single-threaded event loop that
 * claims spool files. Node stops dead for the whole call -- one to three
 * seconds of PowerShell start-up, up to the fifteen-second timeout on a busy
 * log -- and the port is ONE FILE. A form printed inside that stall has nothing
 * running to claim it, and the next job overwrites it. A reporting feature
 * would have destroyed the evidence it exists to account for (hard rule 8).
 */
export function powershellEventCountReader(): EventCountReader {
  return async (queueNames, sinceIso, untilIso) => {
    if (process.platform !== 'win32') return null;
    if (!ISO_INSTANT.test(sinceIso) || !ISO_INSTANT.test(untilIso)) return null;

    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$log = Get-WinEvent -ListLog '${PRINT_SERVICE_LOG}'`,
      `if (-not $log.IsEnabled) { throw 'the ${PRINT_SERVICE_LOG} log is disabled' }`,
      `$filter = @{ LogName = '${PRINT_SERVICE_LOG}'; Id = ${PRINTED_EVENT_ID}; ` +
        `StartTime = [datetime]::Parse('${sinceIso}').ToLocalTime(); ` +
        `EndTime = [datetime]::Parse('${untilIso}').ToLocalTime() }`,
      '$events = @(Get-WinEvent -FilterHashtable $filter -ErrorAction SilentlyContinue)',
      '$counts = @{}',
      // Property 4 of event 307 is the printer name. Property 1 is the
      // DOCUMENT NAME and is never touched — see this file's header.
      'foreach ($e in $events) { $n = [string]$e.Properties[4].Value; if ($n) { $counts[$n] = 1 + $counts[$n] } }',
      '@($counts.GetEnumerator() | ForEach-Object { [pscustomobject]@{ Name = $_.Key; Count = $_.Value } }) | ConvertTo-Json -Compress -Depth 2',
    ].join('; ');

    const out = await new Promise<string | null>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', windowsHide: true, timeout: QUERY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : (stdout ?? '').trim()),
      );
    });

    if (out === null) return null;
    if (out.length === 0) return new Map();

    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      return null;
    }

    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const wanted = new Set(queueNames);
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const doc = row as Record<string, unknown>;
      if (typeof doc.Name !== 'string' || typeof doc.Count !== 'number') continue;
      // Only the queues this install is configured for. A printer nobody
      // asked about is not this program's business to count or to log.
      if (!wanted.has(doc.Name)) continue;
      counts.set(doc.Name, doc.Count);
    }
    return counts;
  };
}

/**
 * How far back from "now" a window is allowed to end.
 *
 * A form is printed and claimed about a second later (`settleMs` defaults to
 * 750ms). Ending the window at this instant would count a print whose claim
 * has not happened yet as a gap, and an alarm that cries wolf is an alarm
 * that gets ignored. Sixty seconds is roughly eighty times the settle time —
 * far enough that only a claim that is genuinely not coming falls outside it.
 */
const DEFAULT_GRACE_MS = 60_000;

/** Every quarter hour. Frequent enough that a gap is same-session news, rare enough to be invisible on a desktop. */
export const DEFAULT_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

export interface ReconcileSummary {
  /** False when the window was too young to check, or the log could not be read. */
  readonly checked: boolean;
  /** Queues whose spooler count exceeded ours. */
  readonly gaps: number;
  /** Configured queues the spooler has no jobs for although we claimed from them — a name that matches no printer. */
  readonly unknownQueues: number;
}

/** One "printed but never received" finding, as the audit trail records it (D-2026-09-29-01). */
export interface ReconcileGap {
  readonly queue: string;
  readonly printed: number;
  readonly claimed: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

/** A claim, with when it happened, so it is counted against the window it belongs to and not the next one. */
interface ClaimMark {
  readonly queueName: string;
  readonly at: number;
}

export class Reconciler {
  private readonly claims: ClaimMark[] = [];
  private windowStartedAt: number;
  /**
   * Warn once, not once per cycle. A desktop where the Print Service log is
   * off (the Windows default, which the installer turns on) would otherwise
   * write a warning every fifteen minutes forever, and a log full of the same
   * line is a log nobody reads. Cleared on the first successful read, so a
   * log that is switched back off later says so again.
   */
  private warnedUnavailable = false;

  constructor(
    private readonly read: EventCountReader,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly graceMs: number = DEFAULT_GRACE_MS,
    /**
     * Where a gap is written down beyond the log. THE ONE GAP THAT CAN HAPPEN
     * BEFORE A PRINT HAS A ROW, so without this the audit trail could not
     * claim to have none. Called inside a try: an alarm that cannot be
     * recorded is still logged, and never stops the loop that captures.
     */
    private readonly onGap: (gap: ReconcileGap) => void = () => undefined,
  ) {
    this.windowStartedAt = this.now().getTime();
  }

  /** One claimed job. Called from the loop as each queue yields a file. */
  recordClaim(queueName: string): void {
    this.claims.push({ queueName, at: this.now().getTime() });
  }

  /**
   * Compare the window and alarm on a gap.
   *
   * NEVER THROWS. The injected reader is meant to fail closed on its own, but
   * "meant to" is not a guarantee about a reader somebody writes later, and
   * this is called from the same loop that claims forms (hard rule 8).
   *
   * THE WINDOW IS ONLY ADVANCED ON A SUCCESSFUL READ. If the log could not be
   * read, the window stays open and the next successful check covers the
   * whole period — a gap during an outage of the event log is late, not lost.
   */
  async reconcile(queueNames: readonly string[]): Promise<ReconcileSummary> {
    const windowEnd = this.now().getTime() - this.graceMs;
    if (windowEnd <= this.windowStartedAt) return { checked: false, gaps: 0, unknownQueues: 0 };

    let counts: Map<string, number> | null;
    try {
      counts = await this.read(queueNames, new Date(this.windowStartedAt).toISOString(), new Date(windowEnd).toISOString());
    } catch (err) {
      this.warnOnce('reconcile.unavailable', {
        error: redactError(err),
        note: 'the print service log could not be read; reconciliation is degraded and capture is unaffected',
      });
      return { checked: false, gaps: 0, unknownQueues: 0 };
    }

    if (counts === null) {
      this.warnOnce('reconcile.unavailable', {
        note: 'the print service log is disabled, absent or unreadable on this desktop; reconciliation is degraded and capture is unaffected',
      });
      return { checked: false, gaps: 0, unknownQueues: 0 };
    }
    this.warnedUnavailable = false;

    let gaps = 0;
    let unknownQueues = 0;
    for (const queueName of queueNames) {
      /*
       * A QUEUE THE SPOOLER HAS NEVER HEARD OF IS AN UNKNOWN, NOT A ZERO.
       *
       * `counts.get(name) ?? 0` made a misconfigured queue permanently silent:
       * printed 0 can never exceed claimed, so the alarm reported "checked, no
       * gaps" forever. Every config written before today synthesises the queue
       * name 'default' (config.ts LEGACY_QUEUE_NAME) and no Windows printer is
       * called that, so on every already-installed desktop this guard rail was
       * off while saying it was on. A typo in a LAN queue name did the same.
       *
       * Distinguishing the two needs a claim to compare against: if this
       * program has claimed forms from a queue and the spooler reports no
       * events for it at all, the name does not match a real printer. A queue
       * that is genuinely quiet has no claims either, and says nothing.
       */
      const printed = counts.get(queueName);
      const claimedAll = this.claims.filter((c) => c.queueName === queueName).length;
      if (printed === undefined) {
        if (claimedAll > 0) {
          unknownQueues += 1;
          this.logger.error('reconcile.queue_unknown_to_spooler', {
            queue: queueName,
            claimed: claimedAll,
            note:
              'forms were claimed from this queue but the print service log reports no jobs for that printer name; ' +
              'the configured queue name does not match an installed printer, so a printed form that was never ' +
              'captured cannot be detected here. Check the queue name in aobprinter.config.json.',
          });
        }
        continue;
      }

      const claimed = this.claims.filter((c) => c.queueName === queueName && c.at < windowEnd).length;
      if (printed <= claimed) continue;

      gaps += 1;
      /*
       * ERROR, NOT WARN. This is the one line that says a patient's form was
       * printed and this program never saw it — somebody has to go and look
       * at the queue. It names the queue and both counts and nothing else: a
       * document name would be the very PII this whole file avoids reading.
       */
      this.logger.error('reconcile.gap', {
        queue: queueName,
        printed,
        claimed,
        missing: printed - claimed,
        windowStart: new Date(this.windowStartedAt).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
        note: 'the spooler printed more jobs on this queue than AOBPRINTER claimed; a printed form was not captured',
      });
      try {
        this.onGap({
          queue: queueName,
          printed,
          claimed,
          windowStart: new Date(this.windowStartedAt).toISOString(),
          windowEnd: new Date(windowEnd).toISOString(),
        });
      } catch (err) {
        this.logger.error('reconcile.gap_not_recorded', { queue: queueName, error: redactError(err) });
      }
    }

    // Everything up to the window's end has now been accounted for; anything
    // claimed since belongs to the next window.
    let kept = 0;
    for (const claim of this.claims) {
      if (claim.at >= windowEnd) this.claims[kept++] = claim;
    }
    this.claims.length = kept;
    this.windowStartedAt = windowEnd;

    return { checked: true, gaps, unknownQueues };
  }

  private warnOnce(event: string, fields: Record<string, string | number | boolean | undefined>): void {
    if (this.warnedUnavailable) return;
    this.warnedUnavailable = true;
    this.logger.warn(event, fields);
  }
}

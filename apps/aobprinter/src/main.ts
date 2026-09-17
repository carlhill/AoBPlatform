/**
 * AOBPRINTER, wired together and running.
 *
 * The whole program in six lines of behaviour, repeated every poll:
 *
 *   1. Look at every queue's spool slot. If something complete is sitting in
 *      one, claim it under a unique name (each port is one file path and the
 *      next job to that queue will overwrite it).
 *   2. Parse everything claimed and not yet parsed — including anything a
 *      previous run left behind.
 *   3. Flush whatever is due in the outbox.
 *
 * And, on their own slower timers, two things that watch rather than do: the
 * outbox sweep (a stale form is an alarm) and reconciliation against the
 * spooler's own event log (a form printed but never claimed is an alarm).
 *
 * IT CANNOT INTERFERE WITH PRINTING, and that is checked by what it does not
 * do: it never opens a spool file for writing, never talks to the spooler,
 * never holds a handle while it works (the claim is a rename, then everything
 * else happens to a file the spooler has no interest in), and never blocks. A
 * crash here loses nothing a restart does not pick up, and an unreachable
 * server just means the queue grows (hard rule 8).
 *
 * THERE IS EXACTLY ONE OF IT. The instance lock is taken before anything else
 * and given back on stop; two copies watching one set of spool files is a
 * form posted twice or a form lost (`instance-lock.ts`).
 */
import { loadConfig, type AobPrinterConfig } from './config';
import { acquireInstanceLock, type InstanceLock } from './instance-lock';
import type { KeyWrapper } from './keystore';
import { consoleLogger, redactError, type Logger } from './log';
import { Outbox } from './outbox';
import { makeHttpPoster } from './poster';
import { DEFAULT_RECONCILE_INTERVAL_MS, Reconciler, powershellEventCountReader, type EventCountReader } from './print-service-log';
import { buildRetentionDeps } from './retention';
import { templateFor } from './template';
import { QueueWatcher, claimedJobs, processClaimedJob } from './watcher';
import { readPackageVersion } from './version';

export interface RunHandles {
  /** One full cycle. Exposed so a test drives the loop rather than waiting on it. */
  tick(): Promise<void>;
  stop(): void;
}

export interface StartDeps {
  /**
   * Overrides the real DPAPI wrapper. Tests use this to prove the refuse-to-
   * start path and the encrypt/decrypt path without touching Windows DPAPI or
   * shelling to PowerShell — which is also what keeps this suite runnable on
   * the Linux CI runner.
   */
  readonly keyWrapper?: KeyWrapper;
  /**
   * Overrides the real instance lock. Same purpose as `keyWrapper`: a test
   * that wants to prove something other than locking should not have to
   * arrange a second process, and the lock itself is proved in
   * `instance-lock.test.ts` where it belongs.
   */
  readonly instanceLock?: InstanceLock;
  /**
   * Overrides the Print Service event-log reader. The real one shells to
   * PowerShell and returns null off Windows, so leaving it alone is safe in
   * CI — this is for a test that wants to prove what happens when the counts
   * disagree.
   */
  readonly eventCounts?: EventCountReader;
}

/**
 * Start the program. THROWS SYNCHRONOUSLY, refusing to start, in four cases:
 * another instance is already running, an unbuilt parser template, an outbox
 * folder written by a newer build, or a retention key that is enabled in
 * configuration but cannot be unwrapped (`keystore.ts`). All four are
 * preferable to running in a state this program cannot honestly describe.
 */
export function start(config: AobPrinterConfig, logger: Logger = consoleLogger, deps: StartDeps = {}): RunHandles {
  const version = readPackageVersion();

  /*
   * FIRST, BEFORE ANY FOLDER IS TOUCHED. Everything below this line reads or
   * writes state that belongs to exactly one running program: the claim
   * folders, the outbox, the retention key. Taking the lock afterwards would
   * leave a window in which two processes had both already started work.
   */
  const lock = deps.instanceLock ?? acquireInstanceLock(config.dataDir, version, logger);

  /*
   * EVERY LATER REFUSAL GIVES THE LOCK BACK. A start that throws has not
   * started anything, so holding the lock afterwards would make the SECOND
   * attempt — the one by the technician who has just fixed the config — fail
   * with "already running" about a process that never ran. That reads as the
   * guard rail being broken, and it would be.
   */
  try {
    return startLocked(config, logger, deps, version, lock);
  } catch (err) {
    lock.release();
    throw err;
  }
}

function startLocked(
  config: AobPrinterConfig,
  logger: Logger,
  deps: StartDeps,
  version: string,
  lock: InstanceLock,
): RunHandles {
  const template = templateFor(config.templateVersion);
  if (!template) {
    throw new Error(
      `No parser template "${config.templateVersion}" is built into this program. Templates are versioned ` +
        'content and ship with the build; a configuration naming one that does not exist would parse nothing.',
    );
  }

  const retention = buildRetentionDeps(config.dataDir, config.retention, logger, deps.keyWrapper);
  const outbox = new Outbox(config.dataDir, makeHttpPoster(config, logger), logger, () => new Date(), retention, version);
  const queueWatcher = new QueueWatcher(config.queues, config.dataDir, config.settleMs, logger);
  const reconciler = new Reconciler(deps.eventCounts ?? powershellEventCountReader(), logger);
  const queueNames = config.queues.map((q) => q.name);

  if (!/^https:/i.test(config.endpoint) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(config.endpoint)) {
    logger.warn('config.insecure_endpoint', {
      note: 'this endpoint is neither HTTPS nor local; mutual TLS is the recorded posture and is not built yet',
    });
  }
  if (config.clientCertPath !== undefined) {
    logger.warn('config.mtls_not_implemented', {
      note: 'a client certificate is configured but this build does not present one; the transport decision is open',
    });
  }

  /*
   * A FILESYSTEM ERROR HERE MUST NOT BE THE REASON THIS PROGRAM WON'T START
   * OR WON'T KEEP RUNNING (hard rule 8, the same posture `tick()`'s catch-all
   * takes). The sweep is a safety net on top of the outbox's own guarantees,
   * not a precondition for them — a locked file or a permissions hiccup
   * reading `pending/` or `poison/` is worth logging loudly, never worth
   * refusing to capture the next print over.
   */
  function safeSweep(): { alarmed: number; expired: number } {
    try {
      return outbox.sweep();
    } catch (err) {
      logger.error('sweep.failed', { error: redactError(err) });
      return { alarmed: 0, expired: 0 };
    }
  }

  /*
   * THE SAME POSTURE, FOR THE SAME REASON. Reconciliation reads Windows' own
   * event log through PowerShell, which is the most environment-dependent
   * thing this program does — a locked-down desktop, a disabled log, a
   * PowerShell execution policy. `Reconciler` already fails closed and warns
   * once; this is the belt to that braces, so that no shape of failure in an
   * ALARM can stop the loop that captures forms.
   */
  /*
   * AWAITED, AND THE REJECTION HANDLED, because `reconcile` is now
   * asynchronous: it shells out to PowerShell, and doing that synchronously
   * stopped the event loop that claims spool files (hard rule 8). An
   * unhandled rejection from a timer callback would take the process down,
   * which is the same failure wearing a different coat.
   */
  async function safeReconcile(): Promise<void> {
    try {
      await reconciler.reconcile(queueNames);
    } catch (err) {
      logger.error('reconcile.failed', { error: redactError(err) });
    }
  }

  /*
   * ONCE HERE, AND AGAIN ON AN INTERVAL BELOW. The machine is off overnight;
   * a pending job or a poisoned form that aged past its threshold at 2am must
   * not sit unremarked until somebody prints again at nine. Run before the
   * banner so a stale form already on disk from a previous run is reflected
   * in it, not just in the next scheduled sweep.
   */
  const startupSweep = safeSweep();

  logger.info('aobprinter.started', {
    version,
    template: template.version,
    pms: template.pms,
    queues: queueNames.join(','),
    waiting: outbox.depth(),
    retention: config.retention.enabled,
    pendingAlarms: startupSweep.alarmed,
  });

  let running = false;
  let stopped = false;

  async function tick(): Promise<void> {
    // Overlapping ticks would claim the same file twice. One at a time.
    if (running || stopped) return;
    running = true;
    try {
      for (const { queue } of queueWatcher.claimAll()) {
        // Counted for reconciliation the moment it is claimed, which is the
        // event the spooler's own count is compared against.
        reconciler.recordClaim(queue.name);
      }
      /*
       * EVERY QUEUE'S BACKLOG, NOT JUST WHAT WAS CLAIMED THIS TICK. A restart
       * finds claimed-but-unparsed files from the last run, and they are
       * per-queue folders now, so the scan is per queue too — which is also
       * what keeps a record stamped with the room it actually came from.
       */
      for (const { queue, dirs } of queueWatcher.watched) {
        for (const path of claimedJobs(dirs)) {
          processClaimedJob(path, template!, outbox, dirs, queue, logger);
        }
      }
      await outbox.flush();
    } catch (err) {
      /*
       * Never let a bad cycle stop the loop: the next print must still be
       * claimed even if this one went wrong.
       *
       * THROUGH `redactError`, NOT `err.message`. This is the catch-all — the
       * one place an exception nobody anticipated arrives, which is precisely
       * where a message carrying page content or a constructed path would leak.
       * It was written as a raw `.slice(0, 200)` first and a reviewer caught
       * it; every other error site in this program already redacts, and the
       * only one that could not be reasoned about ahead of time was the one
       * that did not.
       */
      logger.error('tick.failed', { error: redactError(err) });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), config.pollMs);
  // A poll timer must not be the reason a service refuses to shut down.
  timer.unref?.();

  const sweepTimer = setInterval(safeSweep, config.retention.sweepIntervalMs);
  sweepTimer.unref?.();

  const reconcileTimer = setInterval(() => void safeReconcile(), DEFAULT_RECONCILE_INTERVAL_MS);
  reconcileTimer.unref?.();

  return {
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(sweepTimer);
      clearInterval(reconcileTimer);
      // Last, so nothing is still running when the next instance is allowed in.
      lock.release();
      logger.info('aobprinter.stopped', {});
    },
  };
}

/* istanbul ignore next -- the entry point, exercised by running the program. */
if (require.main === module) {
  const handles = start(loadConfig());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => handles.stop());
  // Keep the process alive; the interval above is unref'd on purpose.
  setInterval(() => undefined, 1 << 30);
}

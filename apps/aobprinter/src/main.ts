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
import { Collector, type CollectionClient } from './collector';
import { collectionEndpointsOf, makeHttpCollectionClient } from './collection-client';
import { loadConfig, type AobPrinterConfig } from './config';
import { acquireInstanceLock, type InstanceLock } from './instance-lock';
import type { KeyWrapper } from './keystore';
import { consoleLogger, redactError, type Logger } from './log';
import { Outbox } from './outbox';
import { makeHttpPoster } from './poster';
import { DEFAULT_RECONCILE_INTERVAL_MS, Reconciler, powershellEventCountReader, type EventCountReader } from './print-service-log';
import { PrintArchive } from './archive';
import { buildRetentionDeps, loadCipher, type Cipher } from './retention';
import { assertLocalDataDir, openStore, type AobPrinterStore, type DriveType } from './store';
import { templateFor, type ParserTemplate } from './template';
import { QueueWatcher, claimedJobs, processClaimedJob } from './watcher';
import { readPackageVersion } from './version';

export interface RunHandles {
  /** One full cycle. Exposed so a test drives the loop rather than waiting on it. */
  tick(): Promise<void>;
  /**
   * One collection sweep: ask what is signed, file it. SEPARATE FROM `tick`
   * on purpose -- it runs on its own much slower timer, and a test of filing
   * should not have to drive the spool watcher to get there. Resolves to what
   * it did; a no-op when collection is switched off.
   */
  collect(): Promise<void>;
  /** One reconciliation against the Print Service log. Exposed for the same reason as `collect`. */
  reconcile(): Promise<void>;
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
  /**
   * Overrides the collection client. A test that wants to prove what happens
   * when a signed form comes back should not have to stand up a platform --
   * and the HTTP half is proved on its own, the way the poster's is.
   */
  readonly collectionClient?: CollectionClient;
  /**
   * Overrides the Windows drive-type check behind `assertLocalDataDir`. The
   * real one asks PowerShell once per drive letter; a test proving the
   * network-drive refusal should not need a network drive.
   */
  readonly driveTypeOf?: (letter: string) => DriveType;
}

/**
 * Start the program. THROWS SYNCHRONOUSLY, refusing to start, in six cases:
 * a data folder on a network drive (`store.ts`), another instance is already
 * running, a database or folder outbox written by a newer build, an unbuilt
 * parser template, or a retention key that is enabled in configuration but
 * cannot be unwrapped (`keystore.ts`). All six are preferable to running in a
 * state this program cannot honestly describe.
 */
export function start(config: AobPrinterConfig, logger: Logger = consoleLogger, deps: StartDeps = {}): RunHandles {
  const version = readPackageVersion();

  /*
   * FIRST, BEFORE ANY FOLDER IS TOUCHED. Everything below this line reads or
   * writes state that belongs to exactly one running program: the claim
   * folders, the outbox, the retention key. Taking the lock afterwards would
   * leave a window in which two processes had both already started work.
   */
  /*
   * A TEMPLATE THIS BUILD DOES NOT CARRY IS REFUSED BEFORE ANYTHING IS TOUCHED
   * — before the lock, the database or the audit trail — so a refused start
   * leaves no `program.started` behind to look like a crash next time.
   */
  const template = templateFor(config.templateVersion);
  if (!template) {
    throw new Error(
      `No parser template "${config.templateVersion}" is built into this program. Templates are versioned ` +
        'content and ship with the build; a configuration naming one that does not exist would parse nothing.',
    );
  }

  /*
   * BEFORE THE LOCK, because the lock is a file in the data folder: a data
   * folder on a network drive is refused before anything is written to it.
   */
  assertLocalDataDir(config.dataDir, deps.driveTypeOf);

  const lock = deps.instanceLock ?? acquireInstanceLock(config.dataDir, version, logger);

  /*
   * EVERY LATER REFUSAL GIVES THE LOCK BACK. A start that throws has not
   * started anything, so holding the lock afterwards would make the SECOND
   * attempt — the one by the technician who has just fixed the config — fail
   * with "already running" about a process that never ran. That reads as the
   * guard rail being broken, and it would be.
   */
  try {
    /*
     * THE KEY BEFORE THE DATABASE (D-2026-09-29-02): the database encrypts
     * every file location it records, so it cannot open without the key. A
     * key on disk that will not unwrap refuses to start, here.
     */
    const cipher = loadCipher(config.dataDir, logger, deps.keyWrapper);
    /*
     * Opened under the lock: the database belongs to exactly one running
     * program. `program.started` is recorded the moment the schema is ready —
     * BEFORE the folder import, the retention migration and the start-up
     * sweep — so everything this start does sits after the marker that
     * explains it (an unclean restart, an upgrade).
     */
    const store = openStore(config.dataDir, {
      logger,
      cipher,
      printerVersion: version,
      beforeImport: (s) =>
        s.programStarted({
          queues: config.queues.length,
          retention: config.retention.enabled,
          collecting: config.collection.enabled || deps.collectionClient !== undefined,
        }),
      afterImportFailed: (s) => s.programStartFailed(),
    });
    try {
      return startLocked(config, logger, deps, version, lock, store, cipher, template);
    } catch (err) {
      // It recorded a start and then refused: say so, so the next start is not read as a crash.
      try {
        store.programStartFailed();
      } catch (auditErr) {
        logger.error('audit.start_failure_not_recorded', { error: redactError(auditErr) });
      }
      store.close();
      throw err;
    }
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
  store: AobPrinterStore,
  cipher: Cipher,
  template: ParserTemplate,
): RunHandles {
  const retention = buildRetentionDeps(config.retention, store, cipher);
  const archive = new PrintArchive(config.dataDir, store, cipher, logger, config.retention.archiveDays);
  const outbox = new Outbox(store, makeHttpPoster(config, logger), logger, () => new Date(), retention, version);
  const queueWatcher = new QueueWatcher(config.queues, config.dataDir, config.settleMs, logger);
  const reconciler = new Reconciler(deps.eventCounts ?? powershellEventCountReader(), logger, undefined, undefined, (gap) => store.printGap(gap));
  const queueNames = config.queues.map((q) => q.name);

  /*
   * THE OTHER DIRECTION, AND IT IS OPTIONAL (GA-PLAN B13). Print-capture in,
   * import-folder out -- one installed program, one credential -- but an
   * install that has not been told where to file does not file, and says so
   * in the banner rather than looking identical to one that does.
   */
  const collector =
    config.collection.enabled || deps.collectionClient
      ? new Collector(
          deps.collectionClient ?? makeHttpCollectionClient(config, logger),
          config.collection.importFolder,
          logger,
          version,
          () => new Date(),
          store,
        )
      : null;

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
   * reading the outbox is worth logging loudly, never worth
   * refusing to capture the next print over.
   */
  let running = false;
  let collecting = false;
  let reconciling = false;
  let stopped = false;
  let finished = false;

  /*
   * THE DATABASE IS CLOSED ONLY WHEN NOTHING IS USING IT. A stop that closed
   * it under a post the server had just accepted would fail to record the
   * acknowledgement — and the form would be posted again on the next start.
   * So `stop()` finishes at once when idle, and otherwise the running tick,
   * collection or reconciliation finishes it on its way out.
   */
  function finishStopIfIdle(): void {
    if (!stopped || finished || running || collecting || reconciling) return;
    finished = true;
    try {
      store.programStopped();
    } catch (err) {
      logger.error('audit.stop_not_recorded', { error: redactError(err) });
    }
    store.close();
    // Last, so nothing is still running when the next instance is allowed in.
    lock.release();
    logger.info('aobprinter.stopped', {});
  }

  function safeSweep(): { alarmed: number; expired: number } {
    try {
      const swept = outbox.sweep();
      // The archive's clock runs on the same sweep; it never throws.
      archive.sweep();
      return swept;
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
  /*
   * THE SAME POSTURE AS THE OTHER TWO WATCHERS, AND IT MATTERS MOST HERE.
   * Collection touches a network AND a folder that may be a mapped drive on
   * a server that is down -- the two least reliable things this program can
   * reach. `Collector.sweep` already returns rather than throwing; this is
   * the belt to that braces, because no shape of failure in FILING may stop
   * the loop that CAPTURES (hard rule 8). A consent filed tomorrow is a
   * nuisance; a consent never captured is the practice's problem.
   */
  async function safeCollect(): Promise<void> {
    // One at a time, like `tick`: two sweeps sharing one flag let a stop close the database under the slower.
    if (!collector || stopped || collecting) return;
    collecting = true;
    try {
      await collector.sweep();
    } catch (err) {
      logger.error('collect.sweep_failed', { error: redactError(err) });
    } finally {
      collecting = false;
      finishStopIfIdle();
    }
  }

  async function safeReconcile(): Promise<void> {
    // Tracked like a collection, so a gap found while stopping reaches the audit trail, not just the log.
    if (stopped || reconciling) return;
    reconciling = true;
    try {
      await reconciler.reconcile(queueNames);
    } catch (err) {
      logger.error('reconcile.failed', { error: redactError(err) });
    } finally {
      reconciling = false;
      finishStopIfIdle();
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
    /*
     * WHERE SIGNED FORMS GO, OR THAT THEY DO NOT. A technician reading one
     * line at startup should be able to tell a two-way install from a
     * capture-only one, and the list endpoint says which platform it asks.
     * The FOLDER is not logged: it is a local path, and paths have turned
     * out to carry a practice's name more than once.
     */
    collecting: collector !== null,
    collectFrom: collector ? collectionEndpointsOf(config).list : undefined,
  });


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
          processClaimedJob(path, template, outbox, dirs, queue, logger, undefined, { prints: store, archive });
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
      finishStopIfIdle();
    }
  }

  const timer = setInterval(() => void tick(), config.pollMs);
  // A poll timer must not be the reason a service refuses to shut down.
  timer.unref?.();

  const sweepTimer = setInterval(safeSweep, config.retention.sweepIntervalMs);
  sweepTimer.unref?.();

  const reconcileTimer = setInterval(() => void safeReconcile(), DEFAULT_RECONCILE_INTERVAL_MS);
  reconcileTimer.unref?.();

  /*
   * MINUTES, NOT THE POLL INTERVAL. The spool is watched twice a second
   * because a patient is standing at a desk; nobody is waiting on a document
   * being filed, and a practice's PMS folder does not want a request every
   * half-second all day.
   */
  const collectTimer = collector ? setInterval(() => void safeCollect(), config.collection.pollMs) : null;
  collectTimer?.unref?.();

  return {
    tick,
    collect: safeCollect,
    reconcile: safeReconcile,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(sweepTimer);
      clearInterval(reconcileTimer);
      if (collectTimer) clearInterval(collectTimer);
      finishStopIfIdle();
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

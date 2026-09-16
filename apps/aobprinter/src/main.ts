/**
 * AOBPRINTER, wired together and running.
 *
 * The whole program in six lines of behaviour, repeated every poll:
 *
 *   1. Look at the spool slot. If something complete is sitting in it, claim it
 *      under a unique name (the port is one file path and the next job will
 *      overwrite it).
 *   2. Parse everything claimed and not yet parsed — including anything a
 *      previous run left behind.
 *   3. Flush whatever is due in the outbox.
 *
 * IT CANNOT INTERFERE WITH PRINTING, and that is checked by what it does not
 * do: it never opens the spool file for writing, never talks to the spooler,
 * never holds a handle while it works (the claim is a rename, then everything
 * else happens to a file the spooler has no interest in), and never blocks. A
 * crash here loses nothing a restart does not pick up, and an unreachable
 * server just means the queue grows (hard rule 8).
 */
import { loadConfig, type AobPrinterConfig } from './config';
import { consoleLogger, redactError, type Logger } from './log';
import { Outbox } from './outbox';
import { makeHttpPoster } from './poster';
import { templateFor } from './template';
import { SpoolClaimer, claimedJobs, processClaimedJob, watcherDirs } from './watcher';

export interface RunHandles {
  /** One full cycle. Exposed so a test drives the loop rather than waiting on it. */
  tick(): Promise<void>;
  stop(): void;
}

export function start(config: AobPrinterConfig, logger: Logger = consoleLogger): RunHandles {
  const template = templateFor(config.templateVersion);
  if (!template) {
    throw new Error(
      `No parser template "${config.templateVersion}" is built into this program. Templates are versioned ` +
        'content and ship with the build; a configuration naming one that does not exist would parse nothing.',
    );
  }

  const dirs = watcherDirs(config.dataDir);
  const outbox = new Outbox(config.dataDir, makeHttpPoster(config, logger), logger);
  const claimer = new SpoolClaimer(config.spoolFile, dirs, config.settleMs, logger);

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

  logger.info('aobprinter.started', {
    template: template.version,
    pms: template.pms,
    spool: config.spoolFile,
    waiting: outbox.depth(),
  });

  let running = false;
  let stopped = false;

  async function tick(): Promise<void> {
    // Overlapping ticks would claim the same file twice. One at a time.
    if (running || stopped) return;
    running = true;
    try {
      claimer.claim();
      for (const path of claimedJobs(dirs)) {
        processClaimedJob(path, template!, outbox, dirs, logger);
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

  return {
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
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

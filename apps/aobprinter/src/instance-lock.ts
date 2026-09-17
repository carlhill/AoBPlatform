/**
 * One AOBPRINTER per data directory, enforced by the operating system rather
 * than by hoping.
 *
 * WHAT GOES WRONG WITHOUT IT. The port this program watches is ONE file path
 * and claiming is a rename (`watcher.ts`). Two processes watching the same
 * path is not a slow install, it is a correctness failure with two shapes:
 * both stat the settled file, both attempt the rename, and either they claim
 * the same bytes under two names — one form posted twice, two records, two
 * arrivals in front of a receptionist — or, worse, one claims while the other
 * is mid-read and the loser parks a form as "incomplete" that was never
 * incomplete at all. A practice gets a second copy of this program by the
 * most ordinary means imaginable: a service that is already installed plus a
 * technician running `npm start` in a console to see what it does.
 *
 * WHY A LOCK FILE OPENED `'wx'` AND NOT A NAMED MUTEX OR A PORT. `'wx'` is
 * `O_CREAT | O_EXCL`: the filesystem creates the file or fails with `EEXIST`,
 * atomically, with no window between the check and the create. It needs no
 * dependency (CLAUDE.md §7), no elevated rights, and it works the same in a
 * test against a temp directory as it does on a practice desktop. It also
 * leaves something a human can read — `{ pid, version, startedAt }` — which a
 * mutex handle does not: a technician looking at a refusal can see which
 * process and which build is holding the machine.
 *
 * THE LOCK IS PER DATA DIRECTORY, NOT PER MACHINE, and that is deliberate.
 * The thing that must not be shared is the spool/claim/outbox state, all of
 * which hangs off `dataDir`. Two installs pointed at two different data
 * directories are two independent programs and neither is a hazard to the
 * other.
 *
 * A STALE LOCK MUST NEVER BE A SUPPORT CALL. A desktop loses power mid-print
 * and the lock file outlives the process that wrote it. Refusing to start
 * until somebody deletes a file they have never heard of would turn a power
 * cut into a day with no evidence capture, which is the opposite of what this
 * guard rail is for. So the holder's liveness is checked, and a lock held by
 * a pid that is gone is reclaimed with a warning — loudly, because the same
 * line is the only clue that the last shutdown was not clean.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactError, type Logger } from './log';

/** What the lock file holds. Diagnostics for a human, and the liveness check's input. */
interface LockHolder {
  readonly pid: number;
  readonly version: string;
  readonly startedAt: string;
}

export interface InstanceLock {
  /** Give the lock up. Best-effort and never throws: a failed release must not turn a clean shutdown into a crash. */
  release(): void;
}

export interface InstanceLockDeps {
  /** Defaults to `process.pid`. Injected so a test can act as another process without forking one. */
  readonly pid?: number;
  /** Defaults to a `process.kill(pid, 0)` probe. Injected so a test can say "that pid is gone" deterministically. */
  readonly isAlive?: (pid: number) => boolean;
  readonly now?: () => Date;
}

export function instanceLockPath(dataDir: string): string {
  return join(dataDir, 'aobprinter.lock');
}

/**
 * Is that process still there?
 *
 * `process.kill(pid, 0)` sends no signal; it only asks the kernel whether the
 * pid exists and whether we could signal it. The two error codes mean
 * opposite things and getting them the wrong way round would be the whole bug:
 *
 *   ESRCH — no such process. The holder is gone; the lock is stale.
 *   EPERM — the process EXISTS and we are not allowed to signal it (it belongs
 *           to another user, typically the service account while a technician
 *           runs a second copy by hand). That is precisely the collision this
 *           lock exists to prevent, so it counts as alive.
 *
 * Anything else unexpected is also read as alive: refusing to start is the
 * safe side of an unknown, because the failure it guards against is a form
 * posted twice or lost.
 */
function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Read the holder, or null if there is nothing trustworthy to read.
 *
 * A CORRUPT LOCK FILE IS TREATED AS STALE, NOT AS A LIVE HOLDER. A truncated
 * or empty file is what a process killed between `open` and `write` leaves
 * behind — a holder that never got as far as running. Reading it as "somebody
 * is here" would wedge the program permanently on a file nobody can explain.
 */
function readHolder(path: string, logger: Logger): LockHolder | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    logger.warn('instance_lock.unreadable', {
      path,
      error: redactError(err),
      note: 'an unreadable lock file is treated as stale and reclaimed; a half-written one is what a killed process leaves',
    });
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.pid !== 'number' || !Number.isInteger(doc.pid) || doc.pid <= 0) return null;

  return {
    pid: doc.pid,
    version: typeof doc.version === 'string' ? doc.version : 'unknown',
    startedAt: typeof doc.startedAt === 'string' ? doc.startedAt : 'unknown',
  };
}

/**
 * Two attempts, and no more.
 *
 * One reclaim of a stale lock is the real case (the last run died). A second
 * `EEXIST` after reclaiming means something is recreating the file as fast as
 * we remove it — which is another live instance in a start-up race, not a
 * stale file — and a loop there would spin forever on a practice desktop.
 * Failing with a sentence a human can act on is better than a program that
 * appears to hang.
 */
const MAX_ATTEMPTS = 2;

/**
 * Take the lock, or throw.
 *
 * THE THROW MUST PROPAGATE. It is tempting to catch this at the entry point
 * and `process.exit(0)` quietly, on the grounds that "already running" is not
 * an error. It is an error here: the person who started the second copy did
 * so for a reason and needs to be told the first one is running, and a silent
 * success would make a service-manager restart loop look healthy while
 * nothing watched the spool.
 */
export function acquireInstanceLock(
  dataDir: string,
  version: string,
  logger: Logger,
  deps: InstanceLockDeps = {},
): InstanceLock {
  const pid = deps.pid ?? process.pid;
  const isAlive = deps.isAlive ?? processIsAlive;
  const now = deps.now ?? (() => new Date());
  const path = instanceLockPath(dataDir);

  mkdirSync(dataDir, { recursive: true });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let fd: number;
    try {
      // 'wx' is O_CREAT|O_EXCL: create-or-fail, atomic, no check-then-act gap.
      fd = openSync(path, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      const holder = readHolder(path, logger);
      if (holder && isAlive(holder.pid)) {
        throw new Error(
          `AOBPRINTER is already running (pid ${holder.pid}, version ${holder.version}, started ${holder.startedAt}). ` +
            'A second instance refuses to start: two watchers on one spool file can double-post a form or lose one. ' +
            `Stop the running instance first, or, if you are certain it is gone, delete ${path}.`,
          { cause: err },
        );
      }

      logger.warn('instance_lock.stale', {
        path,
        stalePid: holder?.pid,
        staleVersion: holder?.version,
        note: 'the process that held this lock is gone — the last shutdown was not clean; reclaiming it',
      });
      try {
        unlinkSync(path);
      } catch {
        /* another starter got there first; the next attempt's EEXIST will say so */
      }
      continue;
    }

    try {
      writeFileSync(fd, JSON.stringify({ pid, version, startedAt: now().toISOString() }, null, 2), 'utf8');
    } finally {
      closeSync(fd);
    }

    return {
      release: () => {
        try {
          unlinkSync(path);
        } catch {
          /*
           * Already gone (a temp directory removed under us, an operator who
           * deleted it by hand). Shutting down is not the moment to raise an
           * exception about a file we were about to delete anyway.
           */
        }
      },
    };
  }

  throw new Error(
    `AOBPRINTER could not take its instance lock at ${path} after ${MAX_ATTEMPTS} attempts: the file is being ` +
      'recreated as fast as it is reclaimed, which means another instance is starting at the same time. ' +
      'Start one copy and leave it running.',
  );
}

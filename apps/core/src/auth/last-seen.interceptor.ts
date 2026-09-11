import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedPrincipal } from '@aobplatform/auth-client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Recording that somebody actually signed in.
 *
 * WHY THIS HAD TO EXIST. `staff_members.lastSignInAt` was read in two places
 * that matter — the badge on the user list, and the inactivity lifecycle that
 * withdraws access after nine idle months — and written in none. So the list
 * said "Invited — not signed in yet" about people who were signed in and
 * looking at it, and every account looked permanently idle to the sweep.
 *
 * A column that two features depend on and nothing maintains is worse than a
 * missing column: the features run, and quietly answer wrongly.
 *
 * ONCE EVERY QUARTER OF AN HOUR, NOT ONCE PER REQUEST. The questions being
 * asked of this value are "have they ever signed in" and "have they been idle
 * for months". Neither needs second-level accuracy, and a write on every
 * request would put a row update in front of every read the console makes.
 */
const REFRESH_AFTER_MS = 15 * 60 * 1000;

@Injectable()
export class LastSeenInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const principal = request?.principal as AuthenticatedPrincipal | undefined;

    /*
     * Needs both: the subject to know WHO, and the practice claim because the
     * staff table is behind RLS and there is no scope to read it without one.
     *
     * An operator ACTING AS somebody is skipped on purpose — this records that
     * a person signed in, and a support session is not the practice's own
     * people using their own accounts. Counting it would keep an abandoned
     * account looking alive every time somebody here opened it.
     */
    if (principal?.sub && principal.practiceId && !request.actingAs) {
      void this.touch(principal.practiceId, principal.sub);
    }

    return next.handle();
  }

  /**
   * Deliberately not awaited, and deliberately silent on failure.
   *
   * This is bookkeeping about a request, not part of it. A request that
   * succeeded must not be reported as failed because a timestamp could not be
   * written, and the caller should not wait on it either.
   */
  private async touch(practiceId: string, keycloakUserId: string): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - REFRESH_AFTER_MS);
      await this.prisma.withPractice(practiceId, (tx) =>
        tx.staffMember.updateMany({
          where: {
            keycloakUserId,
            // Only when stale. `updateMany` with the condition in the WHERE
            // makes that one statement rather than a read followed by a write,
            // so two concurrent requests cannot both decide to write.
            OR: [{ lastSignInAt: null }, { lastSignInAt: { lt: cutoff } }],
          },
          data: { lastSignInAt: new Date() },
        }),
      );
    } catch {
      // Intentionally swallowed. See above.
    }
  }
}

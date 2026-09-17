import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_SURFACE_PROFILE } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WHICH PROFILE IS THIS PRACTICE ON — one question, asked by one guard.
 *
 * WHY A CACHE AT ALL. `SurfaceGuard` runs on every request, and without this
 * a gated route would cost a round trip to Postgres before the handler even
 * started. The window is short on purpose: a practice that has just had a
 * surface switched off and can still call it for half a minute is a confusing
 * thing to watch, and somebody testing the change would reasonably conclude it
 * had not worked. `PracticesService` drops the entry outright when the column
 * moves, so the window only ever covers a change made somewhere else — a
 * direct SQL edit, or another process.
 *
 * ONLY GATED ROUTES EVER ASK. The guard resolves the surface first and returns
 * immediately for `always` and for an unclassified route, which is the large
 * majority of them, so the common request never reaches this service at all.
 *
 * IT FAILS OPEN, AND THAT IS THE RULE RATHER THAN AN OVERSIGHT (hard rule 8,
 * REQ-REC-04). If the practice row cannot be read — the id is not a practice,
 * the database is unhappy, RLS answers nothing — the answer is the default
 * profile, which allows everything. A platform that refused the front desk
 * because a settings lookup failed would be blocking care to enforce a
 * commercial boundary, and the boundary is not worth that. The cost of the
 * other direction is that a surface stays visible a little longer than it
 * should.
 */
@Injectable()
export class PracticeSurfacesService {
  private readonly logger = new Logger(PracticeSurfacesService.name);
  private readonly cache = new Map<string, { at: number; profile: string }>();

  /** Long enough to spare the database a read per request, short enough not to feel stuck. */
  private static readonly TTL_MS = 15_000;

  /**
   * A ceiling so a long-lived process cannot accumulate an entry per practice
   * for ever. Cleared wholesale rather than evicted cleverly: the entries are
   * a handful of bytes each and rebuilding one costs a single indexed read.
   */
  private static readonly MAX_ENTRIES = 5_000;

  constructor(private readonly prisma: PrismaService) {}

  async profileOf(practiceId: string): Promise<string> {
    const hit = this.cache.get(practiceId);
    if (hit && Date.now() - hit.at < PracticeSurfacesService.TTL_MS) return hit.profile;

    let profile = DEFAULT_SURFACE_PROFILE;
    try {
      const row = await this.prisma.withPractice(practiceId, (tx) =>
        tx.practice.findFirst({ select: { surfaceProfile: true } }),
      );
      // NO ROW IS NOT A REFUSAL. An id that names no practice this caller can
      // see is somebody else's problem to answer — RLS, a 404, a validation
      // pipe — and answering it here as "no surfaces" would turn a missing
      // practice into a refused endpoint with the wrong explanation.
      if (row?.surfaceProfile) profile = row.surfaceProfile;
    } catch (err) {
      // NEVER THE REASON A REQUEST FAILS. No practice id in the message: this
      // logs a failure to read a setting, and identifiers do not belong in it.
      this.logger.warn(`Could not read a practice's surface profile; allowing. ${(err as Error).message}`);
      return DEFAULT_SURFACE_PROFILE;
    }

    if (this.cache.size >= PracticeSurfacesService.MAX_ENTRIES) this.cache.clear();
    this.cache.set(practiceId, { at: Date.now(), profile });
    return profile;
  }

  /** Dropped the moment the column moves, so the change is visible immediately. */
  forget(practiceId: string): void {
    this.cache.delete(practiceId);
  }
}

import { SetMetadata } from '@nestjs/common';

export const PRACTICE_SCOPED = 'aob:practice-scoped';

/**
 * THE PRACTICE'S OWN ACT. A platform operator may not do this for them.
 *
 * The mirror image of `@RequireRoles(PLATFORM_ADMIN)`, and the pair is the
 * point: separation of duties cuts both ways.
 *
 *   - A PRACTICE may not verify its own evidence — it cannot confirm its own
 *     address, and it cannot record its own practitioner's register check.
 *     Those are `@RequireRoles(PLATFORM_ADMIN)`.
 *
 *   - THE PLATFORM may not originate the practice's relationships. Inviting a
 *     practitioner to a location is the practice saying "this person works
 *     here", and it is the practice that must say it.
 *
 * WHY IT IS NOT MERELY TIDY. An invitation is how a practitioner comes to be
 * named on consent records at a site. If a platform operator can create and
 * send one, then a single person at AoBPlatform can introduce a practitioner
 * into a practice they do not work for, and the practice's own records will
 * show the practice invited them. The practice would have no way to tell,
 * afterwards, that it had not.
 *
 * IT ACCOMMODATES ACTING-AS BY CONSTRUCTION, and this is why the rule is
 * written as "carries a practice claim" rather than "is not a platform user".
 * When impersonation is built (RECERTIFICATION-AND-ACTING-AS.md), a platform
 * user acting as a practice holds a token carrying that practice's claim — so
 * they pass this check, exactly as intended, and the acting-as log records who
 * they really were. A rule phrased as "refuse platform roles" would have had
 * to be unpicked to allow that; this one does not.
 *
 * Note also what CRITICAL-ISSUES.md §5 rules 6 and 7 then do: any
 * impersonation forces re-approval, by a DIFFERENT person. So the permitted
 * path has a cost, and the cost is what stops it becoming the normal path.
 *
 * STAGED like the rest. A request with no principal at all still passes while
 * AUTH_ENFORCE is false; a request that carries one is checked either way.
 */
export const PracticeScoped = () => SetMetadata(PRACTICE_SCOPED, true);

import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  ALWAYS,
  SURFACE_REFUSED_CODE,
  profileSurfaces,
  surfaceOfEndpoint,
} from '@aobplatform/domain';
import { PracticeSurfacesService } from './practice-surfaces.service';

/**
 * DOES THIS PRACTICE USE THIS PART OF AoB? (D-2026-09-14-04.)
 *
 * WHY THE SERVER HALF IS THE POINT. Hiding a page is a courtesy; a hidden page
 * whose endpoint still answers is the real gap. The first customer has bought
 * the DB4 path and not the waiting-room walk-up, the portal, ongoing
 * agreements, the front desk's rails or the practitioner pages — and until
 * this guard existed, nothing in code stopped any of them being reached by
 * anybody who knew the URL, including AOBPRINTER being pointed at a practice
 * that had never bought it (TODO.md, AOBPRINTER item 5).
 *
 * ONE CLASSIFICATION, TWO CONSUMERS. The console and this guard both read
 * `packages/domain/content/practice-surfaces.json`. A rule written twice is a
 * rule that disagrees with itself within a month, and the disagreement always
 * shows up as a page somebody can see and cannot use.
 *
 * AN UNCLASSIFIED ROUTE IS ALLOWED, AND THAT IS DELIBERATE. Read
 * `profileAllowsEndpoint` in the domain for the whole reasoning; in short,
 * hard rule 8 says the platform never blocks care, so refusing an endpoint a
 * practice needs because somebody added a controller and did not classify it
 * is a worse failure than a surface staying visible at a practice that has not
 * bought it. `every_core_route_belongs_to_a_surface` is what catches the
 * omission, at the bench, before anybody deploys it. The blast radius is what
 * makes that safe: `full` is the default and allows everything, so a
 * misclassification can only reach a practice somebody has explicitly moved
 * off it.
 *
 * IT RUNS LAST AMONG THE GLOBAL GUARDS, and it has to. Nest runs them in
 * module-registration order; `PracticesModule` is registered after both
 * `AuthModule` and `DevicesModule` in `AppModule`, so by the time this looks
 * the token's practice claim is on the request AND the device guard has
 * deleted any client-supplied `x-practice-id` on a `/kiosk` route and replaced
 * it with the practice the credential actually resolves to. Registered any
 * earlier, a tablet could name whichever practice it liked and pick a profile
 * that allowed what it wanted.
 *
 * IT IS NOT THE ONLY CHECK AND MUST NOT BE MISTAKEN FOR ONE. It answers "does
 * this practice use this part of the product", which is commercial and
 * operational. It says nothing about who the caller is (`AuthGuard`,
 * `@PracticeScoped`, `@RequireRoles`) or about which records they may touch
 * (RLS). All of those still run.
 */
@Injectable()
export class SurfaceGuard implements CanActivate {
  private readonly logger = new Logger(SurfaceGuard.name);

  constructor(private readonly surfaces: PracticeSurfacesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest();

    /*
     * THE ROUTE PATTERN WHERE EXPRESS HAS ONE, so `/practices/<uuid>/config`
     * is classified as `/practices/:id/config` and the build-time test and
     * this guard are answering about the same string. The actual path is the
     * fallback, and the matcher treats `:id` and a real segment alike, so
     * either resolves to the same surface.
     */
    const path: string = request.route?.path ?? request.path ?? request.url ?? '/';
    const method: string = request.method ?? 'GET';

    const surface = surfaceOfEndpoint(method, path);
    // `always`, or nobody has classified it. Either way, no lookup and no
    // refusal — and this is the great majority of every request.
    if (surface === null || surface === ALWAYS) return true;

    /*
     * WHOSE PRACTICE IS THIS. The verified token's claim first — including the
     * one an acting-as session grants — and the header only after it, which is
     * the same precedence every other practice-scoped read here uses while
     * `AUTH_ENFORCE` is false.
     *
     * NO PRACTICE MEANS NOTHING TO CHECK. A public token-bearing call, a
     * platform-only route, a patient holding a link: none of them has a
     * practice whose profile could answer, and inventing one from the request
     * would be worse than not asking.
     */
    const claimed: unknown = request.principal?.practiceId;
    const header: unknown = request.headers?.['x-practice-id'];
    const practiceId =
      (typeof claimed === 'string' && claimed) ||
      (typeof header === 'string' && header) ||
      (Array.isArray(header) && typeof header[0] === 'string' && header[0]) ||
      null;
    if (!practiceId) return true;

    const profile = await this.surfaces.profileOf(practiceId);
    if (profileSurfaces(profile).includes(surface)) return true;

    /*
     * NEVER A BARE 403 (CLAUDE.md §7, "Shortcuts to the answer"). The body
     * carries the reason code and the surface key, so the console can map the
     * pair to copy and to the screen where it is turned on; the sentence is
     * the fallback for anything that has not mapped it, and it names the
     * surface rather than saying "forbidden" and leaving somebody to guess.
     *
     * NO PRACTICE ID AND NO PERSON IN THE LOG (REQ-LOG-08). A surface key and
     * a method are not PII; an identifier is.
     */
    this.logger.warn(`Refused ${method} ${path}: the practice does not use the "${surface}" surface.`);
    throw new ForbiddenException({
      code: SURFACE_REFUSED_CODE,
      surface,
      message:
        `This practice does not use the "${surface}" part of AoB, so nothing here will answer for it. ` +
        'Nothing has been deleted — an administrator can turn it on under Channels, and everything that ' +
        'was recorded while it was off is still there.',
    });
  }
}

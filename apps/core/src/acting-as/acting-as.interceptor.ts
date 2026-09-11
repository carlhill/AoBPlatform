import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { withActingAs } from '@aobplatform/vault-client';
import type { Observable } from 'rxjs';
import type { AuthenticatedPrincipal } from '@aobplatform/auth-client';
import { ActingAsService } from './acting-as.service';

/**
 * Makes an acting-as session actually take effect.
 *
 * Two things happen here, and both are the reason the feature is safe rather
 * than merely logged:
 *
 * 1. THE PRACTICE CLAIM. An operator with a live session gets that practice's
 *    id on their principal, which is what lets them through `@PracticeScoped()`
 *    endpoints — invite a practitioner, record a departure, fix an address.
 *    That decorator was deliberately written as "carries a practice claim"
 *    rather than "is not a platform user" for exactly this moment: acting-as
 *    passes BY CONSTRUCTION, with no exception carved into the rule.
 *
 * 2. THE SESSION KEY. Everything downstream runs inside `withActingAs`, so
 *    every vault event written during the request carries the session id
 *    without any call site knowing. Carl asked for "a unique key written to all
 *    records created/updated"; threading it through forty call sites would
 *    have held only until the forty-first.
 *
 * WHAT IT DOES NOT DO: change who the actor is. The AttributionInterceptor
 * still stamps the OPERATOR'S name on everything. An acting-as session is a
 * platform user wearing a practice's face — the face is for authorisation, the
 * name underneath is what goes in the record.
 */
@Injectable()
export class ActingAsInterceptor implements NestInterceptor {
  constructor(private readonly actingAs: ActingAsService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();
    const principal = request?.principal as AuthenticatedPrincipal | undefined;

    /*
     * An operator who ALREADY has a practice claim is a practice user, not
     * somebody acting for one. Nothing to do — and checking first means the
     * common case costs no query.
     */
    if (!principal?.sub || principal.practiceId) return next.handle();

    const open = await this.actingAs.openFor(principal.sub);
    if (!open) return next.handle();

    principal.practiceId = open.practiceId;
    request.headers['x-practice-id'] = open.practiceId;
    request.actingAs = open;

    return withActingAs(open.id, () => next.handle());
  }
}

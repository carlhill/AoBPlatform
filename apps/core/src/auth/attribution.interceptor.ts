import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { principalDisplayName, type AuthenticatedPrincipal } from '@aobplatform/auth-client';

/**
 * WHO DID IT COMES FROM THE TOKEN. Always. Everywhere.
 *
 * Carl has asked for this four times, about four different screens:
 *
 *   "do not ask for Your name. Just use the session user who is doing it."
 *   "automate your name to the person logged in"
 *
 * Each time it was fixed on the screen that prompted it, and each time another
 * screen still had the field. That is the wrong shape of fix — the defect is
 * not in any one screen, it is that ELEVEN endpoints accept a person's name in
 * the request body and believe it.
 *
 * WHY IT MATTERS MORE THAN THE ANNOYANCE. A name in a request body is an
 * assertion by whoever sent the request: unverified, trivially false, and —
 * once written into an append-only vault event — indistinguishable from one
 * that was checked. For a platform whose product is being able to say who did
 * what, an audit trail of self-declared names is not evidence. It is
 * decoration that invites reliance.
 *
 * The token's subject is a claim the realm signed. That is the whole
 * difference, and it is the difference between a record and a rumour.
 *
 * HOW THIS WORKS, AND WHY IT IS AN INTERCEPTOR RATHER THAN ELEVEN EDITS.
 * Most handlers pass the whole DTO to a service which reads the name field
 * itself, so patching call sites would have missed several — and would have
 * missed every endpoint written next week. Here, one rule applies to all of
 * them, and a new `somethingByName` field is covered the day it is added
 * rather than the day somebody notices.
 *
 * IT ONLY EVER OVERWRITES, NEVER INVENTS. With no verified session the body is
 * untouched, which keeps the staged-auth path working (AUTH_ENFORCE=false) and
 * keeps the e2e suites meaningful. Endpoints that must not accept an anonymous
 * actor refuse it themselves — see `activateLocation`, which would rather
 * return 400 than write a confirmation naming nobody.
 *
 * WHAT IT DOES NOT TOUCH. Only attribution fields — `reviewerName` and
 * anything ending in `ByName`. Data fields that happen to hold a person's name
 * are none of its business: `adminName` is the practice's nominated contact,
 * `legalName` and `tradingNames` are the entity's, and overwriting any of them
 * with the session user would be a data-corruption bug wearing a security
 * fix's clothes.
 */

/**
 * `reviewerName`, or anything ending in `ByName` — `uploadedByName`,
 * `invitedByName`, `performedByName`, and so on.
 *
 * Deliberately NOT a bare `/Name$/`, which would swallow `adminName`,
 * `legalName` and `practitionerName`.
 */
const ATTRIBUTION_FIELD = /^reviewerName$|By[Nn]ame$/;

@Injectable()
export class AttributionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const principal = request?.principal as AuthenticatedPrincipal | undefined;
    const name = principal && principalDisplayName(principal);

    if (name && request.body && typeof request.body === 'object' && !Array.isArray(request.body)) {
      for (const key of Object.keys(request.body)) {
        if (ATTRIBUTION_FIELD.test(key)) {
          request.body[key] = name;
        }
      }
    }

    return next.handle();
  }
}

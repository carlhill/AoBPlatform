import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '@aobplatform/auth-client';

/**
 * WHO IS DOING THIS — taken from the verified token, never from the request
 * body.
 *
 * Carl said it three times, and each time it was about a different screen:
 * "do not ask for Your name. Just use the session user who is doing it."
 *
 * He is right, and the reason is stronger than convenience. A name typed into
 * a form is an ASSERTION BY THE SENDER. It is unverified, it is trivially
 * false, and once it is written into an audit record it looks exactly like a
 * verified fact — indistinguishable, later, from one that was checked. For a
 * platform whose entire product is being able to say who did what, an audit
 * trail of self-declared names is not evidence, it is decoration.
 *
 * The token's subject is a claim the realm signed. That is the difference.
 *
 * It also removes a whole class of bug we kept re-hitting: every surface that
 * asked for a name had to validate it, every one of them validated it
 * slightly differently, and one of them accepted the empty string.
 */
export interface Actor {
  /** Keycloak subject — stable, and the thing to join on. */
  id: string;
  /** Human-readable, for display in an audit line. Falls back to the subject. */
  name: string;
  principalType: string;
  roles: string[];
}

/**
 * Resolves the actor, or `undefined` when no verified token is present.
 *
 * IT RETURNS UNDEFINED RATHER THAN THROWING, and the caller decides. While
 * `AUTH_ENFORCE` is false the dev header path is still legitimate for surfaces
 * whose sign-in does not exist yet, and a decorator that threw would take
 * those down. Endpoints that record WHO DID SOMETHING must refuse an absent
 * actor themselves — an audit line naming nobody is worse than a refusal,
 * because it is a record that cannot be questioned later.
 */
export const SessionActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor | undefined => {
  const request = context.switchToHttp().getRequest();
  const principal = request.principal as AuthenticatedPrincipal | undefined;
  if (!principal) return undefined;
  return {
    id: principal.sub,
    name: principal.preferredUsername ?? principal.sub,
    principalType: principal.principalType,
    roles: principal.roles ?? [],
  };
});

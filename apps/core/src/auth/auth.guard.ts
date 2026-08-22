import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { TokenVerifier, type AuthenticatedPrincipal } from '@aobplatform/auth-client';
import { PUBLIC_ENDPOINT } from './public.decorator';
import { REQUIRED_ROLES } from './roles.decorator';
import { PRACTICE_SCOPED } from './practice-scope.decorator';

declare module 'express' {
  interface Request {
    principal?: AuthenticatedPrincipal;
  }
}

/**
 * Verifies Keycloak bearer tokens and, where present, uses the token's
 * `practice_id` claim as the practice scope — replacing the dev
 * `x-practice-id` header.
 *
 * ENFORCEMENT IS STAGED, deliberately. `AUTH_ENFORCE=true` makes a valid
 * token mandatory; the default verifies-when-present and falls through
 * otherwise. The reason is ordering: the guard exists before every surface
 * has a login, and switching enforcement on ahead of that would lock the
 * console out of the very screens a practitioner uses to enrol their passkey.
 * Flipping it on is one env var and is a release gate for any deployed
 * environment — CLAUDE.md §6 requires no unauthenticated access to practice
 * data in production.
 *
 * Public capture endpoints (the patient-facing link landing) are exempt via
 * @Public(): they are reached with a single-use token by a person who has no
 * account and must never need one to sign (REQ-PORT-08).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly verifier?: TokenVerifier;
  private readonly enforce: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const issuer = this.config.get<string>('KEYCLOAK_PUBLIC_ISSUER') ?? this.config.get<string>('KEYCLOAK_ISSUER');
    this.enforce = this.config.get<string>('AUTH_ENFORCE') === 'true';
    if (issuer) {
      this.verifier = new TokenVerifier({
        issuer,
        /*
         * THE AUDIENCE, WHICH WAS NEVER CHECKED.
         *
         * `aud` is the claim that says who a token is FOR. Until now this
         * service accepted any token the realm had signed, for anybody — and
         * the realm was minting tokens whose audience listed thirteen services
         * belonging to a different product entirely, copied in with the realm
         * export, while OMITTING core-service itself.
         *
         * So the claim was simultaneously too broad to mean anything and did
         * not name the one service reading it. Both halves are now fixed: the
         * realm names our real services, and this checks that we are one of
         * them.
         */
        audience: this.config.get<string>('KEYCLOAK_AUDIENCE') ?? 'core-service',
        // Containers reach Keycloak internally while tokens carry the public
        // issuer — the JWKS route may differ from the issuer string.
        jwksUri: this.config.get<string>('KEYCLOAK_JWKS_URI'),
      });
    } else if (this.enforce) {
      throw new Error('AUTH_ENFORCE=true but no KEYCLOAK issuer is configured — refusing to start.');
    }
  }

  /**
   * Refuse a principal that does not hold one of the required roles.
   *
   * ONE COPY, called from both paths. It used to live only in the branch
   * that had verified a token, which left every @RequireRoles endpoint
   * undefended against a request that sent no token at all.
   */
  /**
   * Refuse a principal that is not scoped to a practice.
   *
   * The mirror of assertRoles. Written as "carries a practice claim"
   * rather than "is not a platform user" so that a platform user ACTING AS
   * a practice — who holds that practice’s claim — passes by construction
   * rather than by exception.
   */
  private assertPracticeScope(
    context: ExecutionContext,
    request: { method: string; url: string },
    principal: AuthenticatedPrincipal,
  ): void {
    const needed = this.reflector.getAllAndOverride<boolean>(PRACTICE_SCOPED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!needed) return;
    if (principal.practiceId) return;
    this.logger.warn(
      `Refused ${request.method} ${request.url} for ${principal.sub}: no practice claim on the token.`,
    );
    throw new ForbiddenException(
      'This is the practice’s own act and cannot be done for them. Inviting a practitioner to a location is the practice saying that person works there, so it needs a session belonging to the practice.',
    );
  }

  private assertRoles(
    context: ExecutionContext,
    request: { method: string; url: string },
    principal: AuthenticatedPrincipal,
  ): void {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return;
    const held = principal.roles ?? [];
    if (required.some((role) => held.includes(role))) return;
    this.logger.warn(
      `Refused ${request.method} ${request.url} for ${principal.sub}: holds [${held.join(', ')}], ` +
        `needs one of [${required.join(', ')}].`,
    );
    throw new ForbiddenException(
      `This endpoint requires one of: ${required.join(', ')}. Your account does not hold it.`,
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (this.enforce) throw new UnauthorizedException('A bearer token is required.');
      /*
       * NO TOKEN, BUT POSSIBLY A PRINCIPAL. Roles are checked against
       * whatever principal is known, not only against one this guard
       * verified itself.
       *
       * The old shape checked roles ONLY inside the token branch, so any
       * @RequireRoles endpoint was wide open to a request that simply sent
       * no Authorization header at all while AUTH_ENFORCE is false. That is
       * the opposite of what the decorator promises, and it meant the
       * platform-only endpoints — approving practices, confirming addresses,
       * recording register checks — were decorated but not defended.
       *
       * `request.principal` is a property on the Express request object, not
       * a header, so nothing a client sends can produce one. Only
       * server-side code sets it.
       */
      const known = request.principal as AuthenticatedPrincipal | undefined;
      if (known) {
        this.assertRoles(context, request, known);
        this.assertPracticeScope(context, request, known);
      }
      return true; // staged: dev header path still works
    }
    if (!this.verifier) {
      if (this.enforce) throw new UnauthorizedException('Token verification is not configured.');
      return true;
    }

    try {
      const principal = await this.verifier.verify(token);
      request.principal = principal;
      // The token's practice claim wins over the dev header when present.
      if (principal.practiceId) request.headers['x-practice-id'] = principal.practiceId;

      /*
       * ROLE CHECK, and note the asymmetry with the token check above.
       *
       * A request with NO token still passes while AUTH_ENFORCE is false —
       * that is the staging, and it exists because the passkey ceremony is
       * unproven on real hardware. But a request that DOES carry a token is
       * checked against the required roles either way, enforcement flag or not.
       *
       * "No token" is an unfinished deployment. "The wrong token" is an
       * answer — and deferring it would ship a window in which a perfectly
       * valid practice-admin token could approve practices, which is the single
       * most privileged act in the system.
       */
      this.assertRoles(context, request, principal);
      this.assertPracticeScope(context, request, principal);

      return true;
    } catch (err) {
      // A role refusal is an ANSWER, not a broken token — rethrowing it as
      // "invalid or expired" would send somebody off checking their passkey
      // when the real problem is that they hold the wrong role.
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn(`Bearer token rejected: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }
}

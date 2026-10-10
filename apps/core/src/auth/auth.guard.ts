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
import { authMethodFromAmr, mayPerformHighStakesAct, type StepUpRefusal } from '@aobplatform/domain';
import { PUBLIC_ENDPOINT } from './public.decorator';
import { REQUIRED_ROLES } from './roles.decorator';
import { PRACTICE_SCOPED } from './practice-scope.decorator';
import { FRESH_SECOND_FACTOR, type FreshSecondFactorRequirement } from './fresh-second-factor.decorator';

declare module 'express' {
  interface Request {
    principal?: AuthenticatedPrincipal;
  }
}

/**
 * The sentence for each step-up refusal. Each says what was observed about
 * THIS session and offers a remedy only where it is true for it (CLAUDE.md §7).
 * An unrecorded method is a sign-in service setting, so it offers no remedy:
 * signing in again helps only once that setting is in place, and this service
 * cannot tell whether it is.
 */
const STEP_UP_MESSAGES: Record<StepUpRefusal, string> = {
  reauthentication_required:
    'Confirm it is you before doing this. Sign in again — it takes a moment and this act cannot be undone.',
  second_factor_required:
    'This account signed in with a password and nothing else, and this act needs a second factor. ' +
    'Register an authenticator app or a passkey, then try again.',
  sign_in_method_unrecorded:
    'This sign-in did not record how it was made, so the server cannot confirm a passkey or a one-time code ' +
    'was used, and this act needs one. This is a setting on the sign-in service, not a problem with the account. ' +
    'Nothing was changed.',
};

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
    /*
     * NAME THE WAY THROUGH. The refusal is right -- these are the practice's
     * own acts and a platform operator has no standing to perform them from
     * the outside -- but stopping there tells somebody doing support that the
     * thing is impossible, when it is merely not possible AS THEMSELVES.
     *
     * Acting as somebody at the practice is exactly the supported route, and
     * it passes this check by construction: an acting-as session carries a
     * practice claim, which is all this asks for. It is also the route that
     * leaves a record of who did what on whose behalf, which doing it directly
     * would not.
     */
    throw new ForbiddenException(
      'This is the practice’s own act and cannot be done for them. It is the practice saying something about ' +
        'itself, so it needs a session belonging to the practice. If you are helping them, act as somebody ' +
        'at the practice and do it from there — that works, and it records who did it on whose behalf.',
    );
  }

  /**
   * A HIGH-STAKES ACT ASKS FOR THE SECOND FACTOR AGAIN (AUTH-TIERS.md §5.2).
   *
   * The rule itself lives in `@aobplatform/domain` because the console needs
   * the same answer to decide what to offer, and a rule with two
   * implementations is a rule with two behaviours.
   *
   * THE REFUSAL CARRIES A CODE, NOT ONLY A SENTENCE (CLAUDE.md §7). "Confirm
   * it's you" and "your account has no second factor" are different problems
   * with different fixes, and a surface that receives only prose cannot tell
   * them apart or offer the right control. The two codes are the domain's.
   */
  private assertFreshSecondFactor(
    context: ExecutionContext,
    request: { method: string; url: string },
    principal: AuthenticatedPrincipal,
  ): void {
    const needed = this.reflector.getAllAndOverride<FreshSecondFactorRequirement>(FRESH_SECOND_FACTOR, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!needed) return;
    const decision = mayPerformHighStakesAct({
      method: authMethodFromAmr(principal.amr),
      authTimeSeconds: principal.authTime,
      nowSeconds: Math.floor(Date.now() / 1000),
      maxAgeSeconds: needed.maxAgeSeconds ?? undefined,
    });
    if (decision.allowed) return;
    /*
     * NO PII AND NO CREDENTIAL IN THE LOG LINE — not the username, not the
     * method, and obviously never the password (hard rule 9's spirit,
     * AUTH-TIERS.md §5.5). The subject id and the route are enough to find
     * the session, and they are what an operator can act on.
     */
    this.logger.warn(
      `Refused ${request.method} ${request.url} for ${principal.sub}: ${decision.reason}` +
        (decision.ageSeconds === undefined ? '' : ` (authenticated ${decision.ageSeconds}s ago)`),
    );
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      reasonCode: decision.reason,
      message: STEP_UP_MESSAGES[decision.reason ?? 'reauthentication_required'],
    });
  }

  /**
   * A PLATFORM OPERATOR'S SESSION MUST NOT SAY IT USED A PASSWORD
   * (D-2026-09-12-11 — hard rule 15 still governs our own people).
   *
   * DEFENCE IN DEPTH, and it is here because the primary defence is somewhere
   * this service cannot see. The realm decides what an operator must present:
   * `practice-browser` gates on the `platform_admin` role and requires a
   * passkey, `operator-browser` has no password execution at all. Both are
   * asserted by `infra/keycloak/tier2-realm.test.mjs` in CI. But a Keycloak
   * session is not re-evaluated when a role is added, so somebody promoted to
   * `platform_admin` mid-afternoon carries on holding the password-and-code
   * session they signed in with — and a flow binding is one admin-console
   * click from being wrong. This is the check that notices either.
   *
   * IT REFUSES WHAT THE SESSION SAYS, NOT WHAT IT DOES NOT SAY, and the
   * distinction is load-bearing. `unknown` means the realm issued no `amr`
   * claim, which was true of the MAIN realm until D-2026-10-10-06 added its
   * amr mapper — and is still true of any realm not yet brought up to date —
   * so refusing `unknown` here would lock every platform operator out of the
   * console. (A high-stakes act does refuse `unknown`, with its own code.) A session that positively states a
   * password-based method is a different thing: that is an operator who got
   * in through a path they should not have, and it is refused.
   */
  private assertOperatorAuthMethod(
    request: { method: string; url: string },
    principal: AuthenticatedPrincipal,
  ): void {
    if (!(principal.roles ?? []).includes('platform_admin')) return;
    const method = authMethodFromAmr(principal.amr);
    if (method !== 'password+otp' && method !== 'password-only') return;
    this.logger.warn(
      `Refused ${request.method} ${request.url} for ${principal.sub}: a platform operator's session states a ` +
        'password-based method, and rule 15 requires a passkey.',
    );
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      reasonCode: 'operator_requires_passkey',
      message:
        'Platform operator accounts sign in with a passkey. This session did not, so it cannot be used here. ' +
        'Sign out and sign in again with your passkey.',
    });
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
        this.assertOperatorAuthMethod(request, known);
        this.assertRoles(context, request, known);
        this.assertPracticeScope(context, request, known);
        this.assertFreshSecondFactor(context, request, known);
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
      /*
       * BEFORE THE ROLE CHECK, not after. The question "is this session
       * entitled to be a platform operator's at all" comes ahead of "does it
       * hold the role this endpoint wants" — otherwise an operator on a
       * password session would pass every endpoint that happens not to
       * require the role.
       */
      this.assertOperatorAuthMethod(request, principal);
      this.assertRoles(context, request, principal);
      this.assertPracticeScope(context, request, principal);
      this.assertFreshSecondFactor(context, request, principal);

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

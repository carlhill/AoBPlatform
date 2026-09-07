import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { PrincipalType } from './principal';

export interface TokenVerifierConfig {
  /** Realm issuer URL as tokens CARRY it (`iss`) — the PUBLIC issuer, e.g. http://localhost:21024/realms/aobplatform. */
  issuer: string;
  /** Expected `aud` claim — typically the verifying service's own client id. */
  audience?: string;
  /**
   * Override the JWKS URI; defaults to `${issuer}/protocol/openid-connect/certs`.
   * Needed when the network path to Keycloak differs from the public issuer
   * (containers reach keycloak:8080 while tokens say localhost:21024 — the
   * ReferralPlatform issuer-mismatch lesson).
   */
  jwksUri?: string;
  clockToleranceSeconds?: number;
}

export interface AuthenticatedPrincipal {
  /** Keycloak subject id. */
  sub: string;
  principalType: PrincipalType;
  /** Realm + client roles flattened, per Keycloak's realm_access/resource_access claims. */
  roles: string[];
  /** The practice this principal is scoped to — custom claim; feeds RLS scoping when auth enforcement lands. */
  practiceId?: string;
  preferredUsername?: string;
  raw: JWTPayload;
}

/**
 * A NAME THAT IS NEVER EMPTY, for attribution.
 *
 * `preferredUsername` comes straight off a JWT claim with no shape guarantee
 * -- a service account, a not-quite-provisioned realm user, or simply a blank
 * string satisfies the type and passes every `??` check unharmed, because `??`
 * only falls through on `null`/`undefined`, never on `''`. Two call sites each
 * wrote `principal.preferredUsername ?? principal.sub` and each was one blank
 * claim away from silently attributing an action to nobody -- which surfaced
 * as "A change to an approved practice must name the person making it" on a
 * fully signed-in session, because the fallback never triggered.
 *
 * `sub` is the Keycloak subject id and always present on a verified token, so
 * it is the backstop `||` reaches for when the preferred name is blank.
 */
export function principalDisplayName(p: Pick<AuthenticatedPrincipal, 'sub' | 'preferredUsername'>): string {
  return p.preferredUsername?.trim() || p.sub;
}

/** Verifies Keycloak-issued RS256 access tokens (user-facing and service-to-service) via JWKS. */
export class TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: TokenVerifierConfig) {
    const jwksUri = config.jwksUri ?? `${config.issuer}/protocol/openid-connect/certs`;
    this.jwks = createRemoteJWKSet(new URL(jwksUri));
  }

  async verify(token: string): Promise<AuthenticatedPrincipal> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.audience,
      clockTolerance: this.config.clockToleranceSeconds ?? 10,
    });

    const realmRoles = ((payload as any).realm_access?.roles ?? []) as string[];
    const resourceAccess = ((payload as any).resource_access ?? {}) as Record<string, { roles?: string[] }>;
    const clientRoles = Object.values(resourceAccess).flatMap((r) => r.roles ?? []);

    return {
      sub: payload.sub as string,
      principalType: ((payload as any).principal_type as PrincipalType) ?? 'system',
      roles: [...realmRoles, ...clientRoles],
      practiceId: (payload as any).practice_id as string | undefined,
      preferredUsername: (payload as any).preferred_username as string | undefined,
      raw: payload,
    };
  }
}

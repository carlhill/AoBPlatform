/** In production, an obviously-placeholder secret must stop the service at boot. */
const PLACEHOLDER_PATTERN = /change-me|placeholder|example|secret$/i;

export function assertNotPlaceholderSecret(name: string, value: string): void {
  if (process.env.NODE_ENV === 'production' && PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${name} is a committed placeholder — refusing to start in production.`);
  }
}

export interface ServiceTokenConfig {
  /** e.g. http://localhost:21024/realms/aobplatform (or the container-internal issuer for the TOKEN ENDPOINT). */
  issuer: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Client-credentials grant for service-to-service calls (core → vault, core →
 * rules). Caches until shortly before expiry. One provider per calling
 * service, constructed at startup from KEYCLOAK_* env vars.
 */
export class ServiceTokenProvider {
  private cached?: CachedToken;

  constructor(private readonly config: ServiceTokenConfig) {
    // Fail closed at boot, not on the first outbound call.
    assertNotPlaceholderSecret('KEYCLOAK_CLIENT_SECRET', config.clientSecret);
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - 10_000 > now) {
      return this.cached.accessToken;
    }
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const res = await fetchImpl(`${this.config.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to obtain service token from Keycloak: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { accessToken: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return this.cached.accessToken;
  }
}

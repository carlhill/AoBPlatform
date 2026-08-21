import { assertNotPlaceholderSecret } from './service-token';

/**
 * Minimal Keycloak Admin API client — only what practitioner/staff onboarding
 * needs (FR-1.9, FR-1.5). Deliberately NOT a general-purpose admin SDK: this
 * process should be able to create an account and ask for a passkey, and
 * nothing else.
 *
 * WHY AN EMAILED ACTION LINK RATHER THAN A PASSWORD: the clinician browser
 * flow REQUIRES a passkey (rule 15), so a practitioner with no passkey cannot
 * log in to register one. Keycloak's execute-actions token resolves that
 * chicken-and-egg — it authenticates the holder for the duration of the
 * required action only, which is exactly the "admin-attested invitation, not
 * self-service reset" model FR-1.9 asks for.
 */
export interface KeycloakAdminConfig {
  /** Base URL, e.g. http://keycloak:8080 (no /realms suffix). */
  baseUrl: string;
  realm: string;
  /** Admin credentials. In a real deployment this is a service account with realm-management roles, not admin/admin. */
  adminRealm?: string;
  clientId?: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
}

export interface KeycloakUserSummary {
  id: string;
  username: string;
  email?: string;
}

export class KeycloakAdminError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'KeycloakAdminError';
  }
}

export class KeycloakAdminClient {
  private cachedToken?: { token: string; expiresAt: number };

  constructor(private readonly config: KeycloakAdminConfig) {
    assertNotPlaceholderSecret('KEYCLOAK_ADMIN_PASSWORD', config.password);
  }

  private get fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch;
  }

  private async token(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 10_000 > now) return this.cachedToken.token;
    const realm = this.config.adminRealm ?? 'master';
    const res = await this.fetchImpl(`${this.config.baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: this.config.clientId ?? 'admin-cli',
        username: this.config.username,
        password: this.config.password,
      }),
    });
    if (!res.ok) throw new KeycloakAdminError(`Keycloak admin login failed: ${res.status}`, res.status);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return body.access_token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body?: T }> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/admin/realms/${this.config.realm}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 409) {
      throw new KeycloakAdminError(
        `Keycloak admin ${method} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
        res.status,
      );
    }
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as T) : undefined };
  }

  async findByUsername(username: string): Promise<KeycloakUserSummary | null> {
    const { body } = await this.request<KeycloakUserSummary[]>(
      'GET',
      `/users?username=${encodeURIComponent(username)}&exact=true`,
    );
    return body?.[0] ?? null;
  }

  /**
   * Creates the account with the passkey requirement already attached, and
   * NO password credential — there is no password to fall back to, by
   * construction. Idempotent: returns the existing user on conflict.
   */
  async createPasskeyOnlyUser(input: {
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    realmRoles?: string[];
    attributes?: Record<string, string>;
  }): Promise<KeycloakUserSummary> {
    const existing = await this.findByUsername(input.username);
    if (existing) return existing;

    await this.request('POST', '/users', {
      username: input.username,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      emailVerified: Boolean(input.email),
      // The account is born needing a passkey and holding no password.
      requiredActions: ['webauthn-register-passwordless'],
      credentials: [],
      attributes: input.attributes,
    });

    const created = await this.findByUsername(input.username);
    if (!created) throw new KeycloakAdminError('User was created but could not be read back.');

    if (input.realmRoles?.length) await this.assignRealmRoles(created.id, input.realmRoles);
    return created;
  }

  async assignRealmRoles(userId: string, roleNames: readonly string[]): Promise<void> {
    const { body: available } = await this.request<Array<{ id: string; name: string }>>('GET', '/roles');
    const roles = (available ?? []).filter((r) => roleNames.includes(r.name));
    if (roles.length === 0) return;
    await this.request('POST', `/users/${userId}/role-mappings/realm`, roles);
  }

  /**
   * Sends the passkey-enrolment invitation. The resulting link bypasses the
   * passkey-required browser flow for the duration of the action only —
   * verified against a live realm, 21 Aug 2026.
   */
  async sendPasskeyEnrolment(userId: string, options: { clientId: string; redirectUri: string; lifespanSeconds?: number }): Promise<void> {
    const params = new URLSearchParams({ client_id: options.clientId, redirect_uri: options.redirectUri });
    if (options.lifespanSeconds) params.set('lifespan', String(options.lifespanSeconds));
    await this.request('PUT', `/users/${userId}/execute-actions-email?${params.toString()}`, [
      'webauthn-register-passwordless',
    ]);
  }

  /** REQ-PKI-04/-05: revoke on departure or deregistration. */
  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.request('PUT', `/users/${userId}`, { enabled });
  }
}

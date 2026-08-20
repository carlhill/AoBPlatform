import type { VaultClient, VaultEventInput, VaultEventRecord } from '@aobplatform/contracts';
import type { IsoTimestamp } from '@aobplatform/domain';

export interface VaultHttpClientConfig {
  /** Base URL of the Evidence Vault service, e.g. http://vault:3003 (see docker-compose.yml). */
  baseUrl: string;
  /**
   * Service-to-service bearer token (Keycloak client-credentials). Every vault
   * write is authenticated as the calling service, never anonymous — the vault
   * is a separate trust domain (REQ-LOG-05).
   */
  getServiceToken: () => Promise<string> | string;
  /** Override for tests; defaults to the global fetch (Node >=18). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class VaultClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'VaultClientError';
  }
}

/**
 * Thin HTTP client for the Evidence Vault service, implementing the
 * @aobplatform/contracts VaultClient interface. Note what is absent: there is
 * no update and no delete method, mirroring the service API (rule 11,
 * ADR A-02).
 *
 * Call patterns (CONVENTIONS.md §7):
 * 1. **Outbox pattern — mandatory for consent-relevant events.** Enqueue via
 *    `enqueueVaultEvent()` in the same DB transaction as the domain write; the
 *    relay publishes. See outbox.ts / relay.ts.
 * 2. **Direct `append()`** — acceptable only for genuinely non-consent events.
 */
export class VaultHttpClient implements VaultClient {
  constructor(private readonly config: VaultHttpClientConfig) {}

  async append(event: VaultEventInput): Promise<VaultEventRecord> {
    return this.request<VaultEventRecord>('POST', '/events', event);
  }

  async getChainSegment(query: {
    readonly subjectId?: string;
    readonly from?: IsoTimestamp;
    readonly to?: IsoTimestamp;
  }): Promise<readonly VaultEventRecord[]> {
    const qs = new URLSearchParams();
    if (query.subjectId) qs.set('subjectId', query.subjectId);
    if (query.from) qs.set('from', query.from);
    if (query.to) qs.set('to', query.to);
    return this.request<VaultEventRecord[]>('GET', `/events?${qs.toString()}`);
  }

  async verifyArtefactHash(sha256: string): Promise<{ exists: boolean; recordedAt?: IsoTimestamp }> {
    return this.request<{ exists: boolean; recordedAt?: IsoTimestamp }>(
      'GET',
      `/artefacts/${encodeURIComponent(sha256)}/verify`,
    );
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const token = await this.config.getServiceToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 5000);
    try {
      const res = await fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => undefined);
        throw new VaultClientError(`Evidence Vault service returned ${res.status}`, res.status, text);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

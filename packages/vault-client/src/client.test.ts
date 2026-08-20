import { VaultHttpClient, VaultClientError } from './client';

function makeFetch(status: number, body: unknown): typeof fetch {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('VaultHttpClient', () => {
  it('appends an event with service authentication', async () => {
    const fetchImpl = makeFetch(201, { id: 'evt-1', hash: 'abc' });
    const client = new VaultHttpClient({
      baseUrl: 'http://vault:3003',
      getServiceToken: () => 'service-token',
      fetchImpl,
    });

    await client.append({
      type: 'agreement.created',
      actor: { principalType: 'system', id: 'core' },
      subject: { type: 'Agreement', id: 'agr-1' },
    });

    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe('http://vault:3003/events');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer service-token');
  });

  it('exposes no update or delete method (rule 11, ADR A-02)', () => {
    const client = new VaultHttpClient({ baseUrl: 'x', getServiceToken: () => 't' });
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    expect(surface).toEqual(expect.arrayContaining(['append', 'getChainSegment', 'verifyArtefactHash']));
    expect(surface.join(' ')).not.toMatch(/update|delete|remove|patch/i);
  });

  it('throws VaultClientError on a non-2xx response', async () => {
    const client = new VaultHttpClient({
      baseUrl: 'http://vault:3003',
      getServiceToken: () => 't',
      fetchImpl: makeFetch(400, { error: 'unknown event type' }),
    });
    await expect(
      client.append({
        type: 'agreement.created',
        actor: { principalType: 'system', id: 'core' },
        subject: { type: 'Agreement', id: 'agr-1' },
      }),
    ).rejects.toThrow(VaultClientError);
  });

  it('verifies an artefact hash without disclosing content (REQ-VAULT-09)', async () => {
    const fetchImpl = makeFetch(200, { exists: true, recordedAt: '2026-08-20T00:00:00Z' });
    const client = new VaultHttpClient({ baseUrl: 'http://vault:3003', getServiceToken: () => 't', fetchImpl });

    const result = await client.verifyArtefactHash('a'.repeat(64));

    expect(result.exists).toBe(true);
    const [url] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toContain('/artefacts/');
    expect(url).toContain('/verify');
  });
});

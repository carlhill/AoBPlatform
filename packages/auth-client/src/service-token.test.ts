import { ServiceTokenProvider, assertNotPlaceholderSecret } from './service-token';

describe('ServiceTokenProvider', () => {
  it('fetches and caches a client-credentials token until near expiry', async () => {
    let calls = 0;
    const fetchImpl = jest.fn(async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ access_token: `token-${calls}`, expires_in: 300 }),
      };
    }) as unknown as typeof fetch;

    const provider = new ServiceTokenProvider({
      issuer: 'http://keycloak:8080/realms/aobplatform',
      clientId: 'core-service',
      clientSecret: 'change-me-in-local-env',
      fetchImpl,
    });

    expect(await provider.getToken()).toBe('token-1');
    expect(await provider.getToken()).toBe('token-1'); // cached
    expect(calls).toBe(1);
  });

  it('throws a useful error on a failed token request', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 401, text: async () => 'invalid_client' })) as unknown as typeof fetch;
    const provider = new ServiceTokenProvider({
      issuer: 'http://keycloak:8080/realms/aobplatform',
      clientId: 'core-service',
      clientSecret: 'change-me-in-local-env',
      fetchImpl,
    });
    await expect(provider.getToken()).rejects.toThrow(/401/);
  });
});

describe('assertNotPlaceholderSecret', () => {
  it('refuses committed placeholders in production, tolerates them elsewhere', () => {
    expect(() => assertNotPlaceholderSecret('X', 'change-me-in-local-env')).not.toThrow();
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => assertNotPlaceholderSecret('X', 'change-me-in-local-env')).toThrow(/refusing to start/);
      expect(() => assertNotPlaceholderSecret('X', 'a-real-generated-value-1234')).not.toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

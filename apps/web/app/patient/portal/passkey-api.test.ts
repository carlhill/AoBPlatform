/**
 * THE PASSKEY CEREMONY, WITH `navigator.credentials` MOCKED (FR-8.2).
 *
 * WHY THE REAL LIBRARY RUNS HERE. `@simplewebauthn/browser` is not stubbed —
 * only the browser API underneath it is. What is being checked is the SEQUENCE
 * this page owns: fetch the options, hand them to the browser unread, post the
 * credential back with the challenge id the server gave us. Stubbing the
 * library would leave that sequence untested and assert only that we call a
 * function, which is not the thing that breaks.
 *
 * THE FIXTURE SWITCH IS OFF FOR THIS FILE. Every other portal test runs against
 * `fixtures.ts`; this one is specifically about the wire, so the env var is
 * stubbed before the module is imported and `api.ts` takes its real branch.
 *
 * NOTHING IS PERSISTED, and it is asserted rather than assumed. This code runs
 * on a patient's own phone; the same reasoning as the kiosk's
 * `kiosk_persists_nothing_but_pairing`, one surface along.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** base64url, because that is what the browser helpers decode. */
const b64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
const bytes = (...values: number[]) => new Uint8Array(values).buffer;

const REGISTRATION_OPTIONS = {
  challengeId: '11111111-1111-4111-8111-111111111111',
  options: {
    challenge: b64url('a-server-challenge'),
    rp: { id: 'localhost', name: 'AoBPlatform' },
    user: { id: b64url('acct-1'), name: 'acct-1', displayName: '' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
  },
};

const AUTHENTICATION_OPTIONS = {
  challengeId: '22222222-2222-4222-8222-222222222222',
  options: { challenge: b64url('another-challenge'), rpId: 'localhost' },
};

let fetchMock: ReturnType<typeof vi.fn>;
let create: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: 'OK', json: async () => body };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PORTAL_FIXTURES', 'false');
  vi.resetModules();

  create = vi.fn().mockResolvedValue({
    id: 'credential-one',
    rawId: bytes(1, 2, 3),
    response: { attestationObject: bytes(4, 5, 6), clientDataJSON: bytes(7, 8, 9) },
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
  });
  get = vi.fn().mockResolvedValue({
    id: 'credential-one',
    rawId: bytes(1, 2, 3),
    response: {
      authenticatorData: bytes(1),
      clientDataJSON: bytes(2),
      signature: bytes(3),
      userHandle: null,
    },
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
  });

  // The browser API the library sits on. `PublicKeyCredential` being a function
  // is exactly what `browserSupportsWebAuthn()` looks for.
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  Object.defineProperty(globalThis.navigator, 'credentials', {
    value: { create, get },
    configurable: true,
  });

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** The path of every call the module made, in order. */
const calledPaths = () => fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname);

describe('adding a passkey', () => {
  it('fetches options, runs the browser ceremony, and posts the credential back', async () => {
    fetchMock
      .mockResolvedValueOnce(json(REGISTRATION_OPTIONS))
      .mockResolvedValueOnce(
        json({
          registered: true,
          passkey: { id: 'pk-1', label: 'My phone', createdAt: '2026-09-04T00:00:00.000Z', lastUsedAt: null },
        }),
      );

    const { registerPasskey } = await import('./api');
    const passkey = await registerPasskey('My phone');

    expect(calledPaths()).toEqual([
      '/portal/passkeys/registration/options',
      '/portal/passkeys/registration/verify',
    ]);

    // The options went to the browser exactly as the server sent them.
    expect(create).toHaveBeenCalledTimes(1);
    const publicKey = create.mock.calls[0][0].publicKey;
    expect(publicKey.rp.id).toBe('localhost');

    /*
     * THE CHALLENGE ID GOES BACK, NOT THE CHALLENGE. The server spends the row
     * by primary key; digging the challenge out of `clientDataJSON` before it
     * has been verified would mean trusting the payload to find the thing that
     * decides whether to trust the payload.
     */
    const posted = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(posted.challengeId).toBe(REGISTRATION_OPTIONS.challengeId);
    expect(posted.label).toBe('My phone');
    expect(posted.response.id).toBe('credential-one');
    expect(posted.response.response.attestationObject).toBeTruthy();

    // NO ACCOUNT ID, PATIENT ID OR PRACTICE ID IS SENT. Who is enrolling is the
    // session cookie's answer, never the body's.
    expect(JSON.stringify(posted)).not.toMatch(/accountId|patientId|practiceId/);
    expect(fetchMock.mock.calls[1][1].credentials).toBe('include');

    expect(passkey.id).toBe('pk-1');
  });

  it('sends no label when the patient typed none', async () => {
    fetchMock
      .mockResolvedValueOnce(json(REGISTRATION_OPTIONS))
      .mockResolvedValueOnce(
        json({ registered: true, passkey: { id: 'pk-2', label: null, createdAt: 'x', lastUsedAt: null } }),
      );

    const { registerPasskey } = await import('./api');
    await registerPasskey('   ');

    const posted = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(posted.label).toBeUndefined();
  });

  it('lets a cancelled prompt reach the card as a failure, and posts nothing', async () => {
    fetchMock.mockResolvedValueOnce(json(REGISTRATION_OPTIONS));
    create.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));

    const { registerPasskey } = await import('./api');
    await expect(registerPasskey('My phone')).rejects.toBeTruthy();

    // The verify call never happened — nothing was enrolled and nothing changed.
    expect(calledPaths()).toEqual(['/portal/passkeys/registration/options']);
  });
});

describe('signing in with a passkey', () => {
  it('asks for options with no username and posts the assertion back', async () => {
    fetchMock
      .mockResolvedValueOnce(json(AUTHENTICATION_OPTIONS))
      .mockResolvedValueOnce(json({ signedIn: true, accountId: 'acct-1', links: [] }));

    const { signInWithPasskey } = await import('./api');
    await signInWithPasskey();

    expect(calledPaths()).toEqual([
      '/portal/passkeys/authentication/options',
      '/portal/passkeys/authentication/verify',
    ]);

    // NOTHING IDENTIFYING IS SENT IN EITHER DIRECTION. The options request has
    // no body at all; the verify carries a challenge id and the browser's
    // assertion, and nothing that names a person.
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    const posted = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(Object.keys(posted).sort()).toEqual(['challengeId', 'response']);
    expect(posted.challengeId).toBe(AUTHENTICATION_OPTIONS.challengeId);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('propagates a refusal so the screen can say so', async () => {
    fetchMock
      .mockResolvedValueOnce(json(AUTHENTICATION_OPTIONS))
      .mockResolvedValueOnce(json({}, 401));

    const { signInWithPasskey } = await import('./api');
    await expect(signInWithPasskey()).rejects.toBeTruthy();
  });
});

describe('portal_passkey_api_persists_nothing_in_the_browser', () => {
  it('touches no storage API through a whole enrol-and-sign-in cycle', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    fetchMock
      .mockResolvedValueOnce(json(REGISTRATION_OPTIONS))
      .mockResolvedValueOnce(
        json({ registered: true, passkey: { id: 'pk-1', label: null, createdAt: 'x', lastUsedAt: null } }),
      )
      .mockResolvedValueOnce(json(AUTHENTICATION_OPTIONS))
      .mockResolvedValueOnce(json({ signedIn: true, accountId: 'acct-1', links: [] }));

    const { registerPasskey, signInWithPasskey } = await import('./api');
    await registerPasskey();
    await signInWithPasskey();

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    // The session is the server's httpOnly cookie; nothing script-readable is set.
    expect(document.cookie).toBe('');
  });
});

describe('a browser that cannot do passkeys', () => {
  it('reports so, and reports so before anything is rendered', async () => {
    const { passkeysAvailable } = await import('./api');
    expect(passkeysAvailable()).toBe(true);

    vi.stubGlobal('PublicKeyCredential', undefined);
    vi.resetModules();
    const reloaded = await import('./api');
    expect(reloaded.passkeysAvailable()).toBe(false);
  });
});

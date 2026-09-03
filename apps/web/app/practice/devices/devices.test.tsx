/**
 * THE CONSOLE SIDE OF DEVICE PAIRING, rendered.
 *
 * IT EXISTS BECAUSE THIS PAGE CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open `/practice/devices` in a
 * headless check the way `/kiosk` can be opened. Without this, the page's first
 * render would happen in front of a practice.
 *
 * WHAT IT PINS, and none of it is cosmetic:
 *
 *  - The pairing code is shown ONCE, with its expiry and the sentence saying
 *    so. A code that could be fetched again would be a password with a nicer
 *    name, and the way out of losing one — Rotate — is named on screen.
 *  - Revoke ASKS, and the confirmation says what happens rather than "are you
 *    sure": the tablet stops on its next request, and nothing about it affects
 *    patients being seen or billed (hard rule 8, REQ-REC-04).
 *  - Revoke is not offered on a device that already holds no credential — a
 *    control that could only report having done nothing.
 *  - Rotate IS offered on a revoked device, because that is how a practice
 *    brings a tablet back without breaking the history REQ-SIG-02's device
 *    fingerprint depends on.
 *  - No credential and no hash ever reaches the screen. There is nothing to
 *    show and nothing to leak.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DeviceRow } from '@aobplatform/domain';
import { DevicesView } from './DevicesView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

const PAIRED: DeviceRow = {
  id: 'device-paired',
  label: 'Reception tablet 1',
  state: 'paired',
  createdBy: 'Robin Admin',
  createdAt: '2026-09-01T00:00:00.000Z',
  pairedAt: '2026-09-01T01:00:00.000Z',
  lastSeenAt: '2026-09-03T08:00:00.000Z',
  lastKioskBuild: '2026.09.03-1',
  revokedAt: null,
  revokedBy: null,
  pairingExpiresAt: null,
};

const REVOKED: DeviceRow = {
  ...PAIRED,
  id: 'device-revoked',
  label: 'Lost tablet',
  state: 'revoked',
  revokedAt: '2026-09-03T09:00:00.000Z',
  revokedBy: 'Robin Admin',
};

/** Every call the view makes, recorded. Nothing here reaches a real server. */
const calls: Array<{ url: string; method: string; body: unknown }> = [];

function stubFetch(devices: DeviceRow[], onPost?: (url: string) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const payload =
        method === 'GET'
          ? { devices, minimumKioskBuild: null }
          : (onPost?.(url) ?? { deviceId: 'device-new', label: 'x', code: 'ABCDEFGH', expiresAt: new Date(Date.now() + 600_000).toISOString() });
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

describe('/practice/devices — the practice’s tablets', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows what a person needs to recognise a tablet, and never a credential', async () => {
    stubFetch([PAIRED, REVOKED]);
    render(<DevicesView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`device-${PAIRED.id}`)).toBeTruthy());
    const row = screen.getByTestId(`device-${PAIRED.id}`);
    expect(row.textContent).toContain('Reception tablet 1');
    expect(row.textContent).toContain('Robin Admin');
    // The build, read back without touching the device — the first question of
    // a support call.
    expect(screen.getByTestId(`device-build-${PAIRED.id}`).textContent).toBe('2026.09.03-1');
    // The WORD is the state; colour only reinforces it.
    expect(row.textContent).toContain(strings.devices.states.paired);

    // The threat model is on the screen, because the reader is the person who
    // decides what to do when a tablet goes missing.
    expect(screen.getByTestId('devices-threat-note').textContent).toContain(
      'one credential and nothing else',
    );

    // Nothing resembling a secret is rendered anywhere.
    expect(document.body.textContent ?? '').not.toMatch(/credential[:=]|hash|[0-9a-f]{40}/i);
  });

  it('shows a new code once, with its expiry and the fact that it is shown once', async () => {
    stubFetch([]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId('device-add')).toBeTruthy());

    // Dead until valid: a nameless tablet is refused by the server, and a
    // control that can only fail teaches people the page is broken.
    const add = screen.getByTestId('device-add') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toBe(strings.devices.addBlocked);

    fireEvent.change(screen.getByTestId('device-label'), { target: { value: 'Reception tablet 2' } });
    expect((screen.getByTestId('device-add') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('device-add'));

    await waitFor(() => expect(screen.getByTestId('devices-code')).toBeTruthy());
    // Grouped in fours, because eight unbroken characters is where people lose
    // their place.
    expect(screen.getByTestId('devices-code-value').textContent).toBe('ABCD-EFGH');
    const panel = screen.getByTestId('devices-code').textContent ?? '';
    expect(panel).toContain('shown once');
    expect(panel).toMatch(/Expires in \d+ minutes?/);

    // The label went to the server; nothing else did.
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/devices');
    expect(post?.body).toEqual({ label: 'Reception tablet 2' });
  });

  it('revoking asks first, and says that nothing about it blocks care', async () => {
    stubFetch([PAIRED]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`revoke-${PAIRED.id}`)).toBeTruthy());

    // Nothing has been sent yet — pressing Revoke opens a question.
    fireEvent.click(screen.getByTestId(`revoke-${PAIRED.id}`));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    const body = screen.getByTestId(`device-${PAIRED.id}`).textContent ?? '';
    expect(body).toContain('stops working on its next request');
    // Hard rule 8, in words, because the instinct when a tablet goes missing is
    // to hesitate — and hesitating is the wrong answer.
    expect(body).toContain('nothing about this affects patients being seen or billed');

    fireEvent.change(screen.getByTestId('device-revoke-reason'), { target: { value: 'Left in a taxi' } });
    fireEvent.click(screen.getByTestId('device-confirm'));

    await waitFor(() => expect(calls.some((c) => c.url.includes('/revoke'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/revoke'))?.body).toEqual({ reason: 'Left in a taxi' });
  });

  it('offers rotate on a revoked tablet and revoke on neither', async () => {
    stubFetch([REVOKED]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`device-${REVOKED.id}`)).toBeTruthy());

    // A revoked device already holds no credential, so a second Revoke could
    // only report having done nothing.
    expect(screen.queryByTestId(`revoke-${REVOKED.id}`)).toBeNull();
    // Rotate stays: it is how a practice brings a tablet back, and registering
    // a second row for the same physical device would break the history
    // REQ-SIG-02's device fingerprint depends on.
    expect(screen.getByTestId(`rotate-${REVOKED.id}`)).toBeTruthy();
    expect(screen.getByTestId(`device-${REVOKED.id}`).textContent).toContain(
      strings.devices.states.revoked,
    );
  });

  it('sets and clears the kiosk build floor', async () => {
    stubFetch([PAIRED], () => ({ minimumKioskBuild: '2026.09.03-2' }));
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId('device-build-floor')).toBeTruthy());

    fireEvent.change(screen.getByTestId('device-build-floor'), { target: { value: '2026.09.03-2' } });
    fireEvent.click(screen.getByTestId('device-build-save'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('minimum-build'))).toBe(true));
    expect(calls.find((c) => c.url.includes('minimum-build'))?.body).toEqual({ build: '2026.09.03-2' });

    // An empty box is an explicit "no floor", not a no-op: the absence of a
    // setting is never a reason to reload every tablet in the country.
    fireEvent.change(screen.getByTestId('device-build-floor'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('device-build-save'));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes('minimum-build')).length).toBe(2),
    );
    expect(calls.filter((c) => c.url.includes('minimum-build'))[1].body).toEqual({ build: null });
  });
});

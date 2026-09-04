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
  showsWaitingList: false,
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

  it('add_tablet_is_a_button_at_the_top', async () => {
    /*
     * CARL, 4 SEPTEMBER 2026: "Add a tablet is buried" — it was section 2,
     * below the whole device list. It is now a button beside the section 1
     * heading, and clicking it reveals the same name form inline; section 2
     * is gone entirely.
     */
    stubFetch([PAIRED]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`device-${PAIRED.id}`)).toBeTruthy());

    // The list is what a reader came to check; the form is not open by default.
    expect(screen.queryByTestId('device-add-panel')).toBeNull();
    // And there is no separate "Add a tablet" section any more — it was never
    // a second heading, only a button beside the first.
    expect(screen.queryAllByRole('heading', { level: 2, name: strings.devices.addTitle })).toHaveLength(0);

    const toggle = screen.getByTestId('add-tablet-toggle');
    expect(toggle.textContent).toBe(strings.devices.addToggleAction);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('device-add-panel')).toBeTruthy();
    expect(screen.getByTestId('device-label')).toBeTruthy();

    // Cancel closes it again without touching the server.
    fireEvent.click(screen.getByTestId('device-add-cancel'));
    expect(screen.queryByTestId('device-add-panel')).toBeNull();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('the add form is dead until valid, and posts only the label', async () => {
    stubFetch([]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId('add-tablet-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('add-tablet-toggle'));

    // Dead until valid: a nameless tablet is refused by the server, and a
    // control that can only fail teaches people the page is broken.
    const add = screen.getByTestId('device-add') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toBe(strings.devices.addBlocked);

    fireEvent.change(screen.getByTestId('device-label'), { target: { value: 'Reception tablet 2' } });
    expect((screen.getByTestId('device-add') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('device-add'));

    // The label went to the server; nothing else did.
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/devices');
    expect(post?.body).toEqual({ label: 'Reception tablet 2' });

    // And the panel closes on success — it does not sit open over the row it
    // just created.
    await waitFor(() => expect(screen.queryByTestId('device-add-panel')).toBeNull());
  });

  it('unpaired_row_shows_its_code_and_expiry', async () => {
    /*
     * CARL, 4 SEPTEMBER 2026: "How do I pair these tablets?" — a waiting row
     * said only that a code was outstanding, never the code itself. Adding a
     * tablet now puts the code, large and copyable, on the new row — which
     * the server lists oldest-first, so the page itself reorders newest-first
     * (see `DevicesView`'s own comment on `devices`).
     */
    const newDevice: DeviceRow = {
      id: 'device-new',
      label: 'Reception tablet 2',
      state: 'awaiting_pairing',
      createdBy: 'Robin Admin',
      createdAt: new Date().toISOString(),
      pairedAt: null,
      lastSeenAt: null,
      lastKioskBuild: null,
      revokedAt: null,
      revokedBy: null,
      pairingExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      showsWaitingList: false,
    };
    const deviceList: DeviceRow[] = [PAIRED];
    stubFetch(deviceList, () => {
      // The server's own GET is oldest-first; pushing onto the end mirrors
      // that, and the page's own reordering is what puts it on top.
      deviceList.push(newDevice);
      return { deviceId: newDevice.id, label: newDevice.label, code: 'ABCDEFGH', expiresAt: newDevice.pairingExpiresAt };
    });
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId('add-tablet-toggle')).toBeTruthy());

    fireEvent.click(screen.getByTestId('add-tablet-toggle'));
    fireEvent.change(screen.getByTestId('device-label'), { target: { value: 'Reception tablet 2' } });
    fireEvent.click(screen.getByTestId('device-add'));

    // The new row, at the top, with its own code — not a floating panel.
    await waitFor(() => expect(screen.getByTestId(`device-code-value-${newDevice.id}`)).toBeTruthy());
    const list = screen.getByTestId(`device-${newDevice.id}`).closest('ul');
    expect(list?.firstElementChild?.getAttribute('data-testid')).toBe(`device-${newDevice.id}`);

    // Grouped in fours, because eight unbroken characters is where people
    // lose their place.
    expect(screen.getByTestId(`device-code-value-${newDevice.id}`).textContent).toBe('ABCD-EFGH');
    const panel = screen.getByTestId(`device-code-${newDevice.id}`).textContent ?? '';
    expect(panel).toMatch(/Expires in \d+ minutes?/);
    expect(panel).toContain(strings.devices.codeWhere);

    // Copyable.
    const copy = screen.getByTestId(`device-code-copy-${newDevice.id}`) as HTMLButtonElement;
    expect(copy.textContent).toBe(strings.devices.codeCopyAction);
  });

  it('expired_code_offers_a_new_one', async () => {
    /*
     * The server clears `pairingExpiresAt` once a code has expired
     * (`DevicesService.list`) — this page never had the value to begin with,
     * so it cannot show the dead code either way. What it can do is offer a
     * fresh, visible one in its place, with no confirmation: nothing is being
     * revoked from a tablet that was never paired.
     */
    const EXPIRED: DeviceRow = {
      id: 'device-expired',
      label: 'Kiosk 3',
      state: 'awaiting_pairing',
      createdBy: 'Robin Admin',
      createdAt: '2026-09-01T00:00:00.000Z',
      pairedAt: null,
      lastSeenAt: null,
      lastKioskBuild: null,
      revokedAt: null,
      revokedBy: null,
      pairingExpiresAt: null,
      showsWaitingList: false,
    };
    stubFetch([EXPIRED], () => ({
      deviceId: EXPIRED.id,
      label: EXPIRED.label,
      code: 'ZZZZWWWW',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    }));
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`device-${EXPIRED.id}`)).toBeTruthy());

    expect(screen.getByTestId(`device-code-expired-${EXPIRED.id}`).textContent).toBe(
      strings.devices.codeExpiredLabel,
    );
    expect(screen.queryByTestId(`device-code-value-${EXPIRED.id}`)).toBeNull();

    const newCode = screen.getByTestId(`device-new-code-${EXPIRED.id}`);
    expect(newCode.textContent).toBe(strings.devices.newCodeAction);

    // No confirmation dialog — clicking it calls rotate straight away.
    fireEvent.click(newCode);
    await waitFor(() => expect(calls.some((c) => c.url.includes(`/devices/${EXPIRED.id}/rotate`))).toBe(true));
    expect(calls.find((c) => c.url.includes('/rotate'))?.body).toEqual({});

    await waitFor(() => expect(screen.getByTestId(`device-code-value-${EXPIRED.id}`)).toBeTruthy());
    expect(screen.getByTestId(`device-code-value-${EXPIRED.id}`).textContent).toBe('ZZZZ-WWWW');
  });

  it('test_device_toggle_warns_that_it_shows_patient_names', async () => {
    /*
     * CARL, 4 SEPTEMBER 2026: "a toggle for test data to be shown in the list
     * if on; if off show what the user will see at the kiosk."
     *
     * WHAT IS PINNED HERE IS THAT IT IS A DISCLOSURE SWITCH AND SAYS SO. Off
     * by default; the warning names patient names in plain words and is
     * attached to the control rather than filed under it; and the write is a
     * PATCH carrying exactly the one boolean. Everything downstream — the
     * poll, the ETag, the tablet's banner — depends on nothing more than that.
     */
    stubFetch([PAIRED], () => ({ deviceId: PAIRED.id, showsWaitingList: true }));
    render(<DevicesView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByTestId(`test-device-${PAIRED.id}`)).toBeTruthy());
    const panel = screen.getByTestId(`test-device-${PAIRED.id}`);
    expect(panel.textContent).toContain(strings.devices.testDeviceLabel);
    // The warning is the hint on the control, and it says what it exposes.
    expect(panel.textContent).toMatch(/other patients.{0,3} names/i);
    expect(panel.textContent).toMatch(/next poll/i);

    // OFF BY DEFAULT. A disclosure is something somebody turns on.
    const box = panel.querySelector('button[role="checkbox"]') as HTMLElement;
    expect(box.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(box);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain(`/devices/${PAIRED.id}`);
    // Exactly the one boolean — no label, no practice, nothing else.
    expect(patch?.body).toEqual({ showsWaitingList: true });
  });

  it('does not offer the toggle on a revoked tablet — it holds no credential to show anything with', async () => {
    stubFetch([PAIRED, REVOKED]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`device-${REVOKED.id}`)).toBeTruthy());
    expect(screen.queryByTestId(`test-device-${REVOKED.id}`)).toBeNull();
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

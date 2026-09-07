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

/**
 * ON BEGIN, ANSWERING — the ordinary morning. The heartbeat fields are what
 * the device row gained on 5 Sep 2026; `stale` is the SERVER'S answer and this
 * page never recomputes it.
 */
const ON_BEGIN: DeviceRow = {
  ...PAIRED,
  id: 'device-on-begin',
  label: 'Reception tablet 2',
  lastSeenAt: new Date(Date.now() - 4_000).toISOString(),
  currentScreen: 'begin',
  currentSessionId: null,
  stale: false,
  outOfUse: false,
};

/** A pushed ceremony: the opaque session id, and no patient's name anywhere. */
const IN_SESSION: DeviceRow = {
  ...ON_BEGIN,
  id: 'device-in-session',
  label: 'Reception tablet 3',
  currentScreen: 'check-details',
  currentSessionId: 'f431e2a4-1111-4111-8111-111111111111',
};

/** A WALK-UP: a ceremony screen with no session. The state recall never reached. */
const WALK_UP: DeviceRow = {
  ...ON_BEGIN,
  id: 'device-walk-up',
  label: 'Reception tablet 4',
  currentScreen: 'verify',
  currentSessionId: null,
};

/** Two missed heartbeats. Asleep, off, or off the wifi — reception needs the row to say so. */
const STALE: DeviceRow = {
  ...ON_BEGIN,
  id: 'device-stale',
  label: 'Reception tablet 5',
  lastSeenAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  currentScreen: 'begin',
  stale: true,
};

/** Reception took this one off the floor. The credential is untouched. */
const OUT_OF_USE: DeviceRow = {
  ...ON_BEGIN,
  id: 'device-out-of-use',
  label: 'Reception tablet 6',
  state: 'inactive',
  outOfUse: true,
  outOfUseAt: '2026-09-05T09:30:00.000Z',
  outOfUseBy: 'Robin Reception',
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

  /**
   * WHERE THE TABLET IS, ON THE ROW (Carl, 4-5 Sep 2026; TODO.md "Tablet
   * heartbeat and Return to Begin").
   *
   * Carl's complaint: "the tablet must know what it is on" — and, before this,
   * the server never did. A walk-up half-way through verifying was invisible
   * from the console (recall reaches a pushed session; the session poll is off
   * during a walk-up), and a tablet on Begin looked exactly like one that was
   * switched off.
   *
   * AND NEVER A PATIENT'S NAME. The session tag is what reception matches
   * against the row it already has on screen; a name here would be a second
   * copy of somebody's identity on a monitor at the front counter for no gain
   * (Carl's ruling, 5 Sep 2026; REQ-VER-04, hard rule 9).
   */
  it('device_rows_show_where_the_tablet_is', async () => {
    stubFetch([ON_BEGIN, IN_SESSION, WALK_UP, STALE, OUT_OF_USE]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`device-activity-${ON_BEGIN.id}`)).toBeTruthy());

    // "On Begin · seen 4 s ago"
    const begin = screen.getByTestId(`device-activity-${ON_BEGIN.id}`).textContent ?? '';
    expect(begin).toContain(strings.devices.activity.screens.begin);
    expect(begin).toMatch(/seen \d+ s ago/);

    // "Checking details · session f431e2a4" — the id, never the person.
    const session = screen.getByTestId(`device-activity-${IN_SESSION.id}`).textContent ?? '';
    expect(session).toContain(strings.devices.activity.screens['check-details']);
    expect(session).toContain('f431e2a4');

    // "Walk-up in progress · checking identity" — the case that had no line at all.
    const walkUp = screen.getByTestId(`device-activity-${WALK_UP.id}`).textContent ?? '';
    expect(walkUp).toMatch(/walk-up in progress/i);
    expect(walkUp).toContain(strings.devices.activity.screens.verify.toLowerCase());

    // "Not seen for 3 min" — and the SERVER decided that, not this page.
    expect(screen.getByTestId(`device-activity-${STALE.id}`).textContent).toMatch(/not seen for 3 min/i);

    // Out of use says so, with who and when.
    expect(screen.getByTestId(`device-out-of-use-${OUT_OF_USE.id}`).textContent).toContain(
      'Robin Reception',
    );

    // NO PATIENT ANYWHERE ON THE PAGE. There is nothing in the contract that
    // could carry one; this asserts nothing crept in beside it.
    expect(document.body.textContent).not.toContain('Riley');
  });

  it('says nothing about a tablet with nothing to say — revoked and unpaired carry their own chip', async () => {
    stubFetch([REVOKED]);
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`device-${REVOKED.id}`)).toBeTruthy());
    // A "not seen" line under "Revoked" would be a second sentence saying the
    // same thing, more alarmingly.
    expect(screen.queryByTestId(`device-activity-${REVOKED.id}`)).toBeNull();
    expect(screen.queryByTestId(`return-to-begin-${REVOKED.id}`)).toBeNull();
    expect(screen.queryByTestId(`out-of-use-${REVOKED.id}`)).toBeNull();
  });

  /**
   * RETURN TO BEGIN — the button for a tablet stuck on somebody who has gone,
   * including a walk-up, which recall could never reach.
   *
   * NO CONFIRMATION, deliberately: the person pressing it is standing next to
   * the tablet, has read the line saying what is on it, and the TABLET tells
   * whoever is holding it what happened before it clears. An "are you sure?"
   * between those two things buys nothing.
   */
  it('sends Return to Begin with no confirmation, and says the request landed', async () => {
    stubFetch([ON_BEGIN], () => ({ deviceId: ON_BEGIN.id, commandId: 'c-1', issuedAt: 'now' }));
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`return-to-begin-${ON_BEGIN.id}`)).toBeTruthy());

    fireEvent.click(screen.getByTestId(`return-to-begin-${ON_BEGIN.id}`));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes(`/devices/${ON_BEGIN.id}/return-to-begin`))).toBe(true),
    );
    const sent = calls.find((c) => c.url.includes('return-to-begin'));
    expect(sent?.method).toBe('POST');
    // No body worth having: the act names itself and the actor is the session.
    expect(sent?.body).toEqual({});
    await waitFor(() =>
      expect(screen.getByTestId(`return-to-begin-sent-${ON_BEGIN.id}`)).toBeTruthy(),
    );
  });

  /**
   * OUT OF USE IS RECEPTION'S SWITCH, AND THE SCREEN SAYS HOW IT DIFFERS FROM
   * REVOKE (Carl, 4-5 Sep 2026). The two controls sit next to each other and
   * only one of them costs a rotate and a walk to the device.
   */
  it('takes a tablet out of use and puts it back, and distinguishes itself from Revoke', async () => {
    stubFetch([ON_BEGIN], () => ({ deviceId: ON_BEGIN.id, outOfUse: true }));
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`out-of-use-${ON_BEGIN.id}`)).toBeTruthy());

    const control = screen.getByTestId(`out-of-use-${ON_BEGIN.id}`);
    expect(control.textContent).toContain(strings.devices.outOfUseAction);
    // The hint draws the distinction the two controls need drawn.
    expect(control.getAttribute('title')).toMatch(/credential is untouched/i);
    expect(control.getAttribute('title')).toMatch(/unlike Revoke/i);

    fireEvent.click(control);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/out-of-use'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/out-of-use'))?.body).toEqual({ outOfUse: true });
  });

  it('offers Put back in use on an inactive tablet, and reverses exactly the one boolean', async () => {
    stubFetch([OUT_OF_USE], () => ({ deviceId: OUT_OF_USE.id, outOfUse: false }));
    render(<DevicesView practiceId={PRACTICE} />);
    await waitFor(() => expect(screen.getByTestId(`out-of-use-${OUT_OF_USE.id}`)).toBeTruthy());

    const control = screen.getByTestId(`out-of-use-${OUT_OF_USE.id}`);
    expect(control.textContent).toContain(strings.devices.backInUseAction);
    fireEvent.click(control);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/out-of-use'))).toBe(true));
    expect(calls.find((c) => c.url.includes('/out-of-use'))?.body).toEqual({ outOfUse: false });
  });
});

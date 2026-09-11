/**
 * The Kiosk card on `/practice/channels` — the regression this guards
 * against is Carl's own report: the card said "NOT BUILT YET — nothing to
 * pair yet" long after tablet pairing shipped and a tablet was actually
 * paired, because the card carried its own copy instead of reading the
 * `/devices` list the setup hub's Tablets card reads. This asserts the two
 * can no longer disagree, and that the stale copy is gone for good.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChannelsView } from './ChannelsView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

const PRACTICE_CONFIG = {
  id: PRACTICE,
  senderIdRegistered: true,
  linkExpiryHours: 24,
  identifierTypes: ['name', 'date_of_birth', 'address'],
  /** Seconds on the wire; the page shows minutes. Two, so the conversion is visible. */
  kioskIdleTimeoutSeconds: 120,
};

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: [], practiceId: PRACTICE, consoleRole: 'admin' }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
}));

/**
 * THE D6a LIST, AND IT IS DELIBERATELY NOT THE REAL ONE.
 *
 * The shipped content file holds "General practitioner attendance" and four
 * others. If this stub served those, a component that had quietly hardcoded
 * them would pass — so the stub serves words no mapping has ever held, and the
 * tests below assert the screen shows exactly these and none of the real ones.
 */
const D6A_SETTINGS = {
  version: 'test-mapping-9',
  descriptions: ['Zed sample attendance', 'Alpha sample attendance'],
  defaultDescription: null as string | null,
};

interface D6aStub {
  settings?: unknown;
  settingsOk?: boolean;
  pending?: unknown;
  pendingOk?: boolean;
  /** What `PUT /service-descriptions/default` answers. */
  putStatus?: number;
  putMessage?: string;
}

function stubFetch(devices: Array<{ state: string }>, devicesOk = true, d6a: D6aStub = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/devices')) {
        return devicesOk
          ? ({ ok: true, status: 200, json: async () => ({ devices, minimumKioskBuild: null }) } as unknown as Response)
          : ({ ok: false, status: 403, json: async () => ({ message: 'refused' }) } as unknown as Response);
      }
      if (url.endsWith('/service-descriptions/settings')) {
        const ok = d6a.settingsOk ?? true;
        return {
          ok,
          status: ok ? 200 : 403,
          json: async () => (ok ? (d6a.settings ?? D6A_SETTINGS) : { message: 'refused' }),
        } as unknown as Response;
      }
      if (url.endsWith('/service-descriptions/pending')) {
        const ok = d6a.pendingOk ?? true;
        return {
          ok,
          status: ok ? 200 : 403,
          json: async () => (ok ? (d6a.pending ?? []) : { message: 'refused' }),
        } as unknown as Response;
      }
      if (url.endsWith('/service-descriptions/default') && init?.method === 'PUT') {
        const status = d6a.putStatus ?? 200;
        return {
          ok: status < 400,
          status,
          json: async () =>
            status < 400
              ? { defaultDescription: JSON.parse(init.body as string).description, mappingVersion: D6A_SETTINGS.version }
              : { message: d6a.putMessage ?? 'refused' },
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => PRACTICE_CONFIG } as unknown as Response;
    }),
  );
}

describe('the Kiosk card — read from the devices list, never its own claim', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a live paired/revoked count and DONE once at least one tablet is paired', async () => {
    stubFetch([{ state: 'paired' }, { state: 'paired' }, { state: 'revoked' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByText('2 tablets paired · 1 revoked')).toBeTruthy());
    expect(screen.getByText(strings.channels.kioskDone)).toBeTruthy();

    // The stale claim never appears again.
    expect(document.body.textContent ?? '').not.toMatch(/not built yet/i);
    expect(document.body.textContent ?? '').not.toMatch(/nothing to pair yet/i);
  });

  it('says "no tablet paired yet" and NEEDS WORK when the practice has none', async () => {
    stubFetch([]);
    render(<ChannelsView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByText(strings.channels.kioskNone)).toBeTruthy());
    expect(screen.getByText(strings.channels.kioskNeedsWork)).toBeTruthy();
  });

  it('never guesses a count it cannot see — a refused fetch says so instead of "0 paired"', async () => {
    stubFetch([], false);
    render(<ChannelsView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByText(strings.channels.kioskUnavailable)).toBeTruthy());
    expect(screen.queryByText('0 tablets paired · 0 revoked')).toBeNull();
    expect(screen.getByText(strings.channels.kioskNeedsWork)).toBeTruthy();
  });

  it('links to the tablets, gated the same way the hub gates it', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const link = (await screen.findByTestId('channels-manage-tablets')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/devices');
    expect(link.textContent).toContain(strings.channels.kioskManage);
  });
});

/**
 * THE INACTIVITY RESET, SET IN MINUTES AND STORED IN SECONDS (Carl, 4 Sep
 * 2026). The conversion is the whole of what can go wrong here: a page that
 * saved minutes as seconds would silently give every tablet in the practice a
 * two-second timeout, which is hard rule 8 broken by a units bug — nobody
 * could finish the ceremony at that tablet.
 */
describe('the kiosk inactivity reset field', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the practice setting in MINUTES and saves it back in SECONDS', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const input = (await screen.findByTestId('channels-idle-minutes')) as HTMLInputElement;
    // 120 seconds arrived; two minutes is shown.
    await waitFor(() => expect(input.value).toBe('2'));

    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('channels-save'));

    await waitFor(() => {
      const patch = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as RequestInit).body as string);
      expect(body.kioskIdleTimeoutSeconds).toBe(420);
    });
  });

  it('falls back to five minutes rather than to an empty box when the server says nothing', async () => {
    /*
     * AN EMPTY BOX WOULD READ AS "NO TIMEOUT", which is the one thing this
     * setting may never mean — so an older core that does not carry the field
     * shows the default, not a blank.
     */
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/devices')) {
          return { ok: true, status: 200, json: async () => ({ devices: [] }) } as unknown as Response;
        }
        const { kioskIdleTimeoutSeconds: _omitted, ...withoutIt } = PRACTICE_CONFIG;
        return { ok: true, status: 200, json: async () => withoutIt } as unknown as Response;
      }),
    );
    render(<ChannelsView practiceId={PRACTICE} />);

    const input = (await screen.findByTestId('channels-idle-minutes')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('5'));
  });

  it('will not save a number outside the range the server would refuse', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const input = (await screen.findByTestId('channels-idle-minutes')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('2'));

    for (const refused of ['0', '31', '', '2.5']) {
      fireEvent.change(input, { target: { value: refused } });
      expect((screen.getByTestId('channels-save') as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(input, { target: { value: '30' } });
    expect((screen.getByTestId('channels-save') as HTMLButtonElement).disabled).toBe(false);
  });
});

/**
 * THE PRACTICE'S DEFAULT BASIC SERVICE DESCRIPTION (Carl, 5 Sep 2026; GA-PLAN
 * B10). One setting, and three ways it could go wrong that matter:
 *
 *  - The words could come from this codebase instead of the versioned content
 *    the rules engine matches, and would then go stale silently (hard rule 14)
 *    until a patient's tablet refused an agreement nobody could explain.
 *  - The server's 403 for an unattributed caller could be swallowed and shown
 *    as a generic failure, hiding the one sentence that says what to do — a
 *    setting deciding a particular of every future agreement is recorded
 *    against the person who changed it, or it is refused.
 *  - Saving could look like it fixed the drafts already waiting. It does not
 *    touch them, on purpose, so the screen has to say how many still need one
 *    and where they are.
 */
describe('the default service description', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('default_d6a_options_come_from_the_versioned_list_not_code', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const select = (await screen.findByTestId('channels-d6a')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(D6A_SETTINGS.descriptions.length + 1));

    // "No default" first, then the server's list IN THE SERVER'S ORDER — file
    // order is screen order, and it is not sorted here.
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      strings.channels.d6aNone,
      'Zed sample attendance',
      'Alpha sample attendance',
    ]);
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '',
      'Zed sample attendance',
      'Alpha sample attendance',
    ]);

    // Not one word of the real shipped mapping is in this component.
    expect(document.body.textContent ?? '').not.toContain('General practitioner attendance');
    // And the version travels with the words, on screen.
    expect(screen.getByText(strings.channels.d6aVersion('test-mapping-9'))).toBeTruthy();
  });

  it('saves the chosen description, and clearing it sends an explicit null', async () => {
    stubFetch([{ state: 'paired' }]);
    render(<ChannelsView practiceId={PRACTICE} />);

    const select = (await screen.findByTestId('channels-d6a')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Alpha sample attendance' } });
    fireEvent.click(screen.getByTestId('channels-d6a-save'));

    await waitFor(() => expect(screen.getByText(strings.channels.d6aSaved)).toBeTruthy());
    const put = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(String(put![0])).toMatch(/\/service-descriptions\/default$/);
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
      description: 'Alpha sample attendance',
    });

    // "No default" is a choice, not a blank — it clears the setting.
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByTestId('channels-d6a-save'));
    await waitFor(() => {
      const puts = vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
      expect(puts).toHaveLength(2);
      expect(JSON.parse((puts[1][1] as RequestInit).body as string)).toEqual({ description: null });
    });
  });

  it('default_d6a_save_shows_the_servers_refusal_when_unattributed', async () => {
    const refusal =
      'A practice setting that decides a particular of every future agreement is recorded against the ' +
      'person who changed it. This request carries no signed-in user, so it is refused.';
    stubFetch([{ state: 'paired' }], true, { putStatus: 403, putMessage: refusal });
    render(<ChannelsView practiceId={PRACTICE} />);

    const select = (await screen.findByTestId('channels-d6a')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Zed sample attendance' } });
    fireEvent.click(screen.getByTestId('channels-d6a-save'));

    // THE SERVER'S OWN SENTENCE, whole — not "403", and not a paraphrase that
    // loses the reason.
    const shown = await screen.findByTestId('channels-d6a-error');
    expect(shown.textContent).toContain(refusal);
    expect(screen.queryByText(strings.channels.d6aSaved)).toBeNull();
  });

  it('default_d6a_shows_how_many_rows_still_need_one', async () => {
    stubFetch([{ state: 'paired' }], true, {
      pending: [{ agreementId: 'a-1' }, { agreementId: 'a-2' }],
    });
    render(<ChannelsView practiceId={PRACTICE} />);

    fireEvent.change(await screen.findByTestId('channels-d6a'), {
      target: { value: 'Zed sample attendance' },
    });
    fireEvent.click(screen.getByTestId('channels-d6a-save'));
    await waitFor(() => expect(screen.getByText(strings.channels.d6aSaved)).toBeTruthy());

    const notice = screen.getByTestId('channels-d6a-pending');
    expect(notice.textContent).toContain(strings.channels.d6aPending(2));
    // A link that lands on the rows, never a sentence telling somebody to go
    // and find a screen.
    const link = screen.getByTestId('channels-d6a-pending-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/practice/tablet');

    // AND NOTHING WAS BULK-APPLIED. Saving a default must not reach into
    // drafts that already exist — that would be this screen deciding a
    // particular of contracts drafted for named patients.
    const applied = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('/service-descriptions/agreements/'));
    expect(applied).toHaveLength(0);
  });

  it('withdraws the control rather than offering an empty list it could save from', async () => {
    stubFetch([{ state: 'paired' }], true, { settingsOk: false });
    render(<ChannelsView practiceId={PRACTICE} />);

    await waitFor(() => expect(screen.getByText(strings.channels.d6aUnavailable)).toBeTruthy());
    expect(screen.queryByTestId('channels-d6a')).toBeNull();
    expect(screen.queryByTestId('channels-d6a-save')).toBeNull();
  });
});

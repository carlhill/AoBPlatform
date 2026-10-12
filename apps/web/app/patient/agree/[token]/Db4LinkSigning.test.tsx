/**
 * A DB4 SENT TO THE PATIENT'S PHONE IS THE TABLET'S DB4 (TELEHEALTH-PLAN §8
 * step 1, 12 Oct 2026).
 *
 * WHAT THESE PIN:
 *   - The link page draws the KIOSK's own screens for a DB4 — the `db4-form`
 *     section, page turns and ticks are `ParticularsScreen`'s, the pen is
 *     `SignatureScreen`'s — and not the general summary (wow.md §10 item 4:
 *     reuse proved by a test that fails when somebody forks it).
 *   - Hard rule 2: the signature control cannot enable from an unlocked payload,
 *     on the link exactly as on the tablet.
 *   - Hard rule 4 as narrowed: the amount is drawn as PracSoft printed it, and
 *     the general page's "no dollar amount" line is not drawn beside it.
 *   - Hard rule 1: only the masked number reaches the page.
 *   - Nothing tells a person on a phone to "see reception".
 *   - A refusal names the server's code (wow.md §13); a code with no line is
 *     shown as itself.
 *
 * Every identity here is obviously fake, and the only card number is the mask.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Db4FormView } from '@aobplatform/contracts';
import { AgreeView } from './AgreeView';
import { strings } from '../../../strings';

const TOKEN = 'tok-db4-example';
const MASKED = '••• ••••• 1';
const STATEMENTS = [
  { key: 'episodic_details_correct_v1', text: 'The details on this form are correct.' },
  { key: 'episodic_assign_v1', text: 'I assign my right to the benefit to the practitioner.' },
];

const DB4: Db4FormView = {
  formReference: 'TST0000012102026120300',
  serviceDate: '2026-10-12',
  servicingLocationName: 'Testville Family Medical Practice',
  servicingLocationAddressLines: ['78 Test Street', 'Testville NSW 2000'],
  patient: {
    givenNames: 'Alex',
    familyName: 'Testpatient',
    dateOfBirth: '1965-10-10',
    address: '18 Example St, Testville NSW 2000',
    patientRecordNumber: '00680',
    // eslint-disable-next-line no-restricted-syntax -- the masked string, the only form the page receives.
    medicareCardNumberMasked: MASKED,
    irn: '1',
  },
  providers: [{ role: 'servicing', name: 'Dr Sam Example', providerNumber: '0000000T' }],
  services: [{ serviceDate: '2026-10-12', mbsItemNumber: '23', description: 'Level B Surgery', benefitAssigned: '45.05' }],
  privacyNotice: ['Your personal information is protected by law.'],
  statements: [{ key: 'assign_to_health_professional', text: 'I assign my right to benefits.' }],
  sourceSha256: 'e'.repeat(64),
  printJobId: '7c3f9a21-0000-4000-8000-000000000001',
  parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
};

function readBody(gate: Partial<Record<string, unknown>> = {}) {
  return {
    state: 'ready',
    particulars: {
      practiceName: 'Sample Practice',
      providerName: 'Dr Sam Example',
      agreementType: 'episodic_post',
      agreementDate: '2026-10-12',
      serviceDate: '2026-10-12',
      mbsItemNumbers: ['23'],
      patientName: 'Alex Testpatient',
      assignorIsPatient: true,
      assignorName: null,
      assignorRelationship: null,
      artefactSha256: 'd'.repeat(64),
    },
    statements: STATEMENTS,
    templateVersion: 'episodic-generic-1',
    db4Form: DB4,
    gate: {
      status: 'awaiting_signature',
      particularsPresent: true,
      particularsLockedAt: '2026-10-12T00:00:00.000Z',
      ruleSetVersion: 'test-rules-1',
      mappingVersion: 'test-mapping-1',
      renderedArtefactHash: 'd'.repeat(64),
      ...gate,
    },
    providerAddress: null,
    basicServiceDescription: null,
  };
}

type Approve = { status: number; body: unknown };
let approveCalls: { url: string; body: Record<string, unknown> }[] = [];

function stubServer(read: unknown, approve: Approve = { status: 201, body: { approved: true, writtenBack: false } }) {
  approveCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/approve')) {
        approveCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        return { ok: approve.status < 300, status: approve.status, json: async () => approve.body } as unknown as Response;
      }
      const body = url.endsWith(`/capture/link/${TOKEN}`)
        ? { identifierTypes: ['name', 'date_of_birth', 'address'] }
        : url.endsWith('/verify')
          ? { outcome: 'passed' }
          : read;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
}

/** Open the link and answer the three identifiers — the page's own gate. */
async function reachTheForm(read: unknown, approve?: Approve) {
  stubServer(read, approve);
  render(<AgreeView token={TOKEN} />);
  fireEvent.change(await screen.findByTestId('agree-family'), { target: { value: 'Testpatient' } });
  fireEvent.change(screen.getByTestId('agree-given'), { target: { value: 'Alex' } });
  fireEvent.change(screen.getByTestId('agree-dob'), { target: { value: '1965-10-10' } });
  fireEvent.change(screen.getByTestId('agree-address'), { target: { value: '18 Example St, Testville NSW 2000' } });
  fireEvent.click(screen.getByTestId('agree-verify'));
  await screen.findByTestId('db4-form');
}

/** Turn every page, ticking each box as it appears, and stop on the last page. */
function readEveryPageAndTick() {
  for (let guard = 0; guard < 6; guard++) {
    for (const statement of STATEMENTS) {
      const box = screen.queryByTestId(`affirm-${statement.key}`) as HTMLInputElement | null;
      if (box && !box.checked && box.getAttribute('aria-checked') !== 'true') fireEvent.click(box);
    }
    const next = screen.queryByTestId('db4-page-continue');
    if (!next) return;
    fireEvent.click(next);
  }
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the link page shows the DB4 sheets', () => {
  it('link_page_draws_the_kiosk_db4_sheets_not_a_copy', async () => {
    await reachTheForm(readBody());
    // The kiosk's own section and page line, and not the general summary.
    expect(screen.getByTestId('db4-form')).toBeTruthy();
    expect(screen.getByTestId('db4-page-of')).toBeTruthy();
    expect(screen.queryByTestId('agree-particulars')).toBeNull();
    expect(screen.queryByTestId('agree-approve')).toBeNull();
  });

  it('the_amount_is_drawn_as_printed_and_no_amount_line_is_not (hard rule 4 as narrowed)', async () => {
    await reachTheForm(readBody());
    readEveryPageAndTick();
    // Back to the services page, where the row is.
    while (screen.queryByTestId('db4-page-back')) fireEvent.click(screen.getByTestId('db4-page-back'));
    fireEvent.click(screen.getByTestId('db4-page-continue'));
    expect(screen.getByTestId('db4-services').textContent).toContain('45.05');
    expect(screen.queryByText(strings.agree.noAmount)).toBeNull();
  });

  it('only_the_masked_card_number_reaches_the_link_page (hard rule 1)', async () => {
    await reachTheForm(readBody());
    expect(document.body.textContent).toContain(MASKED);
  });

  it('link_signature_control_cannot_enable_before_lock (hard rule 2)', async () => {
    await reachTheForm(readBody({ particularsLockedAt: null }));
    readEveryPageAndTick();
    const proceed = screen.getByTestId('continue-to-sign') as HTMLButtonElement;
    expect(proceed.disabled || proceed.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('the_ticks_and_the_tap_go_to_the_link_endpoint_and_nothing_else', async () => {
    await reachTheForm(readBody());
    readEveryPageAndTick();
    fireEvent.click(screen.getByTestId('continue-to-sign'));

    // The pen is the kiosk's: the pad, and a drawn signature shut until there is ink.
    expect(screen.getByTestId('signature-pad')).toBeTruthy();
    const drawn = screen.getByTestId('sign-control') as HTMLButtonElement;
    expect(drawn.disabled || drawn.getAttribute('aria-disabled') === 'true').toBe(true);

    fireEvent.click(screen.getByTestId('sign-control-tap'));
    await screen.findByText(strings.agree.doneTitle);

    expect(approveCalls).toHaveLength(1);
    expect(approveCalls[0].url).toContain(`/agree/${TOKEN}/approve`);
    expect(approveCalls[0].body.method).toBe('tap_to_approve');
    expect([...(approveCalls[0].body.affirmations as string[])].sort()).toEqual(STATEMENTS.map((s) => s.key).sort());
    // The link is named by its token; no capture id and no amount travel.
    expect(approveCalls[0].body).not.toHaveProperty('captureRequestId');
    expect(JSON.stringify(approveCalls[0].body)).not.toContain('45.05');
  });

  it('nothing_on_the_link_sends_a_person_to_reception', async () => {
    await reachTheForm(readBody());
    expect(screen.queryByTestId('leave-for-reception')).toBeNull();
    readEveryPageAndTick();
    fireEvent.click(screen.getByTestId('continue-to-sign'));
    expect(screen.queryByTestId('leave-for-reception')).toBeNull();
    expect(screen.queryByTestId('signature-who-see-reception')).toBeNull();
    expect(screen.getByTestId('signature-who-wrong').textContent).toBe(strings.link.db4.whoNotRight);
  });

  it('a_refusal_names_the_servers_reason_and_offers_the_way_back_only_where_it_is_true', async () => {
    await reachTheForm(readBody(), { status: 400, body: { reason: 'affirmations_missing' } });
    readEveryPageAndTick();
    fireEvent.click(screen.getByTestId('continue-to-sign'));
    fireEvent.click(screen.getByTestId('sign-control-tap'));
    const reason = await screen.findByTestId('link-db4-refused-reason');
    expect(reason.textContent).toBe(strings.link.db4.reasons.affirmations_missing);
    fireEvent.click(screen.getByTestId('link-db4-sign-again'));
    await waitFor(() => expect(screen.getByTestId('db4-form')).toBeTruthy());
  });

  it('an_unmapped_refusal_shows_its_code_and_no_remedy', async () => {
    await reachTheForm(readBody(), { status: 400, body: { reason: 'something_new' } });
    readEveryPageAndTick();
    fireEvent.click(screen.getByTestId('continue-to-sign'));
    fireEvent.click(screen.getByTestId('sign-control-tap'));
    const reason = await screen.findByTestId('link-db4-refused-reason');
    expect(reason.textContent).toBe(strings.link.db4.unmapped('something_new'));
    expect(screen.queryByTestId('link-db4-sign-again')).toBeNull();
  });

  it('an_agreement_with_no_db4_keeps_the_general_page', async () => {
    const general = { ...readBody(), db4Form: null };
    stubServer(general);
    render(<AgreeView token={TOKEN} />);
    fireEvent.change(await screen.findByTestId('agree-family'), { target: { value: 'Testpatient' } });
    fireEvent.change(screen.getByTestId('agree-given'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByTestId('agree-dob'), { target: { value: '1965-10-10' } });
    fireEvent.change(screen.getByTestId('agree-address'), { target: { value: '18 Example St' } });
    fireEvent.click(screen.getByTestId('agree-verify'));
    await screen.findByTestId('agree-particulars');
    expect(screen.queryByTestId('db4-form')).toBeNull();
  });

  it('never_claims_certification_or_approval in the link.db4 copy (hard rule 12)', () => {
    const words = JSON.stringify(
      Object.fromEntries(
        Object.entries(strings.link.db4).map(([k, v]) => [k, typeof v === 'function' ? v('code') : v]),
      ),
    ).toLowerCase();
    for (const banned of ['certified', 'approved', 'accredited', 'government-approved']) {
      expect(words).not.toContain(banned);
    }
  });
});

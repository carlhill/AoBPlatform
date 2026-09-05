/**
 * `/practice/templates` — the letterhead a practice can see but not edit, the
 * logo it owns, and wording it may propose but not activate (Carl, 5 Sep 2026;
 * PMS_to_AoB_Workflow.md W1).
 *
 * WHAT THESE PIN. That the letterhead is READ from the practice record and the
 * page says where it comes from rather than offering to edit it; that the
 * page never offers an Activate control, because activating is not a thing a
 * practice does; that the server's refusal is shown verbatim, because it names
 * the line and the rule and a paraphrase would take away the actionable half;
 * and that removing a logo says what happens to agreements already signed.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TemplatesView } from './TemplatesView';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: [], practiceId: PRACTICE, consoleRole: 'admin' }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE }),
}));

const LETTERHEAD = {
  letterhead: {
    legalName: 'Testville Family Medical Pty Ltd',
    tradingName: 'Testville Family Medical',
    address: '1 Test Street, Testville NSW 2000',
    phone: '(02) 5550 0000',
    email: 'reception@testville.example',
    abn: '12 345 678 901',
  },
  letterheadHash: 'a'.repeat(64),
  logo: null as null | Record<string, unknown>,
};

/**
 * THE WORDS ARE DELIBERATELY NOT THE SHIPPED ONES. They are versioned content
 * served by the API, so a stub carrying the real sentences would let a
 * component that had hardcoded them pass.
 */
const GENERIC = {
  id: 'episodic-generic',
  version: 'episodic-generic-1',
  agreementType: 'episodic' as const,
  status: 'draft_pending_review',
  title: 'Sample agreement title',
  sections: [{ key: 'parties', heading: 'Sample heading', paragraphs: ['Sample paragraph {{patientName}}'] }],
  statements: [{ key: 'sample_v1', text: 'Sample statement.' }],
  footer: ['Sample footer.'],
};

const TEMPLATES = {
  contentVersion: 'agreement-templates-test-1',
  generic: [GENERIC, { ...GENERIC, id: 'enduring-generic', version: 'enduring-generic-1', agreementType: 'enduring' as const }],
  placeholders: ['patientName', 'providerName'],
  conditions: ['assignorIsPatient', 'isPreAgreement'],
  variants: [] as unknown[],
};

function stubFetch(options: { letterhead?: unknown; templates?: unknown; proposeStatus?: number; proposeMessage?: string } = {}) {
  const posted: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/practices/letterhead')) {
        return { ok: true, status: 200, json: async () => options.letterhead ?? LETTERHEAD } as unknown as Response;
      }
      if (url.endsWith('/agreement-templates') && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => options.templates ?? TEMPLATES } as unknown as Response;
      }
      if (url.endsWith('/agreement-templates') && init?.method === 'POST') {
        posted.push({ url, body: JSON.parse(String(init.body)) });
        const status = options.proposeStatus ?? 201;
        return {
          ok: status < 400,
          status,
          json: async () => (status < 400 ? { id: 'variant-1' } : { message: options.proposeMessage }),
        } as unknown as Response;
      }
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }),
  );
  return posted;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the letterhead is shown, not edited', () => {
  it('renders every field the agreement will print, and says where they come from', async () => {
    stubFetch();
    render(<TemplatesView practiceId={PRACTICE} />);
    await screen.findByTestId('letterhead-fields');

    expect(screen.getByText('Testville Family Medical Pty Ltd')).toBeTruthy();
    expect(screen.getByText('1 Test Street, Testville NSW 2000')).toBeTruthy();
    expect(screen.getByText('ABN 12 345 678 901')).toBeTruthy();
    expect(screen.getByText(strings.templates.letterheadWhereFrom)).toBeTruthy();

    // No input for any of them — a letterhead editable here is a letterhead
    // free to disagree with the register.
    const inputs = [...document.querySelectorAll('input')].map((i) => i.getAttribute('type'));
    expect(inputs).toEqual(['file']);
  });

  it('says what removing the logo does to agreements already signed', async () => {
    stubFetch({
      letterhead: {
        ...LETTERHEAD,
        logo: { sha256: 'b'.repeat(64), contentType: 'image/png', widthPx: 400, heightPx: 120, updatedAt: null, updatedBy: null },
      },
    });
    render(<TemplatesView practiceId={PRACTICE} />);
    await screen.findByTestId('logo-detail');
    expect(screen.getByTestId('logo-clear')).toBeTruthy();
    expect(screen.getByText(strings.templates.logoKeepsWorking)).toBeTruthy();
  });
});

describe('practice_console_never_offers_to_activate_wording', () => {
  it('offers propose, submit and withdraw — and no activation anywhere', async () => {
    stubFetch();
    render(<TemplatesView practiceId={PRACTICE} />);
    await screen.findByTestId('wording-episodic');

    fireEvent.click(screen.getByTestId('propose-episodic'));
    expect(screen.getByTestId('submit-for-review')).toBeTruthy();
    expect(screen.getByTestId('save-draft')).toBeTruthy();

    // The page says the review happens, and offers no control that would do it.
    expect(screen.getByText(strings.templates.wordingReviewed)).toBeTruthy();
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(buttons.some((label) => /activate/i.test(label))).toBe(false);
  });

  it('shows the server’s refusal verbatim — it names the line and the rule', async () => {
    stubFetch({
      proposeStatus: 400,
      proposeMessage:
        "This practice's episodic wording (our-1): it never renders {{serviceDate}}. Every episodic " +
        'agreement must carry the whole data set.',
    });
    render(<TemplatesView practiceId={PRACTICE} />);
    await screen.findByTestId('wording-episodic');

    fireEvent.click(screen.getByTestId('propose-episodic'));
    fireEvent.change(screen.getByTestId('variant-version'), { target: { value: 'our-1' } });
    fireEvent.click(screen.getByTestId('save-draft'));

    await waitFor(() => expect(screen.getByText(/never renders \{\{serviceDate\}\}/)).toBeTruthy());
  });

  it('says which wording is in use, and shows the standard words read-only', async () => {
    stubFetch();
    render(<TemplatesView practiceId={PRACTICE} />);
    await screen.findByTestId('wording-episodic');
    expect(screen.getByText(strings.templates.usingGenericWording('episodic-generic-1'))).toBeTruthy();
    expect(screen.getByText(strings.templates.showGeneric('episodic-generic-1'))).toBeTruthy();
  });

  it('says the reviewer’s notes back to the practice, verbatim', async () => {
    stubFetch({
      templates: {
        ...TEMPLATES,
        variants: [
          {
            id: 'variant-1',
            agreementType: 'episodic',
            version: 'our-1',
            status: 'draft',
            body: GENERIC,
            notes: null,
            submittedByName: 'Mai Frontdesk',
            submittedAt: '2026-09-05T01:00:00.000Z',
            reviewedByName: 'Sam Reviewer',
            reviewNotes: 'The second statement reads as advice. Please reword it.',
            activatedAt: null,
          },
        ],
      },
    });
    render(<TemplatesView practiceId={PRACTICE} />);
    const notes = await screen.findByTestId('review-notes');
    expect(notes.textContent).toContain('The second statement reads as advice.');
    expect(notes.textContent).toContain('Sam Reviewer');
  });
});

describe('no amount and no approval claim in the console copy', () => {
  it('never says certified, approved or accredited about our forms, and shows no amount', async () => {
    stubFetch();
    render(<TemplatesView practiceId={PRACTICE} />);
    await screen.findByTestId('letterhead-fields');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\bcertified\b|\baccredited\b|government-approved/i);
    expect(text).not.toMatch(/\$|\bAUD\b|\bdollars?\b/i);
    // The permitted phrase, and the page uses it.
    expect(text).toContain('checked against the s 65C data set');
  });
});

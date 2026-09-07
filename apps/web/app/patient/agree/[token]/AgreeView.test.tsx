/**
 * THE REMOTE LINK SAYS WHO IS SIGNING TOO (Carl, 7 Sep 2026).
 *
 * K-4 on the tablet was the fault Carl found — "did not ask who is signing" —
 * and this page had exactly the same silence. It is not a lesser surface: the
 * server refuses a signature here on the same terms it refuses one on glass, so
 * the person approving is entitled to the same sentence.
 *
 * IT STATES AND DOES NOT ASK. The particulars are locked, validated and hashed
 * before this page can draw (hard rule 2, REQ-REG-06). There is no control here
 * that could move D7 and there must never be one; changing who signs is the
 * practice's, by correct then supersede.
 *
 * AND IT SAYS NOTHING WHEN THE RECORD DOES NOT SAY. `assignorIsPatient` is
 * `null` only if a locked payload somehow carries no D7 at all — in which case
 * silence is the honest answer and a confident "the patient is signing" would
 * be the worst possible failure of a feature that exists to state this.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgreeView } from './AgreeView';
import { strings } from '../../../strings';

const TOKEN = 'tok-example';

/** Obviously fake, and carrying no Medicare number — there is no field for one. */
const PARTICULARS = {
  practiceName: 'Sample Practice',
  providerName: 'Dr Example Provider',
  agreementType: 'episodic_post',
  agreementDate: '2026-09-07',
  serviceDate: '2026-09-07',
  mbsItemNumbers: ['23'],
  patientName: 'Alex Fictional',
  assignorIsPatient: true as boolean | null,
  assignorName: null as string | null,
  assignorRelationship: null as string | null,
  artefactSha256: 'a'.repeat(64),
};

/**
 * Drives the real page: open the link, answer the three identifiers, and land
 * on the agreement. The identifier step is the page's own gate — there is no
 * way to reach the particulars without passing it, which is the point.
 */
function stubServer(particulars: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.endsWith(`/capture/link/${TOKEN}`)
        ? { identifierTypes: ['name', 'date_of_birth', 'address'] }
        : url.endsWith('/verify')
          ? { outcome: 'passed' }
          : { particulars, statements: [] };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
}

async function reachTheAgreement(particulars: Record<string, unknown>): Promise<void> {
  stubServer(particulars);
  render(<AgreeView token={TOKEN} />);

  // The identifiers, then the agreement. Awaiting the FIELD rather than the
  // form: the fields are drawn from `identifierTypes`, which arrives on its own
  // fetch (wow.md section 2 item 6).
  const family = await screen.findByTestId('agree-family');
  fireEvent.change(family, { target: { value: 'Fictional' } });
  fireEvent.change(screen.getByTestId('agree-given'), { target: { value: 'Alex' } });
  fireEvent.change(screen.getByTestId('agree-dob'), { target: { value: '1988-03-09' } });
  fireEvent.change(screen.getByTestId('agree-address'), {
    target: { value: '7 Sample Road, Sampletown NSW 2000' },
  });
  fireEvent.click(screen.getByTestId('agree-verify'));

  await waitFor(() => expect(screen.getByTestId('agree-particulars')).toBeTruthy());
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('signature_screen_names_who_is_signing', () => {
  it('the remote link names the patient before anything can be approved', async () => {
    await reachTheAgreement(PARTICULARS);

    expect(screen.getByTestId('agree-who').textContent).toBe(
      strings.kiosk.signature.signingByPatient('Alex Fictional'),
    );
    /*
     * ITS OWN "IF THIS IS NOT RIGHT" LINE. The words above are the kiosk's, so
     * one act is described one way; this one cannot be, because "see reception"
     * means a person a metre away and there is nobody at all beside somebody
     * opening a link at home.
     */
    expect(screen.getByTestId('agree-who-wrong').textContent).toBe(strings.agree.whoNotRight);
  });
});

describe('signature_screen_names_the_assignor_and_relationship_when_not_the_patient', () => {
  it('names the assignor, the patient and the relationship', async () => {
    await reachTheAgreement({
      ...PARTICULARS,
      assignorIsPatient: false,
      assignorName: 'Kim Fictional',
      assignorRelationship: 'Mother',
    });

    const line = screen.getByTestId('agree-who').textContent ?? '';
    expect(line).toBe(strings.kiosk.signature.signingByOther('Kim Fictional', 'Alex Fictional', 'Mother'));
    expect(line).toContain('Kim Fictional');
    expect(line).toContain('Alex Fictional');
    expect(line).toContain('Mother');
  });

  /* A key-shaped value from an older record still reads as a word — the same
     one lookup the tablet uses (`relationshipLabel`), so the two surfaces cannot
     print different words for one legal footing. */
  it('renders a relationship key through the string table', async () => {
    await reachTheAgreement({
      ...PARTICULARS,
      assignorIsPatient: false,
      assignorName: 'Kim Fictional',
      assignorRelationship: 'family_member',
    });

    const line = screen.getByTestId('agree-who').textContent ?? '';
    expect(line).toContain(strings.kiosk.assignor.relationshipNames.family_member);
    expect(line).not.toContain('family_member');
  });

  it('says nothing at all when the locked record does not say who signs', async () => {
    await reachTheAgreement({ ...PARTICULARS, assignorIsPatient: null });

    // Silence, not a guess. The particulars are still on screen.
    expect(screen.queryByTestId('agree-who')).toBeNull();
    expect(screen.queryByTestId('agree-who-wrong')).toBeNull();
    expect(screen.getByTestId('agree-particulars')).toBeTruthy();
  });
});

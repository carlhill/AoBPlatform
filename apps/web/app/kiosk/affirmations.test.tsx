/**
 * K-3'S TICK BOXES — the assignor's affirmations (Carl, 5 Sep 2026; W1).
 *
 * WHAT THESE PIN. That the sentences on the tablet are the SERVER'S, not a
 * copy in this repository; that Continue will not open until every one is
 * ticked and says how many are left; and that a tick is a tick rather than a
 * particular — nothing about the locked payload moves, and the keys are what
 * travels to the signature.
 *
 * THE SERVER HOLDS THE SAME LINE, which is why none of this is the whole
 * story: `POST /agreements/:id/sign` refuses a signature that does not carry
 * every statement key of the template the agreement was rendered from
 * (`signature_requires_every_statement_affirmed`, core e2e). This is the
 * courtesy; that is the rule.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { composeSignRequest } from './rules/signature-payload';
import type { SignatureValidation } from './rules/signature-gate';
import { strings } from './strings';

const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };
const noop = () => undefined;

const VALID: SignatureValidation = {
  state: 'valid',
  artefactHash: 'a'.repeat(64),
  ruleSetVersion: 'test-rules-1',
};

/**
 * THE STATEMENTS AS THE SERVER SENDS THEM. Deliberately not the real wording:
 * these words are versioned content and the tablet is only ever a renderer of
 * them, so a test that asserted the shipped sentences would be asserting
 * content rather than behaviour.
 */
const STATEMENTS = [
  { key: 'test_assign_v1', text: 'I assign my right to the Medicare benefit to Dr Sam Example.' },
  { key: 'test_details_v1', text: 'I confirm the details above are correct.' },
];

const VIEW: ParticularsView = {
  agreementType: 'episodic_pre',
  patientName: 'Alex Testpatient',
  providerName: 'Dr Sam Example',
  providerAddress: '1 Test Street, Testville NSW 2000',
  serviceDate: '2026-09-01',
  agreementDate: '2026-09-01',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  particularsLocked: true,
  ruleSetVersion: 'test-rules-1',
  mappingVersion: 'test-mapping-1',
  artefactHash: 'a'.repeat(64),
  statements: STATEMENTS,
  templateVersion: 'episodic-generic-1',
};

/** A thin stand-in for the ceremony, which holds the ticks so Back costs none. */
function renderScreen(onContinue = vi.fn()) {
  let affirmed: string[] = [];
  const view = render(<div />);
  const draw = () =>
    view.rerender(
      <ParticularsScreen
        {...CHROME}
        view={VIEW}
        validation={VALID}
        affirmed={affirmed}
        onToggleAffirmation={(key) => {
          affirmed = affirmed.includes(key) ? affirmed.filter((k) => k !== key) : [...affirmed, key];
          draw();
        }}
        onContinue={onContinue}
        onSeeReception={noop}
      />,
    );
  draw();
  return { view, onContinue, ticked: () => affirmed };
}

describe('the statements come from the server, and Continue waits for all of them', () => {
  it('renders exactly the sentences the lock sent, and no sentence of its own', () => {
    const { view } = renderScreen();
    for (const statement of STATEMENTS) {
      expect(view.getByText(statement.text)).toBeTruthy();
    }
    // The old inline consent sentence is not on the screen beside them.
    expect(view.queryByText(strings.particulars.consentText)).toBeNull();
  });

  it('continue_waits_for_every_statement — and says how many are left', () => {
    const { view } = renderScreen();
    const continueButton = () => view.getByTestId('continue-to-sign');

    expect(continueButton().hasAttribute('disabled')).toBe(true);
    expect(continueButton().textContent).toBe(strings.particulars.continueNotAffirmed(2));

    fireEvent.click(view.getByTestId('affirm-test_assign_v1'));
    expect(continueButton().hasAttribute('disabled')).toBe(true);
    expect(continueButton().textContent).toBe(strings.particulars.continueNotAffirmed(1));

    fireEvent.click(view.getByTestId('affirm-test_details_v1'));
    expect(continueButton().hasAttribute('disabled')).toBe(false);
    expect(continueButton().textContent).toBe(strings.particulars.continueToSign);
  });

  it('un-ticking closes Continue again — the gate is the current state, not a high-water mark', () => {
    const { view } = renderScreen();
    fireEvent.click(view.getByTestId('affirm-test_assign_v1'));
    fireEvent.click(view.getByTestId('affirm-test_details_v1'));
    expect(view.getByTestId('continue-to-sign').hasAttribute('disabled')).toBe(false);

    fireEvent.click(view.getByTestId('affirm-test_details_v1'));
    expect(view.getByTestId('continue-to-sign').hasAttribute('disabled')).toBe(true);
  });

  it('an agreement with no statements behaves exactly as it did before', () => {
    // Locked before the wording became content: nothing to tick, the sentence
    // that agreement was actually shown, and Continue gated only by the gate.
    const view = render(
      <ParticularsScreen
        {...CHROME}
        view={{ ...VIEW, statements: [], templateVersion: null }}
        validation={VALID}
        affirmed={[]}
        onToggleAffirmation={noop}
        onContinue={noop}
        onSeeReception={noop}
      />,
    );
    expect(view.queryByTestId('affirmations')).toBeNull();
    expect(view.getByText(strings.particulars.consentText)).toBeTruthy();
    expect(view.getByTestId('continue-to-sign').hasAttribute('disabled')).toBe(false);
  });

  it('the ticks travel with the signature as KEYS, never as sentences', () => {
    const body = composeSignRequest('tap_to_approve', 'cap-1', null, ['test_assign_v1', 'test_details_v1']);
    expect(body).toEqual({
      method: 'tap_to_approve',
      captureRequestId: 'cap-1',
      affirmations: ['test_assign_v1', 'test_details_v1'],
    });
    expect(JSON.stringify(body)).not.toContain('Medicare benefit');
  });

  it('no amount and no practitioner signature field appear beside the statements', () => {
    const { view } = renderScreen();
    const text = view.container.textContent ?? '';
    expect(text).not.toMatch(/\$|\bAUD\b|practitioner signature|approved|certified|accredited/i);
  });
});

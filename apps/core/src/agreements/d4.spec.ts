import { templateValuesFor } from './agreements.service';

/**
 * D4 — WHO THE BENEFIT IS ASSIGNED TO, s 65C(5) (REQ-REG-02).
 *
 * The statute offers two ways to identify the professional: (a) name and the
 * ADDRESS OF THE PLACE OF PRACTICE, or (b) the PROVIDER NUMBER for that place
 * of practice. Carl's ruling of 5–7 Sep 2026 turns on (a): a servicing
 * provider with no provider number recorded is ALLOWED — flagged on the
 * affiliation screen, never blocked — precisely because (a) identifies them
 * without one.
 *
 * So the no-number case is not an edge case here, it is a supported way to run
 * a practice, and it has a test.
 */
const VALIDATION = { mappingVersion: 'mapping-test-1' };

const base = {
  patientName: 'Alex Testpatient',
  agreementDate: '2026-09-01',
  agreementType: 'episodic_pre',
  serviceDate: '2026-09-01',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
  providerName: 'Dr Sam Example',
};

describe('D4 identifies the provider by name and place, or by number, or by both', () => {
  it('renders name, practice address and the location’s provider number where both are held', () => {
    const { values } = templateValuesFor(
      { ...base, providerAddress: '1 Test Street, Testville NSW 2000', providerNumber: '2222222A' },
      VALIDATION,
    );
    expect(values.providerDetails).toBe('Dr Sam Example, 1 Test Street, Testville NSW 2000, provider number 2222222A');
  });

  /** Carl's second ruling: allowed, and the document says who they are without one. */
  it('renders name and practice address when no provider number is recorded', () => {
    const { values } = templateValuesFor(
      { ...base, providerAddress: '1 Test Street, Testville NSW 2000' },
      VALIDATION,
    );
    expect(values.providerDetails).toBe('Dr Sam Example, 1 Test Street, Testville NSW 2000');
    expect(values.providerDetails).not.toMatch(/provider number/);
  });

  it('falls back to name and number when no place of practice is held', () => {
    const { values } = templateValuesFor({ ...base, providerNumber: '2222222A' }, VALIDATION);
    expect(values.providerDetails).toBe('Dr Sam Example, provider number 2222222A');
  });

  it('never leaves D4 blank', () => {
    const { values } = templateValuesFor(base, VALIDATION);
    expect(values.providerDetails).toBe('Dr Sam Example');
  });

  it('carries no benefit or dollar amount (hard rule 4)', () => {
    const { values } = templateValuesFor(
      { ...base, providerAddress: '1 Test Street, Testville NSW 2000', providerNumber: '2222222A' },
      VALIDATION,
    );
    expect(values.providerDetails).not.toMatch(/\$|amount|benefit/i);
  });
});

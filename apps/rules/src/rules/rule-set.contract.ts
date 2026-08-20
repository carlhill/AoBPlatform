import type { RuleResult } from '@aobplatform/contracts';
import type { RuleSet } from './rule-set';
import type { ValidationPayload } from './rules-payload';

/**
 * The conformance suite every s 65C RuleSet implementation must pass —
 * table-driven from REQ-65C-01 (aob-requirements.md §3). Written FIRST,
 * against the interface, so the human-authored implementation drops in and is
 * verified without new test code.
 *
 * Every expectation here traces to the REQ-65C-01 table. If a rule's
 * behaviour seems wrong, the fix is a conversation with Carl and a doc
 * change — not an edit to this suite to make an implementation pass.
 */
export function ruleSetConformanceTests(makeRuleSet: () => RuleSet): void {
  /** A fully valid episodic PRE-agreement payload (baseline: every rule passes or warns nothing). */
  const validPre = (): ValidationPayload => ({
    patientName: 'Alex Testpatient',
    agreementDate: '2026-09-01',
    agreementType: 'episodic_pre',
    providerName: 'Dr Example Provider',
    providerAddress: '1 Example Street, Sampletown NSW 2000',
    serviceDate: '2026-09-01',
    basicServiceDescription: 'General practitioner attendance',
    assignorIsPatient: true,
    signaturePresent: true,
    signatureMethod: 'drawn',
    signatureTimestamp: '2026-09-01T09:30:00.000Z',
    particularsLockedAt: '2026-09-01T09:29:00.000Z',
    verificationPassed: true,
  });

  /** A fully valid episodic POST-agreement payload. */
  const validPost = (): ValidationPayload => ({
    ...validPre(),
    agreementType: 'episodic_post',
    serviceDate: '2026-08-30',
    basicServiceDescription: undefined,
    mbsItemNumbers: ['23'],
  });

  const outcomeOf = (results: RuleResult[], rule: string): string | undefined =>
    results.find((r) => r.rule === rule)?.outcome;

  let ruleSet: RuleSet;
  beforeEach(() => {
    ruleSet = makeRuleSet();
  });

  describe('baseline', () => {
    it('a fully valid pre-agreement produces no fail outcomes', () => {
      const results = ruleSet.evaluate(validPre());
      expect(results.filter((r) => r.outcome === 'fail')).toEqual([]);
    });

    it('a fully valid post-agreement produces no fail outcomes', () => {
      const results = ruleSet.evaluate(validPost());
      expect(results.filter((r) => r.outcome === 'fail')).toEqual([]);
    });

    it('every result carries a plain-English message (REQ-TEST-06)', () => {
      for (const r of ruleSet.evaluate(validPre())) {
        expect(r.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('C1 — D1 patient name present and non-empty (Block)', () => {
    it.each([[''], ['   '], [undefined]])('fails on %p', (patientName) => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), patientName: patientName as string }), 'C1')).toBe('fail');
    });
  });

  describe('C2 — D2 agreement date present, valid, not future-dated beyond tolerance (Block)', () => {
    it('fails when absent or unparseable', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), agreementDate: undefined }), 'C2')).toBe('fail');
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), agreementDate: 'not-a-date' }), 'C2')).toBe('fail');
    });
    it('fails when future-dated beyond tolerance', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), agreementDate: '2099-01-01' }), 'C2')).toBe('fail');
    });
  });

  describe('C3 — D3 pre/post flag set explicitly (Block)', () => {
    it('fails when the agreement type is absent', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), agreementType: undefined }), 'C3')).toBe('fail');
    });
  });

  describe('C4 — D4 satisfies s 65C(5)(a) OR (b) (Block)', () => {
    it('passes with name+address and no provider number (a provider number is NOT mandatory, REQ-REG-02)', () => {
      const payload = { ...validPre(), providerNumber: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C4')).toBe('pass');
    });
    it('passes with a provider number alone', () => {
      const payload = { ...validPre(), providerName: undefined, providerAddress: undefined, providerNumber: '1234567A' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C4')).toBe('pass');
    });
    it('fails with neither', () => {
      const payload = { ...validPre(), providerName: undefined, providerAddress: undefined, providerNumber: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C4')).toBe('fail');
    });
    it('fails with name but no address (s 65C(5)(a) needs both)', () => {
      const payload = { ...validPre(), providerAddress: undefined, providerNumber: undefined };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C4')).toBe('fail');
    });
  });

  describe('C5 — D5 service date present and consistent with D3 (Block)', () => {
    it('fails when absent', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), serviceDate: undefined }), 'C5')).toBe('fail');
    });
    it('fails a PRE-agreement whose service date is in the past', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), serviceDate: '2020-01-01' }), 'C5')).toBe('fail');
    });
    it('fails a POST-agreement whose service date is in the future', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPost(), serviceDate: '2099-01-01' }), 'C5')).toBe('fail');
    });
  });

  describe('C6 — pre: basic description present and drawn from the current mapping version (Block)', () => {
    it('fails a pre-agreement without a basic service description', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), basicServiceDescription: undefined }), 'C6')).toBe('fail');
    });
    it('fails a description not in the current mapping', () => {
      const payload = { ...validPre(), basicServiceDescription: 'Totally invented category' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C6')).toBe('fail');
    });
    it('does not apply to post-agreements', () => {
      expect(outcomeOf(ruleSet.evaluate(validPost()), 'C6')).not.toBe('fail');
    });
  });

  describe('C7 — post: at least one valid MBS item number (Block)', () => {
    it('fails a post-agreement with no item numbers', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPost(), mbsItemNumbers: [] }), 'C7')).toBe('fail');
    });
    it('fails an item number that is not plausibly an MBS item', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPost(), mbsItemNumbers: ['not-an-item'] }), 'C7')).toBe('fail');
    });
  });

  describe('C8 — D7 assignor flag; if not the patient, name and relationship present (Block)', () => {
    it('fails when the flag is absent (explicit, never inferred)', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), assignorIsPatient: undefined }), 'C8')).toBe('fail');
    });
    it('fails a third-party assignor without name and relationship', () => {
      const payload = { ...validPre(), assignorIsPatient: false };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C8')).toBe('fail');
    });
    it('passes a third-party assignor with both', () => {
      const payload = {
        ...validPre(),
        assignorIsPatient: false,
        assignorName: 'Sam Carer',
        assignorRelationship: 'parent',
      };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C8')).toBe('pass');
    });
  });

  describe('C9 — signature present, non-empty, capture method recorded (Block)', () => {
    it('fails without a signature', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), signaturePresent: false }), 'C9')).toBe('fail');
    });
    it('fails without a capture method', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), signatureMethod: undefined }), 'C9')).toBe('fail');
    });
  });

  describe('C10 — no practitioner signature collected (Block, defensive)', () => {
    it('fails any payload carrying a practitioner-signature field (abolished 1 Jul 2026)', () => {
      const payload = { ...validPre(), practitionerSignature: 'scrawl' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C10')).toBe('fail');
    });
  });

  describe('C11 — no benefit/dollar amount in the artefact (Warn)', () => {
    it('warns — not blocks — on a benefit amount field (REQ-REG-04)', () => {
      const payload = { ...validPre(), benefitAmount: 65.7 };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C11')).toBe('warn');
    });
  });

  describe('C12 — particulars locked before signature timestamp (Block)', () => {
    it('fails when the lock postdates the signature (the REQ-REG-06 offence)', () => {
      const payload = {
        ...validPre(),
        particularsLockedAt: '2026-09-01T09:31:00.000Z',
        signatureTimestamp: '2026-09-01T09:30:00.000Z',
      };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C12')).toBe('fail');
    });
    it('fails when no lock timestamp exists', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), particularsLockedAt: undefined }), 'C12')).toBe('fail');
    });
  });

  describe('C13 — verification event present and passed (Warn — our standard, not law)', () => {
    it('warns — not blocks — when verification is absent', () => {
      expect(outcomeOf(ruleSet.evaluate({ ...validPre(), verificationPassed: undefined }), 'C13')).toBe('warn');
    });
  });

  describe('C14 — agreement created before claim lodgement, where observable (Warn)', () => {
    it('warns when the claim was lodged before the agreement existed', () => {
      const payload = { ...validPre(), claimLodgedAt: '2026-08-01T00:00:00.000Z' };
      expect(outcomeOf(ruleSet.evaluate(payload), 'C14')).toBe('warn');
    });
    it('does not warn when lodgement is unobservable', () => {
      expect(outcomeOf(ruleSet.evaluate(validPre()), 'C14')).not.toBe('warn');
    });
  });

  describe('stage awareness (REQ-65C-01: pre-signature blocking pass, storage assert pass)', () => {
    it('pre_signature passes a payload that has no signature or lock yet — those are what the lock creates', () => {
      const payload = { ...validPre() };
      delete payload.signaturePresent;
      delete payload.signatureMethod;
      delete payload.signatureTimestamp;
      delete payload.particularsLockedAt;
      const results = ruleSet.evaluate(payload, 'pre_signature');
      expect(results.filter((r) => r.outcome === 'fail')).toEqual([]);
    });

    it('pre_signature still blocks genuine data-set defects', () => {
      const payload = { ...validPre(), patientName: '' };
      delete payload.signaturePresent;
      delete payload.particularsLockedAt;
      expect(outcomeOf(ruleSet.evaluate(payload, 'pre_signature'), 'C1')).toBe('fail');
    });

    it('storage (the default) enforces the signature and lock obligations', () => {
      const payload = { ...validPre() };
      delete payload.signaturePresent;
      delete payload.particularsLockedAt;
      expect(outcomeOf(ruleSet.evaluate(payload), 'C9')).toBe('fail');
      expect(outcomeOf(ruleSet.evaluate(payload), 'C12')).toBe('fail');
    });
  });

  describe('versioning (rule 14 / REQ-65C-02)', () => {
    it('exposes non-empty rule-set and mapping versions', () => {
      expect(ruleSet.version.length).toBeGreaterThan(0);
      expect(ruleSet.mappingVersion.length).toBeGreaterThan(0);
    });
  });
}

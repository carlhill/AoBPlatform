/**
 * The step before a telehealth consultation: what the domain promises
 * (TELEHEALTH-PLAN.md §3–§4, §7; D-2026-10-11-07/-08).
 */
import {
  TELEHEALTH_CONTENT,
  TELEHEALTH_CONTENT_VERSION,
  TELEHEALTH_IDENTITY_CHECKLIST,
  TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN,
  TELEHEALTH_NOT_DONE_REASONS,
  TELEHEALTH_NOT_DONE_REASONS_VERSION,
  TELEHEALTH_NOT_DONE_REASON_KEYS,
  TELEHEALTH_SESSION_STATES,
  mayMoveTelehealthSession,
  parseTelehealthContent,
  parseTelehealthNotDoneReasonContent,
  telehealthConsentStatement,
  telehealthNotDoneReason,
  telehealthTransports,
} from './telehealth';
import { patientMessageTemplate } from './patient-message-templates';
import { REVIEW_TASK_KEYS, TELEHEALTH_CODE_LOCKED_TASK_KIND } from './review-tasks';

describe('the telehealth identity checklist', () => {
  it('medicare_number_not_on_the_telehealth_checklist', () => {
    // Hard rule 1: the card number is not an identity identifier.
    expect(TELEHEALTH_IDENTITY_CHECKLIST.some((t) => /medicare/i.test(t))).toBe(false);
    // It is the approved six and nothing else: no contact details counted as identity.
    expect([...TELEHEALTH_IDENTITY_CHECKLIST]).toEqual([
      'name',
      'date_of_birth',
      'gender',
      'address',
      'patient_record_number',
      'ihi',
    ]);
  });
});

describe('the telehealth consent wording is versioned and neutral', () => {
  it('telehealth_consent_wording_never_mentions_bulk_billing', () => {
    for (const line of [TELEHEALTH_CONTENT.consent.statement, TELEHEALTH_CONTENT.consent.carerStatement]) {
      expect(line).not.toMatch(TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN);
    }
    // And the loader refuses a statement that strays, so a content edit cannot ship one.
    const base = JSON.parse(JSON.stringify(TELEHEALTH_CONTENT));
    for (const bad of [
      'Yes, bulk bill my consultation with {{providerName}}',
      'Yes, I agree to assign my Medicare benefit to {{providerName}}',
      'I approve my telehealth consultation with {{providerName}}',
      'Yes, and I will sign the DB4 for {{providerName}}',
    ]) {
      expect(() => parseTelehealthContent({ ...base, consent: { ...base.consent, statement: bad } })).toThrow(/G10/);
    }
  });

  it('renders_the_statement_for_the_patient_and_for_a_carer', () => {
    expect(telehealthConsentStatement({ providerName: 'Dr Sample Chen', consenterIsPatient: true })).toBe(
      'Yes, start my telehealth consultation with Dr Sample Chen',
    );
    expect(
      telehealthConsentStatement({ providerName: 'Dr Sample Chen', consenterIsPatient: false, patientGivenNames: 'Testy' }),
    ).toContain('for Testy with Dr Sample Chen');
    expect(() => telehealthConsentStatement({ providerName: 'Dr Sample Chen', consenterIsPatient: false })).toThrow();
  });

  it('carries_the_thresholds_as_content_not_code', () => {
    expect(TELEHEALTH_CONTENT_VERSION).toMatch(/^telehealth-/);
    expect(TELEHEALTH_CONTENT.code.digits).toBe(6);
    expect(TELEHEALTH_CONTENT.code.validityMinutes).toBe(10);
    expect(TELEHEALTH_CONTENT.code.wrongAttemptsBeforeLock).toBeGreaterThan(0);
    const base = JSON.parse(JSON.stringify(TELEHEALTH_CONTENT));
    expect(() => parseTelehealthContent({ ...base, code: { ...base.code, digits: 4 } })).toThrow(/digits/);
    expect(() => parseTelehealthContent({ ...base, code: { ...base.code, validityMinutes: 600 } })).toThrow(/validityMinutes/);
    expect(() => parseTelehealthContent({ ...base, consent: { ...base.consent, statement: 'Hi {{code}}' } })).toThrow(/code/);
  });
});

describe('the telehealth link message', () => {
  it('telehealth_code_never_in_the_message', () => {
    const t = patientMessageTemplate('telehealth_link_v1');
    const words = [t.subject ?? '', t.sms ?? '', ...t.paragraphs, ...(t.smallPrint ?? [])];
    // No placeholder a code could be substituted into…
    for (const line of words) expect(line).not.toMatch(/\{\{\s*code\s*\}\}/i);
    // …and the same neutrality as the statement until G10 is answered.
    for (const line of words) expect(line).not.toMatch(TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN);
    expect(t.sms).toContain('{{telehealthUrl}}');
  });
});

describe('the "not done" reasons are versioned content', () => {
  it('telehealth_not_done_reasons_load_in_file_order', () => {
    expect(TELEHEALTH_NOT_DONE_REASON_KEYS).toEqual([
      'emergency',
      'language_barrier',
      'technology_gap',
      'no_contact_on_file',
      'patient_declined_link',
      'doctor_without_access',
      'other',
    ]);
    expect(TELEHEALTH_NOT_DONE_REASONS.filter((r) => r.takesNote).map((r) => r.key)).toEqual(['other']);
    expect(TELEHEALTH_NOT_DONE_REASONS_VERSION).toMatch(/^telehealth-not-done-reasons-/);
    expect(telehealthNotDoneReason('emergency')?.takesNote).toBe(false);
    expect(telehealthNotDoneReason('because')).toBeUndefined();
  });

  it('a_malformed_reason_file_fails_at_load', () => {
    expect(() => parseTelehealthNotDoneReasonContent(null)).toThrow(/not usable/);
    expect(() => parseTelehealthNotDoneReasonContent({ version: 'v', reasons: [] })).toThrow(/reasons/);
    expect(() => parseTelehealthNotDoneReasonContent({ version: 'v', reasons: [{ key: 'Bad Key' }] })).toThrow(/snake/);
    expect(() =>
      parseTelehealthNotDoneReasonContent({ version: 'v', reasons: [{ key: 'a' }, { key: 'a' }] }),
    ).toThrow(/twice/);
    expect(() =>
      parseTelehealthNotDoneReasonContent({ version: 'v', reasons: [{ key: 'a', takesNote: 'yes' }] }),
    ).toThrow(/takesNote/);
  });
});

describe('telehealth session states', () => {
  it('every_state_before_an_outcome_can_be_marked_not_done', () => {
    // Hard rule 8: the provider can always record the way past the step.
    expect(mayMoveTelehealthSession('opened', 'not_done')).toBe(true);
    expect(mayMoveTelehealthSession('code_checked', 'not_done')).toBe(true);
    expect(mayMoveTelehealthSession('opened', 'agreed')).toBe(false);
    expect(mayMoveTelehealthSession('not_done', 'agreed')).toBe(false);
    expect(mayMoveTelehealthSession('agreed', 'did_not_proceed')).toBe(true);
    expect(TELEHEALTH_SESSION_STATES).toContain('did_not_proceed');
  });

  it('both_sends_sms_then_email', () => {
    expect(telehealthTransports('both')).toEqual(['sms', 'email']);
    expect(telehealthTransports('email')).toEqual(['email']);
  });

  it('a_locked_code_raises_a_known_review_task', () => {
    expect(REVIEW_TASK_KEYS).toContain(TELEHEALTH_CODE_LOCKED_TASK_KIND);
  });
});

/**
 * THE PORTAL MESSAGE COPY, HELD TO THE HARD RULES IT COULD BREAK.
 *
 * These are not tests of the loader's plumbing so much as of the WORDS: the
 * file is content, a person will edit it, and each of these is a rule that a
 * well-meaning edit would break silently.
 */
import {
  PATIENT_MESSAGE_TEMPLATES,
  PORTAL_INVITATION_TEMPLATE_KEY,
  PORTAL_RECORD_ID_LINE_TEMPLATE_KEY,
  parsePatientMessageTemplates,
  patientMessageTemplate,
  portalRecordIdLine,
  renderPatientMessage,
} from './patient-message-templates';

const VALUES = {
  givenNames: 'Jamie',
  practiceName: 'Wattle Street Medical',
  activationUrl: 'https://example.invalid/patient/portal/activate/abc.def',
  expiresOn: '11 September 2026',
  recordId: 'AoBPlatform-PatientId-11111111-2222-3333-4444-555555555555',
};

describe('portal_invitation_copy_quotes_the_record_id', () => {
  it('carries the sentence that makes a forgery detectable, verbatim', () => {
    const rendered = renderPatientMessage(PORTAL_INVITATION_TEMPLATE_KEY, VALUES);
    const whole = [...rendered.paragraphs, ...rendered.smallPrint, rendered.sms ?? ''].join('\n');
    expect(whole).toContain(
      `Your AoBPlatform record ID is ${VALUES.recordId}. Every genuine message from us about your record ` +
        'quotes it, and you will see it on the page after you sign in.',
    );
  });

  it('is the SAME sentence the helper appends to every other message', () => {
    const line = portalRecordIdLine(VALUES.recordId);
    const invitation = renderPatientMessage(PORTAL_INVITATION_TEMPLATE_KEY, VALUES);
    expect(invitation.smallPrint.some((p) => p === line)).toBe(true);
    expect(invitation.sms).toContain(line);
  });

  it('refuses to render with a placeholder unfilled rather than printing braces', () => {
    expect(() => renderPatientMessage(PORTAL_INVITATION_TEMPLATE_KEY, { ...VALUES, recordId: '' })).toThrow(
      /needs a value for \{\{recordId\}\}/,
    );
  });

  it('says the offer changes nothing about care or signing (REQ-PORT-08, hard rule 8)', () => {
    const rendered = renderPatientMessage(PORTAL_INVITATION_TEMPLATE_KEY, VALUES);
    expect(rendered.paragraphs.join(' ')).toContain('You never need an account to sign a bulk-billing agreement');
  });
});

describe('portal_invitation_copy_never_claims_approval', () => {
  it('holds every template to hard rules 1, 4 and 12', () => {
    for (const template of PATIENT_MESSAGE_TEMPLATES.templates) {
      const words = [
        template.subject ?? '',
        template.actionLabel ?? '',
        template.sms ?? '',
        ...template.paragraphs,
        ...(template.smallPrint ?? []),
      ].join(' ');
      // Hard rule 12 — never about our forms.
      expect(words).not.toMatch(/\b(certified|approved|accredited|government-approved)\b/i);
      // Hard rule 4 — no benefit or dollar amount anywhere.
      expect(words).not.toMatch(/(\$|\bAUD\b|\bdollars?\b|\brebate\b)/i);
      // Hard rule 1 — the card number is not an identifier and is never asked for.
      expect(words).not.toMatch(/medicare[\s-]*(card[\s-]*)?(number|no\.?)/i);
    }
  });

  it('refuses a file that claims a form is approved', () => {
    expect(() =>
      parsePatientMessageTemplates({
        version: 'x',
        placeholders: [],
        templates: [{ key: 'x_v1', note: 'n', paragraphs: ['Your government-approved agreement is ready.'] }],
      }),
    ).toThrow(/hard rule 12/);
  });

  it('refuses a file that puts an amount in a message', () => {
    expect(() =>
      parsePatientMessageTemplates({
        version: 'x',
        placeholders: [],
        templates: [{ key: 'x_v1', note: 'n', paragraphs: ['The benefit was $42.75.'] }],
      }),
    ).toThrow(/hard rule 4/);
  });

  it('refuses a file that asks for a Medicare card number', () => {
    expect(() =>
      parsePatientMessageTemplates({
        version: 'x',
        placeholders: [],
        templates: [{ key: 'x_v1', note: 'n', paragraphs: ['Reply with your Medicare card number.'] }],
      }),
    ).toThrow(/hard rule 1/);
  });

  it('refuses an undeclared placeholder and an unversioned key', () => {
    expect(() =>
      parsePatientMessageTemplates({
        version: 'x',
        placeholders: ['a'],
        templates: [{ key: 'x_v1', note: 'n', paragraphs: ['Hello {{b}}'] }],
      }),
    ).toThrow(/not a declared placeholder/);

    expect(() =>
      parsePatientMessageTemplates({
        version: 'x',
        placeholders: [],
        templates: [{ key: 'portal_invitation', note: 'n', paragraphs: ['Hello'] }],
      }),
    ).toThrow(/versioned lower_snake_case identifier/);
  });

  it('names an unknown template rather than returning nothing', () => {
    expect(() => patientMessageTemplate('no_such_v1')).toThrow(/No patient message template/);
    expect(patientMessageTemplate(PORTAL_RECORD_ID_LINE_TEMPLATE_KEY).paragraphs).toHaveLength(1);
  });
});

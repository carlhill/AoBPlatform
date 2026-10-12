import {
  AGREEMENT_TEMPLATES,
  AGREEMENT_TEMPLATES_VERSION,
  AgreementTemplateError,
  REQUIRED_TEMPLATE_PLACEHOLDERS,
  assertAgreementTemplateBody,
  genericAgreementTemplate,
  parseAgreementTemplates,
  renderAgreementTemplate,
  templateTypeFor,
  type AgreementTemplate,
} from './agreement-templates';

const DECLARED = {
  placeholders: AGREEMENT_TEMPLATES.placeholders,
  conditions: AGREEMENT_TEMPLATES.conditions,
};

/** A body that passes, to mutate one line of per case. */
function episodicBody(overrides: Partial<AgreementTemplate> = {}): AgreementTemplate {
  return { ...genericAgreementTemplate('episodic'), ...overrides };
}

const EPISODIC_VALUES = {
  values: {
    patientName: 'Alex Testpatient',
    agreementDate: '1 September 2026',
    providerDetails: 'Dr Sam Example, 1 Test Street, Testville NSW 2000',
    providerName: 'Dr Sam Example',
    serviceDate: '1 September 2026',
    basicServiceDescription: 'General practitioner attendance',
    mbsItemNumbers: '23',
    mappingVersion: 'mapping-test-1',
    assignorName: 'Robin Testperson',
    assignorRelationship: 'mother',
    enduringPathway: 'MyMedicare',
    coveredServiceScope: 'General practitioner attendances',
    notificationMethod: 'email',
    terminationMethod: 'in writing to the practice',
    commencementDate: '1 September 2026',
  },
  conditions: { assignorIsPatient: true, isPreAgreement: true },
};

describe('agreement templates are versioned content (hard rule 14)', () => {
  it('loads, and both instruments are present with a version that travels', () => {
    expect(AGREEMENT_TEMPLATES_VERSION).toMatch(/^agreement-templates-/);
    expect(genericAgreementTemplate('episodic').version).toBe('episodic-generic-1');
    expect(genericAgreementTemplate('enduring').version).toBe('enduring-generic-1');
  });

  it('every generic template is still marked as a draft pending human review', () => {
    // Deliberately assertive. These words have not been read by counsel; the
    // day they are, this test is the thing that has to be changed on purpose.
    for (const template of AGREEMENT_TEMPLATES.templates) {
      expect(template.status).toBe('draft_pending_review');
    }
  });

  it('only `enduring` is the other instrument — pre, post and treatment plans share one', () => {
    expect(templateTypeFor('episodic_pre')).toBe('episodic');
    expect(templateTypeFor('episodic_post')).toBe('episodic');
    expect(templateTypeFor('treatment_plan')).toBe('episodic');
    expect(templateTypeFor('enduring')).toBe('enduring');
  });
});

describe('template_loader_refuses_amounts_signature_lines_and_approval_words', () => {
  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['a dollar amount', 'The benefit is $41.20.', /hard rule 4/],
    ['a benefit amount by name', 'The benefit amount is stated separately.', /hard rule 4/],
    ['a practitioner signature line', 'Practitioner signature: ______', /hard rule 3/],
    ['a signature of the provider', 'Signed by the provider on the date above.', /hard rule 3/],
    ['an approval claim', 'This is a government-approved form.', /hard rule 12/],
    ['the word certified', 'This form is certified for use.', /hard rule 12/],
    ['a Medicare card number', 'Please write your Medicare card number here.', /hard rule 1/],
  ];

  it.each(cases)('refuses %s', (_name, line, expected) => {
    const template = episodicBody({
      footer: [...genericAgreementTemplate('episodic').footer, line],
    });
    expect(() => assertAgreementTemplateBody(template, DECLARED, 'a test template')).toThrow(expected);
  });

  it('does NOT refuse "Medicare benefit" — it is the thing s 65C assigns', () => {
    const template = episodicBody({
      footer: ['I assign my right to the Medicare benefit for the service described above.'],
    });
    expect(() => assertAgreementTemplateBody(template, DECLARED, 'a test template')).not.toThrow();
  });

  it('does NOT refuse the assignor signing — only the practitioner is abolished', () => {
    const template = episodicBody({ footer: ['This agreement is signed by the assignor.'] });
    expect(() => assertAgreementTemplateBody(template, DECLARED, 'a test template')).not.toThrow();
  });
});

describe('practice_template_must_carry_every_data_element', () => {
  it.each(REQUIRED_TEMPLATE_PLACEHOLDERS.episodic)(
    'refuses an episodic template that never renders {{%s}}',
    (required) => {
      const generic = genericAgreementTemplate('episodic');
      // Swap the required element out for ANOTHER declared one, so the only
      // thing the template loses is the element under test.
      const substitute = required === 'assignorIsPatient' ? 'isPreAgreement' : 'assignorIsPatient';
      const strip = (text: string) =>
        text
          .replace(new RegExp(`\\{\\{#(if|unless)\\s+${required}\\}\\}`, 'g'), `{{#$1 ${substitute}}}`)
          .replace(new RegExp(`\\{\\{${required}\\}\\}`, 'g'), 'X');
      const template = episodicBody({
        sections: generic.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map(strip) })),
        statements: generic.statements.map((s) => ({ ...s, text: strip(s.text) })),
        footer: generic.footer.map(strip),
        title: strip(generic.title),
      });
      expect(() => assertAgreementTemplateBody(template, DECLARED, 'a test template')).toThrow(
        new RegExp(`never renders \\{\\{${required}\\}\\}`),
      );
    },
  );

  it('refuses an enduring template that drops the termination method', () => {
    const generic = genericAgreementTemplate('enduring');
    const template: AgreementTemplate = {
      ...generic,
      sections: generic.sections.map((s) => ({
        ...s,
        paragraphs: s.paragraphs.filter((p) => !p.includes('{{terminationMethod}}')),
      })),
    };
    expect(() => assertAgreementTemplateBody(template, DECLARED, 'a test template')).toThrow(
      /never renders \{\{terminationMethod\}\}/,
    );
  });

  it('refuses a template with no statements to tick', () => {
    expect(() => assertAgreementTemplateBody(episodicBody({ statements: [] }), DECLARED, 't')).toThrow(
      /no statements/,
    );
  });
});

describe('the substitution language stays tiny and loud', () => {
  it('refuses an undeclared placeholder', () => {
    const template = episodicBody({ footer: ['Signed at {{clinicMood}}.'] });
    expect(() => assertAgreementTemplateBody(template, DECLARED, 't')).toThrow(/not a declared placeholder/);
  });

  it('refuses an unbalanced block', () => {
    const template = episodicBody({ footer: ['{{#if assignorIsPatient}}Half a thought.'] });
    expect(() => assertAgreementTemplateBody(template, DECLARED, 't')).toThrow(/\{\{#if\/#unless\}\}/);
  });

  it('refuses a moustache that is neither a placeholder nor a block', () => {
    const template = episodicBody({ footer: ['{{ patientName }}'] });
    expect(() => assertAgreementTemplateBody(template, DECLARED, 't')).toThrow(/not a placeholder or a block/);
  });

  it('refuses a second generic template for one type', () => {
    const generic = genericAgreementTemplate('episodic');
    expect(() =>
      parseAgreementTemplates({
        ...AGREEMENT_TEMPLATES,
        templates: [...AGREEMENT_TEMPLATES.templates, { ...generic, id: 'episodic-other' }],
      }),
    ).toThrow(/second generic template/);
  });
});

describe('rendering the template', () => {
  it('takes the branch the conditions choose, and drops what the other branch held', () => {
    const rendered = renderAgreementTemplate(genericAgreementTemplate('episodic'), EPISODIC_VALUES);
    const text = JSON.stringify(rendered);
    expect(text).toContain('made before the service is provided');
    expect(text).not.toContain('after the service was provided');
    // D6a on a pre-agreement; D6b belongs to the other branch and is absent.
    expect(text).toContain('General practitioner attendance');
    expect(text).not.toContain('Medicare item numbers');
    expect(text).toContain('The patient is signing this agreement.');
  });

  it('names the assignor and their relationship when the patient is not signing', () => {
    const rendered = renderAgreementTemplate(genericAgreementTemplate('episodic'), {
      ...EPISODIC_VALUES,
      conditions: { assignorIsPatient: false, isPreAgreement: true },
    });
    const text = JSON.stringify(rendered);
    expect(text).toContain('Robin Testperson');
    expect(text).toContain('on behalf of Alex Testpatient as their mother');
  });

  it('throws rather than rendering braces at a patient when a particular is missing', () => {
    expect(() =>
      renderAgreementTemplate(genericAgreementTemplate('episodic'), {
        ...EPISODIC_VALUES,
        values: { ...EPISODIC_VALUES.values, providerName: '' },
      }),
    ).toThrow(AgreementTemplateError);
  });

  it('carries exactly the statements to tick, keyed rather than quoted', () => {
    const rendered = renderAgreementTemplate(genericAgreementTemplate('enduring'), {
      ...EPISODIC_VALUES,
      conditions: { assignorIsPatient: true, isPreAgreement: false },
    });
    expect(rendered.statements.map((s) => s.key)).toEqual([
      'enduring_assign_v1',
      'enduring_scope_and_ending_v1',
    ]);
    expect(rendered.statements[0].text).toContain('Dr Sam Example');
  });
});

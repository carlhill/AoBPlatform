/**
 * THE WORDING EDITOR AS A FORM (Carl, 7 Sep 2026; W1).
 *
 * "Make this custom text a form and then you put it together in the right JSON
 * format."
 *
 * WHAT THESE PIN, and each is a way the change could be quietly wrong:
 *
 *  1. THE ASSEMBLY. What the form posts is compared against a HAND-WRITTEN
 *     object, not against another call to `bodyFromForm` — a test that
 *     asserted the function agreed with itself would pass on any shape.
 *  2. THE GATE. Save and Submit are dead while a data element is missing, and
 *     the reason is on the screen in the practice's language rather than the
 *     loader's.
 *  3. THE PICKER. A placeholder lands AT THE CARET, not at the end, and the
 *     menu is built from the placeholders the API declared rather than from a
 *     list in the component.
 *
 * THE WORDS IN THE FIXTURES ARE NOT THE SHIPPED ONES, for the reason
 * `TemplatesView.test.tsx` gives: the template is versioned content served by
 * the API, so a stub carrying the real sentences would let a component that
 * had hardcoded them pass.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TemplateForm } from './TemplateForm';
import {
  bodyFromForm,
  formFromBody,
  insertAtCaret,
  nextVersionName,
  slugify,
  wrapSelection,
  type TemplateBody,
} from './templateEditing';
import { strings } from '../../strings';

/** Every episodic data element, so the checks pass and the buttons are live. */
const COMPLETE_PARAGRAPH =
  'For {{patientName}} on {{agreementDate}}, with {{providerDetails}} on {{serviceDate}}: '
  + '{{basicServiceDescription}} {{mbsItemNumbers}}.';
const BRANCHES =
  '{{#if isPreAgreement}}Made before the service.{{/if}}'
  + '{{#unless assignorIsPatient}}Signed by {{assignorName}}, {{assignorRelationship}}.{{/unless}}';

const GENERIC: TemplateBody = {
  title: 'Sample agreement title',
  sections: [
    { key: 'parties', heading: 'Sample parties heading', paragraphs: [COMPLETE_PARAGRAPH, BRANCHES] },
    { key: 'service', heading: 'Sample service heading', paragraphs: ['Sample service paragraph.'] },
  ],
  statements: [
    { key: 'sample_assign_v1', text: 'Sample first statement.' },
    { key: 'sample_details_v1', text: 'Sample second statement.' },
  ],
  footer: ['Sample first footer line.', 'Sample second footer line.'],
};

const PLACEHOLDERS = [
  'patientName',
  'agreementDate',
  'providerDetails',
  'providerName',
  'serviceDate',
  'basicServiceDescription',
  'mbsItemNumbers',
  'assignorName',
  'assignorRelationship',
];
const CONDITIONS = ['assignorIsPatient', 'isPreAgreement'];

function renderForm(onPropose = vi.fn()) {
  render(
    <TemplateForm
      agreementType="episodic"
      generic={GENERIC}
      placeholders={PLACEHOLDERS}
      conditions={CONDITIONS}
      initialVersion="our-clinic-episodic-1"
      practiceName="Sample Clinic"
      existingVersions={[]}
      busy={false}
      error={null}
      onPropose={onPropose}
      onCancel={vi.fn()}
    />,
  );
  return onPropose;
}

describe('template_form_assembles_the_json_the_server_accepts', () => {
  it('posts exactly the four fields, with the keys carried and the words edited', () => {
    const onPropose = renderForm();

    // Edit one of everything the form owns.
    fireEvent.change(screen.getByTestId('template-title'), { target: { value: 'Our agreement' } });
    fireEvent.change(screen.getByTestId('section-service-heading'), { target: { value: 'Our service' } });
    fireEvent.change(screen.getByTestId('section-service-paragraph-0'), {
      target: { value: 'Our service paragraph.' },
    });
    fireEvent.change(screen.getByTestId('statement-sample_details_v1-text'), {
      target: { value: 'Our second statement.' },
    });
    fireEvent.change(screen.getByTestId('template-footer'), {
      target: { value: 'Our footer line.\n\nOur other footer line.' },
    });

    fireEvent.click(screen.getByTestId('save-draft'));

    expect(onPropose).toHaveBeenCalledTimes(1);
    const [version, body, submit] = onPropose.mock.calls[0] as [string, TemplateBody, boolean];
    expect(version).toBe('our-clinic-episodic-1');
    expect(submit).toBe(false);

    /*
     * THE WHOLE OBJECT, WRITTEN OUT. This is the shape
     * `POST /agreement-templates` reads out of `body` today: four fields, the
     * section and statement KEYS carried unchanged, blank footer lines
     * dropped. No `id`, no `version` inside the body, no `note`, no `status` —
     * the server mints those.
     */
    expect(body).toEqual({
      title: 'Our agreement',
      sections: [
        { key: 'parties', heading: 'Sample parties heading', paragraphs: [COMPLETE_PARAGRAPH, BRANCHES] },
        { key: 'service', heading: 'Our service', paragraphs: ['Our service paragraph.'] },
      ],
      statements: [
        { key: 'sample_assign_v1', text: 'Sample first statement.' },
        { key: 'sample_details_v1', text: 'Our second statement.' },
      ],
      footer: ['Our footer line.', 'Our other footer line.'],
    });
  });

  it('submit posts the same body and asks for the review', () => {
    const onPropose = renderForm();
    fireEvent.click(screen.getByTestId('submit-for-review'));
    expect(onPropose.mock.calls[0]?.[2]).toBe(true);
  });

  it('a draft carries on where it left off, in the generic’s shape', () => {
    /*
     * A DRAFT SAVED BEFORE A SECTION EXISTED comes back with that section
     * PRESENT AND EMPTY rather than silently missing — the failure mode that
     * would quietly drop a statutory particular.
     */
    const drifted: TemplateBody = {
      title: 'Our earlier title',
      sections: [{ key: 'parties', heading: 'Our parties', paragraphs: ['Our paragraph.'] }],
      statements: [{ key: 'sample_assign_v1', text: 'Our first statement.' }],
      footer: ['Our footer.'],
    };

    const form = formFromBody(GENERIC, drifted);
    expect(form.title).toBe('Our earlier title');
    expect(form.sections.map((s) => s.key)).toEqual(['parties', 'service']);
    expect(form.sections[1].paragraphs).toEqual(['Sample service paragraph.']);
    // The statement the draft never mentioned keeps the generic's words rather
    // than becoming an empty tick box.
    expect(form.statements[1].text).toBe('Sample second statement.');
  });

  it('a section always keeps one paragraph box', () => {
    const emptied: TemplateBody = { ...GENERIC, sections: [{ key: 'parties', heading: 'H', paragraphs: [] }] };
    expect(formFromBody(emptied, emptied).sections[0].paragraphs).toEqual(['']);
    // And a blank box never reaches the server.
    expect(bodyFromForm(formFromBody(emptied, emptied)).sections[0].paragraphs).toEqual([]);
  });
});

describe('template_form_blocks_submit_while_a_data_element_is_missing', () => {
  it('names the missing element in words, and both buttons stay dead', () => {
    renderForm();

    // Wipe the paragraph that carries the whole data set.
    fireEvent.change(screen.getByTestId('section-parties-paragraph-0'), { target: { value: '' } });

    expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('submit-for-review') as HTMLButtonElement).disabled).toBe(true);

    /*
     * IN THE PRACTICE'S LANGUAGE, NOT THE LOADER'S. "it never renders
     * {{patientName}}" is the loader talking to a developer.
     */
    expect(
      screen.getByText(
        strings.templates.checkMissingElement(strings.templates.placeholderLabels.patientName),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        strings.templates.checkMissingElement(strings.templates.placeholderLabels.serviceDate),
      ),
    ).toBeTruthy();

    // AND THE REASONS ARE VISIBLE BESIDE THE DEAD BUTTONS (CLAUDE.md §6/§7):
    // a greyed-out control is never a mystery.
    expect(screen.getByText(strings.templates.saveBlocked)).toBeTruthy();
  });

  it('the loader’s own refusals are shown verbatim — an amount, a forbidden word', () => {
    renderForm();

    fireEvent.change(screen.getByTestId('section-service-paragraph-0'), {
      target: { value: 'The benefit is $42.00.' },
    });
    expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/benefit or dollar amount/)).toBeTruthy();

    fireEvent.change(screen.getByTestId('section-service-paragraph-0'), {
      target: { value: 'This form is government-approved.' },
    });
    expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(true);
    // Hard rule 12 — the check the console must never be the one to relax.
    expect(screen.getByText(/ever permitted about our forms/)).toBeTruthy();
  });

});

describe('template_version_name_is_generated_and_valid', () => {
  /*
   * THE PURE FUNCTIONS FIRST — the part of "generate a version name" that can
   * be wrong in a way no component test would show: the shape of the slug,
   * and which existing versions count towards the next number.
   */
  it('slugify lower-cases, hyphenates, and never produces a name the pattern would reject', () => {
    expect(slugify('Testville Family Medical')).toBe('testville-family-medical');
    expect(slugify('  Extra   Spaces  ')).toBe('extra-spaces');
    // Starts with a digit: the pattern requires the first character to be a
    // letter, so a name like this cannot be left to fail — it is repaired.
    expect(slugify('24/7 Medical')).toBe('practice-24-7-medical');
    // Nothing left after stripping: still a name, not an empty prefix.
    expect(slugify('!!!')).toBe('practice');
  });

  it('nextVersionName numbers one past the highest existing number under the same prefix', () => {
    expect(nextVersionName('testville', 'episodic', [])).toBe('testville-episodic-1');
    expect(
      nextVersionName('testville', 'episodic', [
        'testville-episodic-1',
        'testville-episodic-3',
        'testville-enduring-9', // a different agreement type — does not count
        'someone-else-episodic-9', // a different practice — does not count
      ]),
    ).toBe('testville-episodic-4');
  });

  it('shows the generated version read-only, and Change reveals an editable field', () => {
    render(
      <TemplateForm
        agreementType="episodic"
        generic={GENERIC}
        placeholders={PLACEHOLDERS}
        conditions={CONDITIONS}
        initialVersion=""
        practiceName="Xlevelup Medical"
        existingVersions={['xlevelup-medical-episodic-1']}
        busy={false}
        error={null}
        onPropose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Generated from the practice name, the agreement type, and the highest
    // existing number for that pair — never typed, and shown before anybody
    // does anything.
    expect(screen.getByText(strings.templates.versionGenerated('xlevelup-medical-episodic-2'))).toBeTruthy();
    expect(screen.queryByTestId('variant-version')).toBeNull();
    // Generated, so it already satisfies the shape rule — nothing to fix.
    expect(screen.queryByText(strings.templates.checkNeedsVersion)).toBeNull();

    fireEvent.click(screen.getByTestId('variant-version-change'));
    const input = screen.getByTestId('variant-version') as HTMLInputElement;
    expect(input.value).toBe('xlevelup-medical-episodic-2');

    // Now that a person is editing it, the shape rule can actually be broken.
    fireEvent.change(input, { target: { value: 'Not A Valid Name' } });
    expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(strings.templates.checkNeedsVersion)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'our-own-name-1' } });
    expect((screen.getByTestId('save-draft') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a draft already in progress keeps its own version rather than being renumbered', () => {
    render(
      <TemplateForm
        agreementType="episodic"
        generic={GENERIC}
        placeholders={PLACEHOLDERS}
        conditions={CONDITIONS}
        initialVersion="our-clinic-episodic-1"
        practiceName="Our Clinic"
        existingVersions={['our-clinic-episodic-1']}
        busy={false}
        error={null}
        onPropose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(strings.templates.versionGenerated('our-clinic-episodic-1'))).toBeTruthy();
  });
});

describe('template_form_inserts_a_placeholder_at_the_caret', () => {
  it('lands where the cursor is, not at the end', () => {
    renderForm();
    const box = screen.getByTestId('section-service-paragraph-0') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Hello  world.' } });
    // Between the two spaces.
    box.setSelectionRange(6, 6);

    fireEvent.change(screen.getByTestId('section-service-paragraph-0-insert'), {
      target: { value: 'providerName' },
    });

    expect((screen.getByTestId('section-service-paragraph-0') as HTMLTextAreaElement).value).toBe(
      'Hello {{providerName}} world.',
    );
  });

  it('the menu offers exactly the placeholders the API declared', () => {
    renderForm();
    const menu = screen.getByTestId('template-title-insert') as HTMLSelectElement;
    const offered = [...menu.options].map((o) => o.value).filter((v) => v !== '');
    expect(offered).toEqual(PLACEHOLDERS);
    // And a labelled one reads as words rather than as a key.
    expect([...menu.options].some((o) => o.textContent === strings.templates.placeholderLabels.patientName)).toBe(
      true,
    );
  });

  it('“only when” wraps the selection, and works with nothing selected', () => {
    renderForm();
    const box = screen.getByTestId('section-service-paragraph-0') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Only for a pre-agreement.' } });
    box.setSelectionRange(0, 25);

    fireEvent.change(screen.getByTestId('section-service-paragraph-0-only-when'), {
      target: { value: 'if:isPreAgreement' },
    });

    expect((screen.getByTestId('section-service-paragraph-0') as HTMLTextAreaElement).value).toBe(
      '{{#if isPreAgreement}}Only for a pre-agreement.{{/if}}',
    );
  });

  /*
   * THE TWO CARET HELPERS ON THEIR OWN, because the component test can only
   * exercise one path through them and the edges are where an off-by-one
   * would put a placeholder inside a word.
   */
  it('the caret helpers replace a selection and land the caret after the token', () => {
    expect(insertAtCaret('ab', 1, 1, '{{x}}')).toEqual({ text: 'a{{x}}b', caret: 6 });
    // A selection is REPLACED, which is what a picker should do to highlighted text.
    expect(insertAtCaret('abcd', 1, 3, '{{x}}')).toEqual({ text: 'a{{x}}d', caret: 6 });
    // Nothing selected: the wrapper goes in empty and the caret sits inside it.
    expect(wrapSelection('', 0, 0, 'unless', 'assignorIsPatient')).toEqual({
      text: '{{#unless assignorIsPatient}}{{/unless}}',
      caret: 29,
    });
  });
});

describe('the preview is sample data and says so', () => {
  it('substitutes obviously fake values and marks itself as not the document', () => {
    renderForm();
    fireEvent.click(screen.getByTestId('template-preview-toggle'));

    expect(screen.getByText(strings.templates.previewNotice)).toBeTruthy();
    expect(screen.getByTestId('preview-title').textContent).toBe(GENERIC.title);
    // The samples, not braces.
    expect(screen.getByTestId('template-preview').textContent).toContain(
      strings.templates.sampleValues.patientName,
    );
    expect(screen.getByTestId('template-preview').textContent).not.toContain('{{');
  });
});

describe('template_statements_are_multiline', () => {
  it('a statement is a textarea, not a single-line input that clips the sentence', () => {
    renderForm();
    const box = screen.getByTestId('statement-sample_details_v1-text');
    expect(box.tagName).toBe('TEXTAREA');
    // The floor is two rows, not the one-line box this replaced.
    expect((box as HTMLTextAreaElement).rows).toBe(2);

    const longStatement =
      'A second statement long enough that a single-line box would clip it mid-sentence, '
      + 'which is exactly what was happening before this box could grow.';
    fireEvent.change(box, { target: { value: longStatement } });
    expect((box as HTMLTextAreaElement).value).toBe(longStatement);

    // Still wired to the same two pickers a paragraph box has.
    expect(screen.getByTestId('statement-sample_details_v1-text-insert')).toBeTruthy();
    expect(screen.getByTestId('statement-sample_details_v1-text-only-when')).toBeTruthy();
  });

  it('the title grows with the text rather than clipping a heading that wraps', () => {
    renderForm();
    const title = screen.getByTestId('template-title');
    expect(title.tagName).toBe('TEXTAREA');
    fireEvent.change(title, {
      target: { value: 'A title long enough to wrap onto a second line on a narrow screen' },
    });
    expect((title as HTMLTextAreaElement).value).toBe(
      'A title long enough to wrap onto a second line on a narrow screen',
    );
  });
});

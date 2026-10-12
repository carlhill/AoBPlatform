/**
 * THE WORDING EDITOR'S LOGIC, WITH NO REACT IN IT (Carl, 7 Sep 2026; W1).
 *
 * "Make this custom text a form and then you put it together in the right JSON
 * format." Until today `/practice/templates` showed a practice the raw
 * template JSON in a textarea — braces, commas, section keys and all — and
 * asked them to edit a legal document in it. A missing comma was a refusal
 * about JSON; a missing `{{serviceDate}}` was a refusal about the s 65C data
 * set; both arrived after Save, in the same red box.
 *
 * WHAT LIVES HERE. Turning the generic template into a form, turning the form
 * back into exactly the JSON the endpoint already accepts, inserting a
 * placeholder at a caret, wrapping a selection in a condition, and running the
 * SAME checks the server runs so a practice sees them as they type.
 *
 * WHY IT IS A SEPARATE MODULE FROM THE COMPONENT. Every one of those is a pure
 * function of its inputs and is the part that can be wrong in a way a
 * screenshot would not show — "the form assembles the JSON the server accepts"
 * is a claim about `bodyFromForm`, and a test of it should not have to render
 * anything.
 *
 * THE CHECKS ARE THE DOMAIN'S, NOT A COPY. `agreementTemplateProblems` is the
 * loader's own rule set with its own regexes, collecting instead of throwing
 * at the first. A console that re-implemented "no dollar amount" would be a
 * second opinion about what a lawful agreement says, and the two would drift.
 */
import {
  REQUIRED_TEMPLATE_PLACEHOLDERS,
  agreementTemplateProblems,
  type AgreementTemplate,
  type AgreementTemplateProblem,
  type AgreementTemplateType,
  type AgreementTemplateValues,
} from '@aobplatform/domain';

/** Exactly the four fields `POST /agreement-templates` reads out of `body`. */
export interface TemplateBody {
  readonly title: string;
  readonly sections: readonly { readonly key: string; readonly heading: string; readonly paragraphs: string[] }[];
  readonly statements: readonly { readonly key: string; readonly text: string }[];
  readonly footer: readonly string[];
}

/**
 * THE FORM'S OWN SHAPE, and the two places it differs from the body are both
 * deliberate.
 *
 * `footer` IS ONE STRING rather than an array, because a footer is a short
 * block of lines and "add a line / remove a line" controls around two
 * sentences would be ceremony. One textarea; each non-blank line becomes one
 * footer entry on the way out.
 *
 * SECTION AND STATEMENT KEYS ARE CARRIED, NOT EDITABLE. The key is what a
 * signature records (`statements[].key`) and what the renderer orders by; a
 * practice rewrites the words under a key and never the key itself. The form
 * shows them so nobody wonders what they are.
 */
export interface TemplateFormState {
  readonly title: string;
  readonly sections: readonly { readonly key: string; readonly heading: string; readonly paragraphs: readonly string[] }[];
  readonly statements: readonly { readonly key: string; readonly text: string }[];
  readonly footer: string;
}

/**
 * THE SHAPE COMES FROM THE GENERIC AND THE WORDS COME FROM THE DRAFT.
 *
 * A practice variant is a rewrite of the shipped template's SENTENCES, not a
 * different document: the same sections in the same order under the same keys,
 * and the same statements to tick. So the form is always built from the
 * generic's shape, and an existing draft supplies text wherever a key matches.
 *
 * WHICH ALSO REPAIRS A DRIFTED DRAFT. A draft saved before a section was added
 * to the generic — or a body somebody edited in the database — comes back with
 * the new section present and empty rather than silently missing, which is the
 * failure mode that would quietly drop a particular.
 */
export function formFromBody(generic: TemplateBody, draft?: TemplateBody): TemplateFormState {
  const draftSection = (key: string) => draft?.sections.find((s) => s.key === key);
  const draftStatement = (key: string) => draft?.statements.find((s) => s.key === key);
  const source = draft ?? generic;

  return {
    title: source.title,
    sections: generic.sections.map((section) => {
      const from = draftSection(section.key);
      const paragraphs = (from ? from.paragraphs : section.paragraphs).filter(() => true);
      // MIN ONE, ALWAYS. A section with no paragraph box is a section nobody
      // can type into, and the control to add one would be the only thing in it.
      return {
        key: section.key,
        heading: from ? from.heading : section.heading,
        paragraphs: paragraphs.length > 0 ? [...paragraphs] : [''],
      };
    }),
    statements: generic.statements.map((statement) => ({
      key: statement.key,
      text: draftStatement(statement.key)?.text ?? statement.text,
    })),
    footer: (draft ?? generic).footer.join('\n'),
  };
}

/**
 * THE FORM BACK INTO EXACTLY THE JSON THE ENDPOINT ACCEPTS TODAY.
 *
 * No new fields, no renamed ones, no `id`, no `version` (the endpoint takes
 * the version beside the body and mints the rest) — the server's DTO is
 * unchanged by this work, and `template_form_assembles_the_json_the_server_
 * accepts` compares the output against a hand-written object rather than
 * against another call to this function.
 *
 * BLANK PARAGRAPHS AND BLANK FOOTER LINES ARE DROPPED. An empty box is somebody
 * who added a paragraph and thought better of it, not a blank line they want
 * printed on a contract.
 */
export function bodyFromForm(form: TemplateFormState): TemplateBody {
  return {
    title: form.title.trim(),
    sections: form.sections.map((section) => ({
      key: section.key,
      heading: section.heading.trim(),
      paragraphs: section.paragraphs.map((p) => p.trim()).filter((p) => p.length > 0),
    })),
    statements: form.statements.map((statement) => ({
      key: statement.key,
      text: statement.text.trim(),
    })),
    footer: form.footer
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

/**
 * THE CANDIDATE THE CHECKS RUN AGAINST, assembled exactly as
 * `TemplatesService.validateBody` assembles it on the server — same fallback
 * id, same forced `draft_pending_review` status, same note. If the two ever
 * disagreed, the console would pass something the server refuses, which is the
 * one thing a live check must never do.
 */
export function candidateTemplate(
  form: TemplateFormState,
  agreementType: AgreementTemplateType,
  version: string,
): AgreementTemplate {
  const body = bodyFromForm(form);
  return {
    id: `practice-${agreementType}`,
    version,
    agreementType,
    status: 'draft_pending_review',
    title: body.title,
    note: 'Practice wording variant.',
    sections: body.sections,
    statements: body.statements,
    footer: body.footer,
  };
}

/**
 * WHY THIS WORDING CANNOT BE SAVED YET — one entry per outstanding reason.
 *
 * `element` is set where the reason is about a named data element, so the
 * screen can say "Patient's name is not mentioned yet" in the practice's
 * language instead of the loader's sentence about statutory particulars. Every
 * other reason keeps the loader's own words, which name the LINE and the RULE
 * and are the only part somebody editing wording can act on.
 */
export interface TemplateFormProblem {
  readonly key: string;
  /** Set for a missing s 65C data element — the placeholder or condition name. */
  readonly element?: string;
  readonly message: string;
}

/** The version name the endpoint accepts: lower-kebab-case ending in a number. */
export const TEMPLATE_VERSION_PATTERN = /^[a-z][a-z0-9-]*-[0-9]+$/;

/**
 * A PRACTICE NAME, MADE INTO THE SHAPE A VERSION NAME CAN START WITH
 * (Carl, 7 Sep 2026).
 *
 * "The version name must be lower case, words joined by hyphens, and end in
 * a number" is a technical rule about `TEMPLATE_VERSION_PATTERN`, not a fact
 * about the practice — so the practice is never asked to satisfy it by hand.
 * This turns whatever the practice record holds into the one thing the
 * pattern requires of its OWN half: lower case, hyphens, starting with a
 * letter.
 *
 * A NAME THAT STARTS WITH A DIGIT (or is empty once stripped) still has to
 * produce a version starting with a letter, because the pattern requires it
 * — `practice-` is prepended rather than the slug being silently dropped, so
 * "24/7 Medical" still becomes a version rather than failing to generate one.
 */
export function slugify(name: string): string {
  // Anything that is not a lower-case letter or digit becomes a hyphen —
  // spaces, punctuation, an accented letter alike. Simpler than transliterating
  // accents, and no less correct: the pattern only cares that what comes out
  // is lower-kebab-case starting with a letter, not that it reads identically
  // to the practice name.
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return 'practice';
  return /^[a-z]/.test(base) ? base : `practice-${base}`;
}

/**
 * THE NEXT VERSION NAME FOR THIS PRACTICE AND AGREEMENT TYPE:
 * `<practice-slug>-<agreementType>-<n>`, where `<n>` is one more than the
 * highest number already used by one of THIS practice's own templates of
 * THIS type (Carl, 7 Sep 2026).
 *
 * `existingVersions` IS WHATEVER THE PAGE ALREADY FETCHED — every version
 * string this practice has ever proposed, of either type, retired or not.
 * Only the ones sharing this exact `<slug>-<agreementType>-` prefix count;
 * that also means a version proposed before this feature existed, or under a
 * DIFFERENT practice name (a rename), simply does not collide — the counter
 * starts again under the new prefix, which is correct: it is a different
 * name, not the same series continuing.
 */
export function nextVersionName(
  practiceSlug: string,
  agreementType: AgreementTemplateType,
  existingVersions: readonly string[],
): string {
  const prefix = `${practiceSlug}-${agreementType}-`;
  let highest = 0;
  for (const version of existingVersions) {
    if (!version.startsWith(prefix)) continue;
    const suffix = version.slice(prefix.length);
    if (!/^[0-9]+$/.test(suffix)) continue;
    highest = Math.max(highest, Number(suffix));
  }
  return `${prefix}${highest + 1}`;
}

export function checkTemplateForm(
  form: TemplateFormState,
  input: {
    readonly agreementType: AgreementTemplateType;
    readonly version: string;
    readonly placeholders: readonly string[];
    readonly conditions: readonly string[];
    /** How to say "this element is missing" in the practice's language. */
    readonly missingElement: (element: string) => string;
    readonly needsTitle: string;
    readonly needsVersion: string;
    readonly needsStatementText: (key: string) => string;
  },
): TemplateFormProblem[] {
  const problems: TemplateFormProblem[] = [];
  const body = bodyFromForm(form);

  /*
   * THE FORM'S OWN THREE FIRST, because they are about fields rather than
   * about wording and the loader does not see them: the server refuses a
   * blank title, the DTO refuses a version that is not lower-kebab-and-number,
   * and a statement with no words is a tick box that says nothing.
   */
  if (!body.title) problems.push({ key: 'title', message: input.needsTitle });
  if (!TEMPLATE_VERSION_PATTERN.test(input.version.trim())) {
    problems.push({ key: 'version', message: input.needsVersion });
  }
  for (const statement of body.statements) {
    if (!statement.text) {
      problems.push({ key: `statement:${statement.key}`, message: input.needsStatementText(statement.key) });
    }
  }

  const declared = { placeholders: input.placeholders, conditions: input.conditions };
  const found: AgreementTemplateProblem[] = agreementTemplateProblems(
    candidateTemplate(form, input.agreementType, input.version.trim() || 'draft-1'),
    declared,
  );

  for (const [index, problem] of found.entries()) {
    problems.push({
      key: `${problem.kind}:${problem.element ?? index}`,
      ...(problem.element === undefined ? {} : { element: problem.element }),
      message:
        problem.kind === 'missing_element' && problem.element
          ? input.missingElement(problem.element)
          : problem.message,
    });
  }

  return problems;
}

/** Every s 65C element this agreement type must print — the domain's list, not ours. */
export function requiredElementsFor(type: AgreementTemplateType): readonly string[] {
  return REQUIRED_TEMPLATE_PLACEHOLDERS[type];
}

/**
 * INSERT A PLACEHOLDER WHERE THE CARET IS.
 *
 * PLACEHOLDERS ARE PICKED, NEVER TYPED (Carl, 7 Sep 2026). `{{patientNam}}` is
 * a template that renders literal braces onto a contract, and the loader would
 * refuse it — correctly, and after the fact. A menu of the placeholders the
 * generic declares cannot produce one that does not exist.
 *
 * Returns the new text and where the caret should sit afterwards: immediately
 * after the token, so somebody can carry on typing the sentence.
 */
export function insertAtCaret(
  text: string,
  start: number,
  end: number,
  token: string,
): { readonly text: string; readonly caret: number } {
  const head = text.slice(0, start);
  const tail = text.slice(end);
  return { text: `${head}${token}${tail}`, caret: head.length + token.length };
}

/**
 * WRAP THE SELECTION IN A CONDITION — "only when…".
 *
 * WITH NOTHING SELECTED IT STILL WORKS, and that is the point: the wrapper is
 * inserted empty around the caret, so somebody can pick "only on an agreement
 * made before the service" and then type the sentence inside it. The caret
 * lands between the two tags.
 */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  kind: 'if' | 'unless',
  condition: string,
): { readonly text: string; readonly caret: number } {
  const open = `{{#${kind} ${condition}}}`;
  const close = `{{/${kind}}}`;
  const head = text.slice(0, start);
  const selected = text.slice(start, end);
  const tail = text.slice(end);
  return {
    text: `${head}${open}${selected}${close}${tail}`,
    caret: head.length + open.length + selected.length,
  };
}

/**
 * OBVIOUSLY FAKE VALUES FOR THE PREVIEW, one for every declared placeholder.
 *
 * EVERY DECLARED PLACEHOLDER GETS ONE, including any this build has never
 * heard of: `renderAgreementTemplate` throws rather than printing braces, and
 * a preview that failed because the content file grew a placeholder would be a
 * preview that breaks on exactly the change it exists to show.
 *
 * NO REAL-LOOKING IDENTITY AND NO AMOUNT. The names are the repository's usual
 * obvious fakes, there is no Medicare number to sample because no artefact
 * carries one (hard rule 1), and nothing here is a figure (hard rule 4).
 */
export function sampleValuesFor(
  placeholders: readonly string[],
  conditions: readonly string[],
  samples: Readonly<Record<string, string>>,
  fallback: (key: string) => string,
): AgreementTemplateValues {
  const values: Record<string, string> = {};
  for (const key of placeholders) values[key] = samples[key] ?? fallback(key);

  /*
   * ONE BRANCH COMBINATION, AND THE PREVIEW SAYS SO. A document takes one
   * branch of each condition; showing both would be a preview of a document
   * that cannot exist. `isPreAgreement` true and `assignorIsPatient` false is
   * chosen because it renders the MOST of the wording — an agreement made
   * before the service, signed by somebody for the patient, which is the
   * branch carrying the assignor's own particulars. An unknown condition
   * defaults to true so a new branch shows its content rather than hiding it.
   */
  const resolved: Record<string, boolean> = {};
  for (const key of conditions) resolved[key] = key === 'assignorIsPatient' ? false : true;

  return { values, conditions: resolved };
}

/**
 * THE WORDS OF THE AGREEMENT ITSELF — loaded, validated, versioned (hard rule
 * 14; Carl, 5 Sep 2026, PMS_to_AoB_Workflow.md W1).
 *
 * WHY THE INSTRUMENT'S TEXT IS CONTENT AND NOT CODE. Until now the render
 * carried the patient's name and a consent sentence written inline in a React
 * component, and the tablet carried a second copy of that sentence in the
 * string table. Two copies of the operative words of a contract, in two
 * languages of the stack, neither versioned. This file is the one copy: the
 * tablet renders it and the PDF renders it, and the version travels onto every
 * agreement made from it, so a question asked in 2028 about what somebody
 * actually agreed to has an answer.
 *
 * WHAT THE LAW ACTUALLY REQUIRES, and what it does not (REQ-REG-04, REQ-REG-05):
 * the agreement must carry the D1-D7 data set, be a written document, state
 * whether the assignor is the patient, and be signed by the assignor. There is
 * NO approved form from 1 July 2026 and NO prescribed form of words. So the
 * templates carry the data set and the minimum affirmation a signature can
 * attach to. Everything they carry beyond that is a choice, and every such
 * choice is marked `draft_pending_review` until a human with the standing to
 * review legal copy has reviewed it.
 *
 * FOUR GUARDS RUN AT MODULE LOAD, so a bad edit fails at the bench rather than
 * in front of a patient — the same mechanism, for the same reason, as
 * `patient-message-templates.ts`:
 *
 *  1. No benefit and no dollar amount of any kind (hard rule 4). "Medicare
 *     benefit" is the thing being assigned and is fine; a figure is not.
 *  2. Nothing that reads as a practitioner signature line (hard rule 3 —
 *     abolished 1 July 2026, and the validator blocks it defensively).
 *  3. No "certified", "approved", "accredited" or "government-approved" about
 *     our forms (hard rule 12, REQ-65C-05).
 *  4. Every `{{placeholder}}` and `{{#if}}`/`{{#unless}}` condition used is
 *     declared — AND every D-element placeholder the type requires is actually
 *     used, because a template missing one renders an agreement missing a
 *     particular of the s 65C data set.
 *
 * THE SUBSTITUTION LANGUAGE IS DELIBERATELY TINY: `{{name}}`, and
 * `{{#if cond}}…{{/if}}` / `{{#unless cond}}…{{/unless}}` with no nesting. It
 * is not Handlebars and must never grow into it. A template language rich
 * enough to express logic is a place for logic to hide, and the logic that
 * decides what a contract says belongs in the rules engine and the lock.
 *
 * Validation is hand-written and runs at load for the reason
 * `assignor-relationships.ts` gives: `@aobplatform/domain` has zero runtime
 * dependencies by charter, and the browser bundle imports this too.
 */
import content from '../content/agreement-templates.json';

/** The two instruments. `episodic` covers pre and post — see the content file. */
export const AGREEMENT_TEMPLATE_TYPES = ['episodic', 'enduring'] as const;
export type AgreementTemplateType = (typeof AGREEMENT_TEMPLATE_TYPES)[number];

/**
 * `draft_pending_review` is where every template in this repository starts and,
 * as at 5 September 2026, where all of them still are. `active_generic` is set
 * only after Carl and counsel have read the words.
 */
export const AGREEMENT_TEMPLATE_STATUSES = ['draft_pending_review', 'active_generic'] as const;
export type AgreementTemplateStatus = (typeof AGREEMENT_TEMPLATE_STATUSES)[number];

/** One thing the assignor ticks. The KEY is recorded on the signature, never the text. */
export interface AgreementTemplateStatement {
  /** `lower_snake_case_v<n>`. A rewrite mints a new key so an old record still says what was affirmed. */
  readonly key: string;
  readonly text: string;
}

export interface AgreementTemplateSection {
  readonly key: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface AgreementTemplate {
  readonly id: string;
  /** Recorded on every agreement made from it (hard rule 14). */
  readonly version: string;
  readonly agreementType: AgreementTemplateType;
  readonly status: AgreementTemplateStatus;
  readonly title: string;
  /** What this template is for. Never rendered. */
  readonly note: string;
  readonly sections: readonly AgreementTemplateSection[];
  /** Exactly the affirmations the assignor ticks. Order is screen order. */
  readonly statements: readonly AgreementTemplateStatement[];
  readonly footer: readonly string[];
}

export interface AgreementTemplateContent {
  readonly version: string;
  /** Every `{{value}}` a template may use. */
  readonly placeholders: readonly string[];
  /** Every `{{#if}}` / `{{#unless}}` a template may branch on. */
  readonly conditions: readonly string[];
  readonly templates: readonly AgreementTemplate[];
}

/**
 * THE D-ELEMENTS EVERY TEMPLATE OF A TYPE MUST ACTUALLY PRINT (REQ-REG-01 for
 * episodic; REQ-END-02 / reg 65CB for enduring).
 *
 * This is the list that makes the loader a compliance check rather than a
 * syntax check. A practice may rewrite every sentence on its own agreement —
 * that is what the per-practice variant is for — but it may not drop a
 * particular, and this is the line that says so before anything is stored,
 * rendered or signed.
 *
 * EPISODIC: D1 patientName, D2 agreementDate, D3 isPreAgreement (the document
 * states which it is, in its own words, on both branches), D4 providerDetails
 * (name + place of practice, or provider number — REQ-REG-02 (a) OR (b),
 * assembled by the lock), D5 serviceDate, D6a basicServiceDescription and D6b
 * mbsItemNumbers (each on its own branch), D7 assignorIsPatient plus the
 * assignor's name and relationship on the branch where they are not the
 * patient.
 *
 * ENDURING: reg 65CB's content set as REQ-END-02 records it. There is
 * deliberately no serviceDate and no basic service description — a standing
 * agreement has neither.
 *
 * ONE ELEMENT HERE IS NOT SOURCED FROM THE DOCS AND IS FLAGGED AS SUCH:
 * `commencementDate`. REQ-END-02's list has "signature and date" and
 * `EnduringDetail.enteredIntoAt` is "the date the agreement was entered into";
 * neither is called a commencement. The lock therefore substitutes the
 * agreement's own D2 date for it rather than inventing a separate field, and
 * the naming says openly that the two are the same day. If the regulation does
 * carry a distinct commencement element, this is where it goes.
 */
export const REQUIRED_TEMPLATE_PLACEHOLDERS: Readonly<
  Record<AgreementTemplateType, readonly string[]>
> = {
  episodic: [
    'patientName',
    'agreementDate',
    'isPreAgreement',
    'providerDetails',
    'serviceDate',
    'basicServiceDescription',
    'mbsItemNumbers',
    'assignorIsPatient',
    'assignorName',
    'assignorRelationship',
  ],
  enduring: [
    'patientName',
    'agreementDate',
    'providerDetails',
    'enduringPathway',
    'coveredServiceScope',
    'commencementDate',
    'notificationMethod',
    'terminationMethod',
    'assignorIsPatient',
    'assignorName',
    'assignorRelationship',
  ],
};

/**
 * Hard rule 4 — no benefit figure and no dollar amount, in any shape.
 *
 * "MEDICARE BENEFIT" IS NOT AN AMOUNT and must not be caught: it is the thing
 * s 65C assigns, so an agreement that could not say it could not exist. What
 * is refused is a currency symbol, a currency code, the word dollars, a
 * decimal figure that reads as money, and the phrases that name a figure.
 */
const AMOUNT =
  /(\$|¢|€|£|\bAUD\b|\bdollars?\b|\bcents?\b|\bbenefit amount\b|\brebate\b|\bfee\b|\bgap payment\b|\bout of pocket\b|\b\d+\.\d{2}\b)/i;

/**
 * Hard rule 3 — the practitioner signature was abolished on 1 July 2026, and
 * the defensive block is the point: nothing on any artefact may offer a place
 * for one, including a per-practice variant written by somebody who last saw a
 * DB4E form.
 *
 * The patterns are about the PRACTITIONER's mark specifically. "signed by the
 * assignor" and "the patient is signing" are the instrument working correctly.
 */
const PRACTITIONER_SIGNATURE =
  /((practitioner|provider|doctor|gp|physician|clinician)(['’]s)?\s+(signature|sign here|to sign)|signature of (the )?(practitioner|provider|doctor|physician|clinician)|signed by (the )?(practitioner|provider|doctor|physician|clinician))/i;

/** Hard rule 12 — never about our forms. */
const FORBIDDEN_WORDS = /\b(certified|accredited|government-approved|approved)\b/i;

/** Hard rule 1 — the card number is not an identifier and is never on an artefact. */
const MEDICARE_NUMBER = /medicare[\s-]*(card[\s-]*)?(number|no\.?|num\b)/i;

const VALUE_PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
const BLOCK_OPEN = /\{\{#(if|unless)\s+([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
const BLOCK_CLOSE = /\{\{\/(if|unless)\}\}/g;
/** Anything moustache-shaped that neither of the three above matched. */
const ANY_MOUSTACHE = /\{\{[^}]*\}\}/g;

export class AgreementTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgreementTemplateError';
  }
}

/**
 * Validate one template body — the shape a PRACTICE VARIANT is checked against
 * too, which is why it is exported separately from the whole-file parse. A
 * practice proposing its own wording gets exactly these refusals, live, with
 * the reason shown, rather than discovering them at a tablet.
 *
 * `where` names the thing being checked in every message, because the same
 * function reports on `content/agreement-templates.json` and on a body typed
 * into a console form ten seconds ago.
 */
export function assertAgreementTemplateBody(
  template: AgreementTemplate,
  declared: { readonly placeholders: readonly string[]; readonly conditions: readonly string[] },
  where: string,
): void {
  const fail = (why: string): never => {
    throw new AgreementTemplateError(`${where}: ${why}`);
  };

  const lines: string[] = [
    template.title,
    ...template.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
    ...template.statements.map((s) => s.text),
    ...template.footer,
  ];

  const placeholders = new Set(declared.placeholders);
  const conditions = new Set(declared.conditions);
  const used = new Set<string>();

  for (const line of lines) {
    if (AMOUNT.test(line)) {
      fail(
        `"${trim(line)}" carries a benefit or dollar amount. No agreement artefact may (hard rule 4, ` +
          'REQ-REG-04) — a reg 89AA notice is a different document and is not made from these templates',
      );
    }
    if (PRACTITIONER_SIGNATURE.test(line)) {
      fail(
        `"${trim(line)}" offers a practitioner signature. That was abolished on 1 July 2026 and no ` +
          'artefact may carry one (hard rule 3)',
      );
    }
    if (FORBIDDEN_WORDS.test(line)) {
      fail(
        `"${trim(line)}" says "certified", "approved", "accredited" or "government-approved". None is ` +
          'ever permitted about our forms; the permitted phrase is "checked against the s 65C data set" ' +
          '(hard rule 12, REQ-65C-05)',
      );
    }
    if (MEDICARE_NUMBER.test(line)) {
      fail(
        `"${trim(line)}" mentions a Medicare card number. It is not an identity identifier, the ` +
          'exclusion is not configurable, and no artefact carries one (hard rule 1, REQ-VER-02)',
      );
    }

    // Balance first: an unbalanced block would silently swallow the rest of a
    // paragraph at render time, which is how a particular disappears quietly.
    const opens = [...line.matchAll(BLOCK_OPEN)];
    const closes = [...line.matchAll(BLOCK_CLOSE)];
    if (opens.length !== closes.length) {
      fail(`"${trim(line)}" has ${opens.length} {{#if/#unless}} and ${closes.length} {{/if or /unless}}`);
    }
    for (const [, , name] of opens) {
      if (!conditions.has(name)) fail(`"${trim(line)}" branches on {{#…${name}}}, which is not a declared condition`);
      used.add(name);
    }
    for (const [, name] of line.matchAll(VALUE_PLACEHOLDER)) {
      if (!placeholders.has(name)) fail(`"${trim(line)}" uses {{${name}}}, which is not a declared placeholder`);
      used.add(name);
    }

    // Anything moustache-shaped that none of the three patterns recognised is
    // a typo that would ship as literal braces on a contract.
    const recognised = new Set([
      ...line.match(VALUE_PLACEHOLDER) ?? [],
      ...line.match(BLOCK_OPEN) ?? [],
      ...line.match(BLOCK_CLOSE) ?? [],
    ]);
    for (const token of line.match(ANY_MOUSTACHE) ?? []) {
      if (!recognised.has(token)) fail(`"${trim(line)}" contains ${token}, which is not a placeholder or a block`);
    }
  }

  for (const required of REQUIRED_TEMPLATE_PLACEHOLDERS[template.agreementType]) {
    if (!used.has(required)) {
      fail(
        `it never renders {{${required}}}. Every ${template.agreementType} agreement must carry the whole ` +
          'data set (REQ-REG-01 D1-D7 / reg 65CB per REQ-END-02); a template that drops one produces an ' +
          'agreement missing a statutory particular',
      );
    }
  }

  if (template.statements.length === 0) {
    fail('it has no statements. The assignor ticks each statement before the signature control can enable');
  }
}

export function parseAgreementTemplates(raw: unknown): AgreementTemplateContent {
  const fail = (why: string): never => {
    throw new AgreementTemplateError(
      `content/agreement-templates.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  for (const field of ['placeholders', 'conditions'] as const) {
    if (!Array.isArray(doc[field]) || (doc[field] as unknown[]).some((p) => typeof p !== 'string')) {
      return fail(`\`${field}\` must be an array of strings`);
    }
  }
  if (!Array.isArray(doc.templates) || doc.templates.length === 0) {
    return fail('`templates` must be a non-empty array');
  }

  const declared = {
    placeholders: doc.placeholders as readonly string[],
    conditions: doc.conditions as readonly string[],
  };
  const seenIds = new Set<string>();
  const seenTypes = new Set<string>();

  const templates = (doc.templates as unknown[]).map((entry, index) => {
    const template = parseOneTemplate(entry, `templates[${index}]`, fail);
    if (seenIds.has(template.id)) return fail(`templates[${index}].id "${template.id}" appears twice`);
    seenIds.add(template.id);
    if (seenTypes.has(template.agreementType)) {
      return fail(
        `templates[${index}] is a second generic template for "${template.agreementType}". There is one ` +
          'generic per type; a practice that wants different words proposes a practice variant',
      );
    }
    seenTypes.add(template.agreementType);
    assertAgreementTemplateBody(template, declared, `content/agreement-templates.json templates[${index}]`);
    return template;
  });

  for (const type of AGREEMENT_TEMPLATE_TYPES) {
    if (!seenTypes.has(type)) return fail(`there is no generic template for "${type}"`);
  }

  return { version: doc.version, ...declared, templates };
}

function parseOneTemplate(
  entry: unknown,
  at: string,
  fail: (why: string) => never,
): AgreementTemplate {
  if (typeof entry !== 'object' || entry === null) return fail(`${at} is not an object`);
  const t = entry as Record<string, unknown>;

  if (typeof t.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(t.id)) {
    return fail(`${at}.id must be a lower-kebab-case identifier`);
  }
  if (typeof t.version !== 'string' || !/^[a-z][a-z0-9-]*-[0-9]+$/.test(t.version)) {
    return fail(`${at}.version must end in a number, e.g. episodic-generic-1 — a rewrite mints a new version`);
  }
  if (
    typeof t.agreementType !== 'string' ||
    !(AGREEMENT_TEMPLATE_TYPES as readonly string[]).includes(t.agreementType)
  ) {
    return fail(`${at}.agreementType must be one of: ${AGREEMENT_TEMPLATE_TYPES.join(', ')}`);
  }
  if (
    typeof t.status !== 'string' ||
    !(AGREEMENT_TEMPLATE_STATUSES as readonly string[]).includes(t.status)
  ) {
    return fail(`${at}.status must be one of: ${AGREEMENT_TEMPLATE_STATUSES.join(', ')}`);
  }
  for (const field of ['title', 'note'] as const) {
    if (typeof t[field] !== 'string' || (t[field] as string).trim().length === 0) {
      return fail(`${at}.${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(t.sections) || t.sections.length === 0) return fail(`${at}.sections must be a non-empty array`);
  if (!Array.isArray(t.footer) || (t.footer as unknown[]).some((p) => typeof p !== 'string')) {
    return fail(`${at}.footer must be an array of strings`);
  }
  if (!Array.isArray(t.statements) || t.statements.length === 0) {
    return fail(`${at}.statements must be a non-empty array — the assignor ticks each one`);
  }

  const sections = (t.sections as unknown[]).map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return fail(`${at}.sections[${i}] is not an object`);
    const s = raw as Record<string, unknown>;
    if (typeof s.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(s.key)) {
      return fail(`${at}.sections[${i}].key must be a lower_snake_case identifier`);
    }
    if (typeof s.heading !== 'string') return fail(`${at}.sections[${i}].heading must be a string`);
    if (!Array.isArray(s.paragraphs) || (s.paragraphs as unknown[]).some((p) => typeof p !== 'string')) {
      return fail(`${at}.sections[${i}].paragraphs must be an array of strings`);
    }
    return { key: s.key, heading: s.heading, paragraphs: s.paragraphs as readonly string[] };
  });

  const seenKeys = new Set<string>();
  const statements = (t.statements as unknown[]).map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) return fail(`${at}.statements[${i}] is not an object`);
    const s = raw as Record<string, unknown>;
    if (typeof s.key !== 'string' || !/^[a-z][a-z0-9_]*_v[0-9]+$/.test(s.key)) {
      return fail(
        `${at}.statements[${i}].key must be a versioned lower_snake_case identifier, e.g. ` +
          'episodic_assign_v1 — the KEY is what a signature records, so a rewritten statement mints a new one',
      );
    }
    if (seenKeys.has(s.key)) return fail(`${at}.statements[${i}].key "${s.key}" appears twice`);
    seenKeys.add(s.key);
    if (typeof s.text !== 'string' || s.text.trim().length === 0) {
      return fail(`${at}.statements[${i}].text must be a non-empty string`);
    }
    return { key: s.key, text: s.text };
  });

  return {
    id: t.id,
    version: t.version,
    agreementType: t.agreementType as AgreementTemplateType,
    status: t.status as AgreementTemplateStatus,
    title: t.title as string,
    note: t.note as string,
    sections,
    statements,
    footer: t.footer as readonly string[],
  };
}

function trim(line: string): string {
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

const parsed = parseAgreementTemplates(content);

export const AGREEMENT_TEMPLATES: AgreementTemplateContent = parsed;
/** Recorded beside the template id and version on every agreement. */
export const AGREEMENT_TEMPLATES_VERSION: string = parsed.version;

/**
 * WHICH TEMPLATE TYPE AN AGREEMENT TYPE USES. `episodic_pre`, `episodic_post`
 * and `treatment_plan` are all one instrument with one signing occasion; only
 * `enduring` is the other one.
 */
export function templateTypeFor(agreementType: string): AgreementTemplateType {
  return agreementType === 'enduring' ? 'enduring' : 'episodic';
}

export function genericAgreementTemplate(type: AgreementTemplateType): AgreementTemplate {
  const found = parsed.templates.find((t) => t.agreementType === type);
  if (!found) {
    // Unreachable — the parser refuses a file missing a type — and stated
    // rather than asserted, because the alternative is a `!` that hides it.
    throw new AgreementTemplateError(`No generic agreement template for "${type}".`);
  }
  return found;
}

/** What a substitution is given: strings for values, booleans for branches. */
export interface AgreementTemplateValues {
  readonly values: Readonly<Record<string, string>>;
  readonly conditions: Readonly<Record<string, boolean>>;
}

export interface RenderedAgreementTemplate {
  readonly templateId: string;
  readonly templateVersion: string;
  readonly status: AgreementTemplateStatus;
  readonly title: string;
  readonly sections: readonly { readonly key: string; readonly heading: string; readonly paragraphs: readonly string[] }[];
  readonly statements: readonly AgreementTemplateStatement[];
  readonly footer: readonly string[];
}

/**
 * Substitute the values in, resolving the branches first.
 *
 * A MISSING VALUE THROWS RATHER THAN RENDERING BRACES, for the reason
 * `renderPatientMessage` gives and one stronger: this is a contract. An
 * agreement reading "I assign my right to the Medicare benefit … to
 * {{providerName}}" is not a defective document, it is an unidentifiable
 * counterparty. The lock catches it before anything is hashed.
 *
 * AN EMPTY PARAGRAPH IS DROPPED, and only after substitution. `{{#if
 * isPreAgreement}}…{{/if}}` on a post-agreement resolves to nothing, and a
 * blank line on a rendered contract looks like something that failed to print.
 */
export function renderAgreementTemplate(
  template: AgreementTemplate,
  input: AgreementTemplateValues,
): RenderedAgreementTemplate {
  const line = (text: string, at: string): string => substitute(text, input, `${template.version} ${at}`);
  return {
    templateId: template.id,
    templateVersion: template.version,
    status: template.status,
    title: line(template.title, 'title'),
    sections: template.sections
      .map((s) => ({
        key: s.key,
        heading: line(s.heading, `sections.${s.key}.heading`),
        paragraphs: s.paragraphs
          .map((p, i) => line(p, `sections.${s.key}.paragraphs[${i}]`))
          .filter((p) => p.length > 0),
      }))
      .filter((s) => s.paragraphs.length > 0),
    statements: template.statements.map((s) => ({ key: s.key, text: line(s.text, `statements.${s.key}`) })),
    footer: template.footer.map((f, i) => line(f, `footer[${i}]`)).filter((f) => f.length > 0),
  };
}

function substitute(text: string, input: AgreementTemplateValues, at: string): string {
  // Blocks first: a placeholder inside a branch that is not taken must never
  // be required to have a value.
  const resolved = text.replace(
    /\{\{#(if|unless)\s+([a-zA-Z][a-zA-Z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_whole, kind: string, name: string, body: string) => {
      const value = input.conditions[name];
      if (typeof value !== 'boolean') {
        throw new AgreementTemplateError(`${at}: no value for the condition {{#${kind} ${name}}}.`);
      }
      return (kind === 'if') === value ? body : '';
    },
  );

  return resolved
    .replace(VALUE_PLACEHOLDER, (_whole, name: string) => {
      const value = input.values[name];
      if (typeof value !== 'string' || value.length === 0) {
        throw new AgreementTemplateError(
          `${at}: no value for {{${name}}}. An agreement is not rendered with a particular missing — ` +
            'the lock assembles every element before anything is hashed (hard rule 2).',
        );
      }
      return value;
    })
    .trim();
}

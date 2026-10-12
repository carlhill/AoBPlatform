/**
 * THE WORDS OF EVERY PORTAL-RELATED MESSAGE WE SEND A PATIENT — loaded,
 * validated and versioned (hard rule 14; TODO.md "The message copy itself, in
 * every channel").
 *
 * WHY THE COPY IS NOT IN THE DISPATCHER. Every other patient message on this
 * platform was written inline where it is sent, which is how the templates
 * came to be inconsistent in voice and unreviewable as a set. Message copy is
 * content: it changes without a code change, it is reviewed as writing, and
 * the version it went out under travels with the record it produced. This is
 * the same mechanism `enduring-termination-notice.ts` uses, for the same
 * reason.
 *
 * THE RECORD ID LINE IS ITS OWN TEMPLATE, and that is the whole point of the
 * file (Carl, 4 Sep 2026). A patient can check that a page, a passkey and a
 * message all quote one id — `AoBPlatform-PatientId-<accountId>` — but only if
 * every message says it the same way. One template, appended by one helper,
 * means there is no second wording to drift.
 *
 * FIVE GUARDS RUN AT MODULE LOAD, so a bad edit fails at the bench rather than
 * in front of a patient:
 *
 *  1. No "certified", "approved", "accredited" or "government-approved"
 *     (hard rule 12, REQ-65C-05).
 *  2. No benefit and no dollar amount of any kind (hard rule 4). Reg 89AA
 *     notices are the one artefact that carries one and they are not sent from
 *     here.
 *  3. No Medicare card number, and no invitation to supply one (hard rule 1,
 *     REQ-VER-02).
 *  4. Every `{{placeholder}}` used is declared, so a typo cannot ship as
 *     literal braces in somebody's inbox.
 *  5. Template keys are versioned identifiers (`portal_invitation_v1`), so a
 *     rewrite mints a new key rather than silently changing what an old record
 *     says it was sent under.
 *
 * Validation is hand-written and runs at load for the two reasons
 * `assignor-relationships.ts` gives: `@aobplatform/domain` has zero runtime
 * dependencies by charter, and a malformed edit should fail the build.
 */
import content from '../content/patient-message-templates.json';

export interface PatientMessageTemplate {
  /** `lower_snake_case_v<n>`. Recorded against every message sent from it. */
  readonly key: string;
  /** What this message is for. Never rendered. */
  readonly note: string;
  /** Email subject. Absent for a fragment such as the record-id line. */
  readonly subject?: string;
  /** The body, in order. The first is the greeting where there is one. */
  readonly paragraphs: readonly string[];
  /** The label on the one action button, where the message has one. */
  readonly actionLabel?: string;
  /** Quieter than body text — expiry notes, the record-id line. */
  readonly smallPrint?: readonly string[];
  /** The whole message in one line, for the SMS channel. */
  readonly sms?: string;
}

export interface PatientMessageTemplates {
  /** Bumped on every edit; recorded beside the template key. */
  readonly version: string;
  /** The substitutions any template may use. Keys, never values. */
  readonly placeholders: readonly string[];
  readonly templates: readonly PatientMessageTemplate[];
}

/** Hard rule 12 — never about our forms, and never anywhere in these. */
const FORBIDDEN_WORDS = /\b(certified|accredited|government-approved|approved)\b/i;
/** Hard rule 4 — no benefit figure, no dollar amount, in any shape. */
const AMOUNT = /(\$|\bAUD\b|\bdollars?\b|\bbenefit amount\b|\brebate\b)/i;
/** Hard rule 1 — the card number is not an identifier and is never asked for. */
const MEDICARE_NUMBER = /medicare[\s-]*(card[\s-]*)?(number|no\.?|num\b)/i;
/** A message must never imply the platform can stop care (hard rule 8). */
const PLACEHOLDER = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

export function parsePatientMessageTemplates(raw: unknown): PatientMessageTemplates {
  const fail = (why: string): never => {
    throw new Error(
      `content/patient-message-templates.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.placeholders) || doc.placeholders.some((p) => typeof p !== 'string')) {
    return fail('`placeholders` must be an array of strings');
  }
  if (!Array.isArray(doc.templates) || doc.templates.length === 0) {
    return fail('`templates` must be a non-empty array');
  }

  const declared = new Set(doc.placeholders as string[]);
  const seen = new Set<string>();

  const templates = doc.templates.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`templates[${index}] is not an object`);
    const t = entry as Record<string, unknown>;

    if (typeof t.key !== 'string' || !/^[a-z][a-z0-9_]*_v[0-9]+$/.test(t.key)) {
      return fail(
        `templates[${index}].key must be a versioned lower_snake_case identifier, e.g. portal_invitation_v1 — ` +
          'a rewrite mints a new key so an old record still says what it was sent under',
      );
    }
    if (seen.has(t.key)) return fail(`templates[${index}].key "${t.key}" appears twice`);
    seen.add(t.key);

    if (typeof t.note !== 'string' || t.note.trim().length === 0) {
      return fail(`templates[${index}].note must say what the message is for`);
    }
    if (!Array.isArray(t.paragraphs) || t.paragraphs.length === 0 || t.paragraphs.some((p) => typeof p !== 'string')) {
      return fail(`templates[${index}].paragraphs must be a non-empty array of strings`);
    }
    for (const field of ['subject', 'actionLabel', 'sms'] as const) {
      if (t[field] !== undefined && typeof t[field] !== 'string') {
        return fail(`templates[${index}].${field} must be a string when present`);
      }
    }
    if (t.smallPrint !== undefined && (!Array.isArray(t.smallPrint) || t.smallPrint.some((p) => typeof p !== 'string'))) {
      return fail(`templates[${index}].smallPrint must be an array of strings when present`);
    }

    const words: string[] = [
      ...(t.paragraphs as string[]),
      ...((t.smallPrint as string[] | undefined) ?? []),
      ...(typeof t.subject === 'string' ? [t.subject] : []),
      ...(typeof t.actionLabel === 'string' ? [t.actionLabel] : []),
      ...(typeof t.sms === 'string' ? [t.sms] : []),
    ];

    for (const line of words) {
      if (FORBIDDEN_WORDS.test(line)) {
        return fail(
          `templates[${index}] ("${t.key}") uses one of "certified", "approved", "accredited" or ` +
            '"government-approved" — never permitted about our forms (hard rule 12, REQ-65C-05)',
        );
      }
      if (AMOUNT.test(line)) {
        return fail(
          `templates[${index}] ("${t.key}") carries a benefit or dollar amount. No agreement artefact or ` +
            'message about one may (hard rule 4); a reg 89AA notice is a different document',
        );
      }
      if (MEDICARE_NUMBER.test(line)) {
        return fail(
          `templates[${index}] ("${t.key}") mentions a Medicare card number. It is not an identity ` +
            'identifier, the exclusion is not configurable, and no message asks for one (hard rule 1, REQ-VER-02)',
        );
      }
      for (const [, name] of line.matchAll(PLACEHOLDER)) {
        if (!declared.has(name)) {
          return fail(`templates[${index}] ("${t.key}") uses {{${name}}}, which is not a declared placeholder`);
        }
      }
    }

    return {
      key: t.key,
      note: t.note,
      subject: typeof t.subject === 'string' ? t.subject : undefined,
      paragraphs: t.paragraphs as readonly string[],
      actionLabel: typeof t.actionLabel === 'string' ? t.actionLabel : undefined,
      smallPrint: (t.smallPrint as readonly string[] | undefined) ?? undefined,
      sms: typeof t.sms === 'string' ? t.sms : undefined,
    };
  });

  return { version: doc.version, placeholders: doc.placeholders as readonly string[], templates };
}

const parsed = parsePatientMessageTemplates(content);

export const PATIENT_MESSAGE_TEMPLATES: PatientMessageTemplates = parsed;
/** Recorded beside every message sent from this file. */
export const PATIENT_MESSAGE_TEMPLATES_VERSION: string = parsed.version;

/** The offer of portal activation (FR-1.14). */
export const PORTAL_INVITATION_TEMPLATE_KEY = 'portal_invitation_v1';
/** The one sentence every portal-related message ends with. */
export const PORTAL_RECORD_ID_LINE_TEMPLATE_KEY = 'portal_record_id_line_v1';

export function patientMessageTemplate(key: string): PatientMessageTemplate {
  const found = parsed.templates.find((t) => t.key === key);
  if (!found) {
    throw new Error(
      `No patient message template "${key}". The templates are content — add it to ` +
        'content/patient-message-templates.json rather than writing the words at the send site.',
    );
  }
  return found;
}

export interface RenderedPatientMessage {
  readonly templateKey: string;
  readonly templateVersion: string;
  readonly subject?: string;
  readonly paragraphs: readonly string[];
  readonly actionLabel?: string;
  readonly smallPrint: readonly string[];
  readonly sms?: string;
}

/**
 * Substitute the values in.
 *
 * A MISSING VALUE THROWS RATHER THAN RENDERING BRACES. A message that reached
 * a patient reading "Your AoBPlatform record ID is {{recordId}}" would be
 * worse than no message: the sentence exists to make a forgery detectable, and
 * a broken one teaches the reader to ignore it.
 */
export function renderPatientMessage(
  key: string,
  values: Readonly<Record<string, string>>,
): RenderedPatientMessage {
  const template = patientMessageTemplate(key);
  const fill = (line: string): string =>
    line.replace(PLACEHOLDER, (_match, name: string) => {
      const value = values[name];
      if (value === undefined || value.length === 0) {
        throw new Error(
          `Rendering "${key}" needs a value for {{${name}}} and none was given. The message is not sent ` +
            'rather than sent with a placeholder in it.',
        );
      }
      return value;
    });

  return {
    templateKey: template.key,
    templateVersion: parsed.version,
    subject: template.subject === undefined ? undefined : fill(template.subject),
    paragraphs: template.paragraphs.map(fill),
    actionLabel: template.actionLabel,
    smallPrint: (template.smallPrint ?? []).map(fill),
    sms: template.sms === undefined ? undefined : fill(template.sms),
  };
}

/**
 * The one sentence, ready to append (Carl, 4 Sep 2026).
 *
 * IT IS A FUNCTION AND NOT A CONSTANT so that the words stay in the content
 * file. Every caller that has a portal-linked recipient appends exactly this.
 */
export function portalRecordIdLine(recordId: string): string {
  return renderPatientMessage(PORTAL_RECORD_ID_LINE_TEMPLATE_KEY, { recordId }).paragraphs[0];
}

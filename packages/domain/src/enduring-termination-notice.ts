/**
 * THE WRITTEN NOTICE A PATIENT'S TERMINATION GENERATES — its SHAPE, loaded and
 * validated; its WORDS, deliberately absent (REQ-PORT-05, 65CA(7)(b), FR-5.3).
 *
 * WHY THE TEXT IS NOT IN THIS REPOSITORY YET. Statutory notice wording is
 * human-authored regulatory copy. CLAUDE.md is explicit that section numbers,
 * dates and thresholds come from the requirements documents and are never
 * inferred — and a notice is precisely a document made of those. So the
 * content file ships with every section body empty and `draft: true`, this
 * loader refuses a file that claims otherwise without saying so, and the portal
 * writes every notice it produces as `draft_pending_review` with a review task
 * beside it. A blank notice that a person must release is a slow termination;
 * an invented notice that goes out on its own is a wrong one.
 *
 * WHY IT IS CONTENT AND NOT A TEMPLATE STRING IN CODE (hard rule 14). This
 * regime moved twice and reversed once. When the wording is written it must be
 * editable, versioned, and the version must travel with every notice produced
 * from it — which is exactly what `ENDURING_TERMINATION_NOTICE_VERSION` is for.
 *
 * Validation is hand-written and runs at module load, for the same two reasons
 * `assignor-relationships.ts` gives: `@aobplatform/domain` has zero runtime
 * dependencies by charter, and a malformed edit should fail at the bench rather
 * than at the moment a patient ends an agreement.
 */
import content from '../content/enduring-termination-notice.json';

export interface EnduringTerminationNoticeSection {
  /** Stable key. The string table and the eventual renderer are keyed by this. */
  readonly key: string;
  /** The words. EMPTY while the template is a draft. */
  readonly body: string;
  /** What a reviewer is being asked to write here. Never rendered. */
  readonly note: string;
}

export interface EnduringTerminationNoticeTemplate {
  /** Recorded on every notice row produced from this file. */
  readonly templateKey: string;
  /** Bumped on every edit; recorded beside `templateKey`. */
  readonly version: string;
  /** TRUE until a human has written and reviewed the wording. */
  readonly draft: boolean;
  /** The substitutions a section body may use. Keys, never values. */
  readonly placeholders: readonly string[];
  /** ORDER IS THE ORDER IN THE DOCUMENT. */
  readonly sections: readonly EnduringTerminationNoticeSection[];
}

export function parseEnduringTerminationNotice(raw: unknown): EnduringTerminationNoticeTemplate {
  const fail = (why: string): never => {
    throw new Error(
      `content/enduring-termination-notice.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.templateKey !== 'string' || !/^[a-z][a-z0-9_]*$/.test(doc.templateKey)) {
    return fail('`templateKey` must be a lower_snake_case identifier');
  }
  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (typeof doc.draft !== 'boolean') return fail('`draft` must be a boolean — say plainly whether this is written yet');
  if (!Array.isArray(doc.placeholders) || doc.placeholders.some((p) => typeof p !== 'string')) {
    return fail('`placeholders` must be an array of strings');
  }
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
    return fail('`sections` must be a non-empty array');
  }

  const seen = new Set<string>();
  const sections = doc.sections.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`sections[${index}] is not an object`);
    const section = entry as Record<string, unknown>;
    if (typeof section.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(section.key)) {
      return fail(`sections[${index}].key must be a lower_snake_case identifier`);
    }
    if (seen.has(section.key)) return fail(`sections[${index}].key "${section.key}" appears twice`);
    seen.add(section.key);
    if (typeof section.body !== 'string') return fail(`sections[${index}].body must be a string (empty while draft)`);
    if (typeof section.note !== 'string' || section.note.trim().length === 0) {
      return fail(`sections[${index}].note must say what a reviewer has to write there`);
    }
    return { key: section.key, body: section.body, note: section.note };
  });

  /*
   * THE ONE CONSISTENCY RULE THAT MATTERS. A file marked ready with nothing
   * written in it would let a blank notice through as if a person had approved
   * it — the exact failure the draft marker exists to prevent.
   */
  if (doc.draft === false && sections.every((s) => s.body.trim().length === 0)) {
    return fail('`draft` is false but every section body is empty — a notice with no words is not a written notice');
  }

  return {
    templateKey: doc.templateKey,
    version: doc.version,
    draft: doc.draft,
    placeholders: doc.placeholders as readonly string[],
    sections,
  };
}

const parsed = parseEnduringTerminationNotice(content);

export const ENDURING_TERMINATION_NOTICE: EnduringTerminationNoticeTemplate = parsed;
/** `enduring_termination_notice_v1` — recorded on every notice row. */
export const ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY: string = parsed.templateKey;
export const ENDURING_TERMINATION_NOTICE_VERSION: string = parsed.version;
/** True while the wording is unwritten. Every notice produced stays a draft. */
export const ENDURING_TERMINATION_NOTICE_IS_DRAFT: boolean = parsed.draft;

/**
 * The only status a portal-generated termination notice may hold today.
 *
 * A constant rather than a literal at the call site, so that the day the
 * wording is written and reviewed there is one place to widen — and until then
 * no caller can spell a different status by accident.
 */
export const TERMINATION_NOTICE_DRAFT_STATUS = 'draft_pending_review' as const;

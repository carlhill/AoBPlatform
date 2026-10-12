/**
 * THE RELATIONSHIP THE PERSON SIGNING RECOGNISES, and the legal authority
 * basis derived from it. Carl, 3 Sep 2026.
 *
 * WHY A DERIVATION AND NOT A SECOND QUESTION. The tablet used to show the
 * authority list itself — `co_resident_relative_18_plus`, `health_epoa` — to
 * the person standing beside the patient. That is the statute's vocabulary and
 * nobody else's: a daughter who has driven her father to the surgery is being
 * asked to classify herself under reg 65CB(5), and the two answers a form gets
 * out of that are a guess and a wrong guess. So the screen asks the one thing
 * the person knows for certain, and the basis is derived.
 *
 * WHY THE MAPPING IS IN A JSON FILE AND NOT IN THIS MODULE (hard rule 14,
 * Carl's refinement the same day). `content/assignor-relationships.json` is
 * VERSIONED CONTENT: the list of relationships a practice offers, and the
 * basis each maps onto, can be changed by editing that file — no code change,
 * no deploy of new logic, and a `version` string that travels with every
 * assignor recorded from it. Regulatory whipsaw is the top project risk and
 * versioned content is the defence; a mapping written as a `switch` here would
 * be the third copy of that mistake in this codebase.
 *
 * WHY THE VALIDATION IS HAND-WRITTEN AND NOT ZOD. `@aobplatform/domain` has
 * zero runtime dependencies by charter (CONVENTIONS.md §1), and this package is
 * imported by the browser bundle as well as by three Nest services. The
 * checking below is exhaustive and throws on the first thing it does not like,
 * which is what a schema library would do — it just costs nothing to ship.
 *
 * IT RUNS AT MODULE LOAD, deliberately. A malformed edit fails the build and
 * the test run, loudly, at the bench — not at a tablet in a waiting room with
 * somebody standing in front of it.
 *
 * NOT HERE: the display words. "Father", "Mother", "Spouse" live in the string
 * table keyed by `key` (REQ-LANG-01/-02) because they will be translated, and a
 * translated word must never be able to change a legal mapping.
 *
 * NOT HERE EITHER: anything about capacity (REQ-VUL-05). There is no parameter
 * for it and no branch that would want one.
 */
import { AUTHORITY_BASES_FOR_ANOTHER, type AuthorityBasisForAnother } from './assignor';
import content from '../content/assignor-relationships.json';

export interface AssignorRelationshipOption {
  /** Stable identifier. The string table is keyed by this; it is never shown. */
  readonly key: string;
  /** One of the six bases for acting for another person. */
  readonly authorityBasis: AuthorityBasisForAnother;
  /** True for the one option that reveals a required free-text box. */
  readonly freeText: boolean;
}

export interface AssignorRelationshipContent {
  /** Recorded alongside every assignor made from this list. Bump it on every edit. */
  readonly version: string;
  /** ORDER IS THE ORDER ON SCREEN. */
  readonly options: readonly AssignorRelationshipOption[];
}

/**
 * Exhaustive, and it throws rather than repairing. A content file that has
 * been edited into a shape the platform cannot use is a mistake to surface,
 * not one to paper over with a default — the whole reason the list is editable
 * is that somebody will edit it.
 */
export function parseAssignorRelationshipContent(raw: unknown): AssignorRelationshipContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/assignor-relationships.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.options) || doc.options.length === 0) {
    return fail('`options` must be a non-empty array');
  }

  const seen = new Set<string>();
  const options = doc.options.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`options[${index}] is not an object`);
    const option = entry as Record<string, unknown>;

    if (typeof option.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(option.key)) {
      return fail(`options[${index}].key must be a lower_snake_case identifier`);
    }
    if (seen.has(option.key)) return fail(`options[${index}].key "${option.key}" appears twice`);
    seen.add(option.key);

    if (
      typeof option.authorityBasis !== 'string' ||
      !(AUTHORITY_BASES_FOR_ANOTHER as readonly string[]).includes(option.authorityBasis)
    ) {
      return fail(
        `options[${index}].authorityBasis must be one of: ${AUTHORITY_BASES_FOR_ANOTHER.join(', ')}`,
      );
    }
    if (option.freeText !== undefined && typeof option.freeText !== 'boolean') {
      return fail(`options[${index}].freeText must be a boolean when present`);
    }

    return {
      key: option.key,
      authorityBasis: option.authorityBasis as AuthorityBasisForAnother,
      freeText: option.freeText === true,
    };
  });

  return { version: doc.version, options };
}

const parsed = parseAssignorRelationshipContent(content);

/** The list, in file order, which is screen order. */
export const ASSIGNOR_RELATIONSHIP_OPTIONS: readonly AssignorRelationshipOption[] = parsed.options;

/** Recorded alongside the assignor, so a stored agreement says which list it was made from. */
export const ASSIGNOR_RELATIONSHIPS_VERSION: string = parsed.version;

/** Just the keys, in order — the shape a `<select>` wants. */
export const ASSIGNOR_RELATIONSHIP_KEYS: readonly string[] = parsed.options.map((o) => o.key);

export function assignorRelationshipOption(key: string): AssignorRelationshipOption | null {
  return ASSIGNOR_RELATIONSHIP_OPTIONS.find((option) => option.key === key) ?? null;
}

/** True for the one option that reveals a required "Please describe" box. */
export function relationshipNeedsFreeText(key: string): boolean {
  return assignorRelationshipOption(key)?.freeText === true;
}

export interface DerivedAuthority {
  readonly authorityBasis: AuthorityBasisForAnother;
  /** Required when the basis is `other_with_note` — there, the note IS the basis. */
  readonly note: string | null;
}

/**
 * The basis for a chosen relationship, and the note that goes with it.
 *
 * @param key         one of the content file's option keys
 * @param describedAs the words to record — the relationship's own display
 *                    label, or the free text typed after choosing the
 *                    free-text option. Only read for `other_with_note`.
 * @returns the basis and its note, or null when the key is not in the content
 *          file, or when a basis that needs a note has not been given one.
 *          A caller treats null as "not answered yet" rather than as an error,
 *          because on a form that is what it is.
 */
export function authorityBasisFor(key: string, describedAs: string): DerivedAuthority | null {
  const option = assignorRelationshipOption(key);
  if (!option) return null;

  if (option.authorityBasis !== 'other_with_note') {
    return { authorityBasis: option.authorityBasis, note: null };
  }

  const note = describedAs.trim();
  if (note.length === 0) return null;
  return { authorityBasis: 'other_with_note', note };
}

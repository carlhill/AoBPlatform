/**
 * D6a — THE BASIC SERVICE DESCRIPTION, and the short versioned list staff pick
 * it from until the MBS mapping exists.
 *
 * WHY THERE IS A LIST AT ALL. A pre-agreement is refused by C6 unless its
 * description is drawn from the current mapping, and the match is exact and
 * case-sensitive (`mapping.descriptions.includes(description)`). A free-text
 * box in front of that check is a box that produces a refusal for a typo, so
 * the only honest control is a select whose options ARE the mapping's strings.
 *
 * WHY THE LIST IS A JSON FILE (hard rule 14, and the same reasoning as
 * `assignor-relationships.json`). `content/service-descriptions.json` is
 * VERSIONED CONTENT: it changes by editing the file, and its `version` travels
 * with every agreement made from it, so a question asked in 2028 — "what was
 * this practice offered when they chose those words" — has an answer. A list
 * written as a `const` here would be the fourth copy of the mistake regulatory
 * whipsaw punishes.
 *
 * WHY IT IS NOT SIMPLY IMPORTED FROM `apps/rules`. The rules service is a
 * separate deployable with zero PII and no shared build with core, and it does
 * not publish its mapping over HTTP — `GET /rule-sets` returns version strings
 * and nothing else. So core holds this list, the rules engine holds its
 * mapping, and a test (`service_descriptions_agree_with_rules_mapping`) imports
 * BOTH and fails the build when they drift. Two copies with a test between them
 * is honest; two copies without one is a latent C6 refusal at a waiting-room
 * tablet.
 *
 * WHY THE STRINGS ARE HERE AND NOT IN THE STRING TABLE. Everywhere else, a
 * display word lives in `strings.ts` keyed by a stable identifier, precisely so
 * a translation cannot change a mapping. Here the string IS the mapping: these
 * are the contractual words C6 matches and the renderer prints, not labels for
 * something else. REQ-LANG-02 is answered by rendering the AGREEMENT in both
 * languages, not by substituting this particular.
 *
 * VALIDATED AT MODULE LOAD, deliberately, and it throws rather than repairing.
 * A malformed edit fails the build and the test run at the bench, not at a
 * front desk with a patient waiting.
 */
import content from '../content/service-descriptions.json';

export interface ServiceDescriptionContent {
  /**
   * Which list a description was chosen from. Recorded with the change, and
   * required to agree with the rules engine's mapping version.
   */
  readonly version: string;
  /** ORDER IS THE ORDER ON SCREEN. The exact strings C6 matches. */
  readonly descriptions: readonly string[];
}

export function parseServiceDescriptionContent(raw: unknown): ServiceDescriptionContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/service-descriptions.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a pre-agreement.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.descriptions) || doc.descriptions.length === 0) {
    return fail('`descriptions` must be a non-empty array');
  }

  const seen = new Set<string>();
  const descriptions = doc.descriptions.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      return fail(`descriptions[${index}] must be a non-empty string`);
    }
    /*
     * NO LEADING OR TRAILING SPACE, and this is not fussiness. The C6 match is
     * exact: a description with a stray space is a description the rules engine
     * refuses, and the refusal would arrive at a tablet rather than here.
     */
    if (entry !== entry.trim()) {
      return fail(`descriptions[${index}] has leading or trailing whitespace, which C6 matches exactly`);
    }
    if (seen.has(entry)) return fail(`descriptions[${index}] "${entry}" appears twice`);
    seen.add(entry);
    return entry;
  });

  return { version: doc.version, descriptions };
}

const parsed = parseServiceDescriptionContent(content);

/** The list, in file order, which is screen order. */
export const SERVICE_DESCRIPTIONS: readonly string[] = parsed.descriptions;

/** Recorded with every description set, so the record says which list it came from. */
export const SERVICE_DESCRIPTIONS_VERSION: string = parsed.version;

/**
 * Is this exactly one of the descriptions the current list offers?
 *
 * EXACT AND CASE-SENSITIVE, matching C6 rather than being kind about it. A
 * check that accepted "general practitioner attendance" would let a value
 * through here and have the rules engine refuse it at the lock, which is the
 * worst of both — a control that looks like it worked and an agreement that
 * cannot be signed.
 */
export function isServiceDescription(value: unknown): value is string {
  return typeof value === 'string' && SERVICE_DESCRIPTIONS.includes(value);
}

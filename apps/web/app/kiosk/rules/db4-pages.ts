/**
 * ONE DB4 READ AS THREE PAGES, AND WHICH AFFIRMATION BELONGS TO WHICH (Carl,
 * 27 September 2026, from a live tablet: *"I think we need to break this down
 * into maybe four pages from step 2. 2A: Date / time and header info to
 * identify the patient. 2B: Dr seen and items in the table. 2C: legal blurb and
 * tick-boxes for approval. Then continue with sign-off."*).
 *
 * THEY ARE PAGES WITHIN A STEP, NOT STEPS. Carl's own naming — 2A, 2B, 2C — is
 * the ruling: the step chip still says "Step 2 of 3" or "Step 3 of 4" across
 * all three, because the patient is on ONE step of the ceremony and
 * `rules/ceremony-steps.ts` counts the ceremony. Nothing in this file touches
 * that module, and a sub-page indicator is the screen's own, near its heading.
 *
 * THIS IS PRESENTATION, WHICH IS WHY IT IS NOT IN THE CONTENT FILE. The
 * statements themselves are the instrument: their words, their keys and their
 * order live in `packages/domain/content/agreement-templates.json`, are
 * versioned, and are changed only by Carl and counsel (hard rule 14). WHERE ON
 * A TABLET a sentence is drawn is not a term of the contract — it is a layout
 * decision that would be different on paper, in the PDF and in the portal, and
 * putting it in the instrument would mean a screen layout could only change by
 * amending a contract. So the mapping lives here, beside the screen it serves,
 * and the content file is not edited.
 *
 * AND AN UNKNOWN KEY GOES TO THE LEGAL PAGE RATHER THAN NOWHERE. A template
 * that grows a statement this file has not been told about must still put it in
 * front of the patient: a dropped affirmation is a Continue that will not open
 * with no visible reason, and then a signature the server refuses (hard rule 2
 * — the signature control cannot enable until every affirmation is ticked and
 * validation passes). 2C is the default because it is the page the sign-off is
 * on, so an unplaced statement is read immediately before signing rather than
 * on a page the patient has already turned. Named test:
 * `every_real_statement_key_lands_on_exactly_one_page`.
 */

/**
 * The three pages of the DB4, in the order they are read.
 *
 *   `header`   2A — the form's own heading, reference, date and patient block.
 *              It is the FORM's header reproduced, NOT a second identity check:
 *              the patient may already have done K-2 or K-P1, and asking twice
 *              is the thing Carl explicitly did not want.
 *   `services` 2B — the provider(s) seen and the service rows, with the amounts
 *              exactly as PracSoft printed them (hard rule 4).
 *   `legal`    2C — the privacy notice, the assignment statements, the tick
 *              boxes, and the way on to sign-off.
 */
export const DB4_PAGES = ['header', 'services', 'legal'] as const;

export type Db4Page = (typeof DB4_PAGES)[number];

/** Where a patient arriving at the step starts, and where Back out of it resets to. */
export const FIRST_DB4_PAGE: Db4Page = DB4_PAGES[0];

/** The page the sign-off is on, and the home of any statement not placed below. */
export const LAST_DB4_PAGE: Db4Page = DB4_PAGES[DB4_PAGES.length - 1];

/**
 * WHERE EACH AFFIRMATION IS READ, keyed by the statement keys that
 * `agreement-templates.json` actually carries.
 *
 * `episodic_details_correct_v1` IS ON 2B AND THAT IS DELIBERATE. Its words are
 * "I confirm the details above are correct", and the details it is about are
 * the patient block on 2A AND the service rows on 2B — so it belongs after both
 * have been read, which is the foot of 2B. The word "above" is then true of one
 * page and loose about the other; it is the operative wording of a contract and
 * is NOT reworded here to suit a layout (hard rule 14, and the statements are
 * `status: draft_pending_review`). Raised with Carl as a finding.
 *
 * EVERY OTHER KEY IS AN ASSIGNMENT OR A SCOPE STATEMENT, which is the legal
 * page by definition.
 */
const STATEMENT_PAGES: Readonly<Record<string, Db4Page>> = {
  episodic_assign_v1: 'legal',
  episodic_details_correct_v1: 'services',
  enduring_assign_v1: 'legal',
  enduring_scope_and_ending_v1: 'legal',
};

/**
 * The page a statement is read on. An unknown key is the legal page — see the
 * module note; it is never dropped.
 */
export function statementPage(key: string): Db4Page {
  return STATEMENT_PAGES[key] ?? LAST_DB4_PAGE;
}

/** The next page, or `null` on the last one — where Continue goes to sign-off. */
export function nextDb4Page(page: Db4Page): Db4Page | null {
  return DB4_PAGES[DB4_PAGES.indexOf(page) + 1] ?? null;
}

/**
 * The previous page, or `null` on the first one — where Back stops being the
 * screen's own navigation and becomes the ceremony's, whatever `onBack` does.
 */
export function previousDb4Page(page: Db4Page): Db4Page | null {
  const index = DB4_PAGES.indexOf(page);
  return index > 0 ? (DB4_PAGES[index - 1] as Db4Page) : null;
}

/** Which of the three a page is, for the screen's own "Page 1 of 3" line. */
export function db4PagePosition(page: Db4Page): { position: number; total: number } {
  return { position: DB4_PAGES.indexOf(page) + 1, total: DB4_PAGES.length };
}

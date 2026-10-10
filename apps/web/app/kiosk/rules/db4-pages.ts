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

/* --------------------------------------------------------------------------
 * PAGES SIZED TO THE SCREEN (Carl, 10 Oct 2026: "Do not have boxes that
 * scroll", then "go with option 1 for page sizing").
 *
 * The three pages above are SECTIONS. On a tablet that can measure itself,
 * each section is drawn as one or more SHEETS — as many as it takes for every
 * sheet to fit the screen whole, with nothing scrolling. A long services table
 * or privacy notice becomes more sheets, never a box that scrolls.
 *
 * WHAT THIS FILE DECIDES, AND WHAT IT DOES NOT. It decides which block belongs
 * to which section (`db4BlockSection`), which affirmations belong to which
 * section (`statementPage`, above), and that a section's affirmations are read
 * on the LAST sheet of that section, after everything they confirm. The
 * screen only measures: `fillDb4Sheets` is handed the blocks in reading order
 * and a `fits` question it cannot answer itself, and decides where the breaks
 * go. Nothing here reorders a block or moves one between sections.
 * Presentation, never the instrument.
 *
 * WHERE MEASURING IS NOT POSSIBLE (a server render, jsdom, a test device, a
 * screen under 480px tall) there are no sheets and the screen draws the three
 * fixed pages exactly as before.
 * ------------------------------------------------------------------------ */

/** One block of the form, in reading order: its id and the section it is read in. */
export interface Db4Block {
  readonly id: string;
  readonly section: Db4Page;
}

/** One screenful: a section, the blocks drawn on it, and whether it closes the section. */
export interface Db4Sheet {
  readonly section: Db4Page;
  readonly blocks: readonly string[];
  /** The section's last sheet — the one its affirmations are read on. */
  readonly lastOfSection: boolean;
  /** The last sheet of all — Continue to sign, and the document's tags. */
  readonly lastOfAll: boolean;
}

/** What the screen is asked: would THIS sheet fit, whole, with nothing scrolling? */
export type Db4SheetFits = (sheet: Db4Sheet) => boolean;

/**
 * WHICH SECTION A BLOCK IS READ IN, from its id. The ids are the screen's
 * (`masthead-1`, `practice-date`, `patient-dob`, `provider-0`, `service-3`,
 * `privacy-1`, ...); the
 * mapping is here so the screen cannot quietly move a block to another page.
 * An unknown id is read on the legal page, for the reason an unknown statement
 * is: it must still be in front of the patient before they sign.
 */
export function db4BlockSection(id: string): Db4Page {
  if (id.startsWith('masthead') || id.startsWith('practice-') || id.startsWith('patient-')) return 'header';
  if (id.startsWith('provider-') || id.startsWith('service-')) return 'services';
  return 'legal';
}

/**
 * FILL SHEETS IN READING ORDER. Each section starts a new sheet. Within one,
 * blocks are added while the sheet still fits; the sheet that ends the section
 * is asked with its affirmations on it, so the ticks are always on a sheet the
 * patient can see whole, under the last block they confirm.
 *
 * A BLOCK TOO TALL FOR ANY SHEET goes on a sheet of its own and that one sheet
 * is allowed not to fit. There it is the PAGE that scrolls — the shell's
 * content row, as for any page too long for its screen — never a box inside
 * it, and never a block cut in half mid-sentence. This function does not loop
 * looking for something better; there is nothing better.
 */
export function fillDb4Sheets(blocks: readonly Db4Block[], fits: Db4SheetFits): Db4Sheet[] {
  const sheets: Array<{ section: Db4Page; blocks: string[] }> = [];
  for (const section of DB4_PAGES) {
    const ids = blocks.filter((block) => block.section === section).map((block) => block.id);
    if (ids.length === 0) {
      sheets.push({ section, blocks: [] });
      continue;
    }
    let start = 0;
    while (start < ids.length) {
      let end = start;
      const trial = (to: number): Db4Sheet => ({
        section,
        blocks: ids.slice(start, to + 1),
        lastOfSection: to === ids.length - 1,
        lastOfAll: to === ids.length - 1 && section === LAST_DB4_PAGE,
      });
      while (end + 1 < ids.length && fits(trial(end + 1))) end += 1;
      if (end === ids.length - 1 && !fits(trial(end))) {
        // The section's last block is on this sheet but its ticks do not fit
        // beside it: leave that block for the next sheet, where it and the
        // ticks are read together.
        if (end > start) {
          end -= 1;
        } else {
          // Even the last block alone and its ticks do not fit. If the block
          // fits without them, it is read on its own sheet and the ticks
          // follow on one of theirs — still the section's last, still after
          // everything they confirm. Otherwise this is the giant case below.
          const alone: Db4Sheet = { ...trial(end), lastOfSection: false, lastOfAll: false };
          const ticksOnly: Db4Sheet = {
            section,
            blocks: [],
            lastOfSection: true,
            lastOfAll: section === LAST_DB4_PAGE,
          };
          if (fits(alone) && fits(ticksOnly)) {
            sheets.push({ section, blocks: ids.slice(start, end + 1) });
            sheets.push({ section, blocks: [] });
            start = end + 1;
            continue;
          }
        }
      }
      sheets.push({ section, blocks: ids.slice(start, end + 1) });
      start = end + 1;
    }
  }
  return sheets.map((sheet, index) => {
    const next = sheets[index + 1];
    return {
      ...sheet,
      lastOfSection: !next || next.section !== sheet.section,
      lastOfAll: index === sheets.length - 1,
    };
  });
}

/** The block a sheet is remembered by: its first, or its section for an empty one. */
export function sheetAnchor(sheet: Db4Sheet): string {
  return sheet.blocks[0] ?? `section:${sheet.section}`;
}

/**
 * THE SHEET THE PATIENT IS ON. They are kept on the sheet holding the block
 * they were reading (`anchor`), so a re-measure — the tablet turned, the
 * browser's bars sliding — re-paginates around them rather than sending them
 * back to the start. Without an anchor in the section the ceremony says they
 * are in, they arrive at its first sheet; arriving at the LAST section (Back
 * from the signature) they land on its last sheet, where they left.
 */
export function resolveDb4Sheet(sheets: readonly Db4Sheet[], section: Db4Page, anchor: string | null): number {
  const inSection = sheets.map((sheet, index) => ({ sheet, index })).filter(({ sheet }) => sheet.section === section);
  if (inSection.length === 0) return 0;
  if (anchor !== null) {
    const held = inSection.find(({ sheet }) => sheet.blocks.includes(anchor) || sheetAnchor(sheet) === anchor);
    if (held) return held.index;
  }
  return section === LAST_DB4_PAGE ? inSection[inSection.length - 1].index : inSection[0].index;
}

/**
 * A `fits` question answered from heights, for the tests and for reasoning
 * about the filler without a screen: a sheet fits when its frame, its blocks,
 * its section's ticks (if it closes the section) and the tags (if it closes
 * the document) add up to no more than the space available.
 */
export function fitsByHeight(measure: {
  readonly available: number;
  readonly frame: number;
  readonly heights: Readonly<Record<string, number>>;
  readonly ticks?: Partial<Record<Db4Page, number>>;
  readonly tags?: number;
}): Db4SheetFits {
  return (sheet) => {
    const blocks = sheet.blocks.reduce((sum, id) => sum + (measure.heights[id] ?? 0), 0);
    const ticks = sheet.lastOfSection ? (measure.ticks?.[sheet.section] ?? 0) : 0;
    const tags = sheet.lastOfAll ? (measure.tags ?? 0) : 0;
    return measure.frame + blocks + ticks + tags <= measure.available;
  };
}

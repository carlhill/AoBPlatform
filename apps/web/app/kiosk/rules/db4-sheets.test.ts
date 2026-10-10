/**
 * PAGES SIZED TO THE SCREEN (Carl, 10 Oct 2026: "Do not have boxes that
 * scroll", then "go with option 1 for page sizing").
 *
 * The screen measures; `fillDb4Sheets` decides where the breaks go. These pin
 * what the filler promises, with heights standing in for a screen:
 *
 *   1. Blocks stay in reading order and in their section; each section starts
 *      a new sheet.
 *   2. A section's affirmations are on its LAST sheet, and that sheet is asked
 *      with them on it — if they do not fit beside the last block, the last
 *      block moves on with them.
 *   3. A block taller than any sheet gets a sheet of its own (where the page,
 *      never a box, scrolls) and the filler does not loop or drop it.
 *   4. A re-measure keeps the patient on the sheet holding the block they were
 *      reading; Back from the signature lands on the last sheet.
 */
import { describe, expect, it } from 'vitest';
import { db4BlockSection, fillDb4Sheets, fitsByHeight, resolveDb4Sheet, sheetAnchor, type Db4Block } from './db4-pages';

const block = (id: string): Db4Block => ({ id, section: db4BlockSection(id) });

/** A form like the long fixture: header, two providers, twelve rows, four paragraphs, one statement. */
const LONG: Db4Block[] = [
  'masthead-0',
  'practice-reference',
  'patient-dob',
  'provider-0',
  'provider-1',
  ...Array.from({ length: 12 }, (_, index) => `service-${index}`),
  ...Array.from({ length: 4 }, (_, index) => `privacy-${index}`),
  'statement-0',
].map(block);

const heights: Record<string, number> = {
  'masthead-0': 150,
  'practice-reference': 300,
  'patient-dob': 320,
  'provider-0': 80,
  'provider-1': 80,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`service-${index}`, 60])),
  ...Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`privacy-${index}`, 150])),
  'statement-0': 90,
};

describe('fillDb4Sheets', () => {
  it('keeps_every_block_once_in_reading_order_and_in_its_own_section', () => {
    const sheets = fillDb4Sheets(LONG, fitsByHeight({ available: 700, frame: 250, heights }));
    expect(sheets.flatMap((sheet) => sheet.blocks)).toEqual(LONG.map((each) => each.id));
    for (const sheet of sheets) {
      for (const id of sheet.blocks) expect(db4BlockSection(id)).toBe(sheet.section);
    }
    // Sections in order, each starting a sheet of its own.
    expect([...new Set(sheets.map((sheet) => sheet.section))]).toEqual(['header', 'services', 'legal']);
  });

  it('a_taller_screen_takes_fewer_sheets', () => {
    const short = fillDb4Sheets(LONG, fitsByHeight({ available: 700, frame: 250, heights }));
    const tall = fillDb4Sheets(LONG, fitsByHeight({ available: 1200, frame: 250, heights }));
    expect(tall.length).toBeLessThan(short.length);
    for (const sheets of [short, tall]) {
      expect(sheets.filter((sheet) => sheet.lastOfAll)).toHaveLength(1);
      expect(sheets[sheets.length - 1].lastOfAll).toBe(true);
    }
  });

  it('every_sheet_fits_unless_one_block_alone_cannot', () => {
    const measure = { available: 700, frame: 250, heights, ticks: { services: 120, legal: 140 }, tags: 50 };
    const fits = fitsByHeight(measure);
    for (const sheet of fillDb4Sheets(LONG, fits)) expect(fits(sheet)).toBe(true);
  });

  it('a_sections_ticks_are_on_its_last_sheet_and_the_last_block_moves_on_with_them', () => {
    // Twelve rows exactly fill a sheet; the services tick (120px) does not fit
    // beside the twelfth row, so row twelve starts the next sheet with it.
    const rows = Array.from({ length: 12 }, (_, index) => block(`service-${index}`));
    const fits = fitsByHeight({
      available: 250 + 12 * 60,
      frame: 250,
      heights,
      ticks: { services: 120 },
    });
    const services = fillDb4Sheets(rows, fits).filter((sheet) => sheet.section === 'services');
    expect(services.map((sheet) => sheet.blocks.length)).toEqual([11, 1]);
    expect(services.map((sheet) => sheet.lastOfSection)).toEqual([false, true]);
    expect(fits(services[1])).toBe(true);
  });

  it('when_the_last_block_and_its_ticks_cannot_share_a_sheet_the_ticks_follow_on_their_own', () => {
    // One service row fits a sheet, and so do the ticks, but not both: the row
    // is read, then the ticks on the section's last sheet — never a scroll.
    const rows = [block('service-0')];
    const fits = fitsByHeight({ available: 400, frame: 250, heights, ticks: { services: 120 } });
    const services = fillDb4Sheets(rows, fits).filter((sheet) => sheet.section === 'services');
    expect(services.map((sheet) => sheet.blocks)).toEqual([['service-0'], []]);
    expect(services.map((sheet) => sheet.lastOfSection)).toEqual([false, true]);
    for (const sheet of services) expect(fits(sheet)).toBe(true);
  });

  it('the_details_tick_never_sits_alone_when_the_last_row_and_it_fit_together', () => {
    // "I confirm the details above are correct" must have details above it:
    // wherever the last row and the tick fit on one sheet, they share it.
    for (const available of [400, 500, 650, 900, 1200]) {
      const rows = Array.from({ length: 12 }, (_, index) => block(`service-${index}`));
      const fits = fitsByHeight({ available, frame: 250, heights, ticks: { services: 120 } });
      const services = fillDb4Sheets(rows, fits).filter((sheet) => sheet.section === 'services');
      const last = services[services.length - 1];
      const together = fits({ section: 'services', blocks: ['service-11'], lastOfSection: true, lastOfAll: false });
      if (together) expect(last.blocks).toContain('service-11');
    }
  });

  it('a_block_taller_than_any_sheet_gets_a_sheet_of_its_own_and_nothing_is_dropped', () => {
    // One privacy paragraph is taller than the whole screen. It is put on its
    // own sheet — where the page scrolls as a whole, never a box — and the
    // blocks either side of it are still placed.
    const giant = { ...heights, 'privacy-1': 2000 };
    const fits = fitsByHeight({ available: 700, frame: 250, heights: giant, ticks: { legal: 140 } });
    const legal = fillDb4Sheets(LONG, fits).filter((sheet) => sheet.section === 'legal');
    expect(legal.flatMap((sheet) => sheet.blocks)).toEqual([
      'privacy-0',
      'privacy-1',
      'privacy-2',
      'privacy-3',
      'statement-0',
    ]);
    const alone = legal.find((sheet) => sheet.blocks.includes('privacy-1'));
    expect(alone?.blocks).toEqual(['privacy-1']);
    expect(legal.filter((sheet) => !fits(sheet)).map((sheet) => sheet.blocks)).toEqual([['privacy-1']]);
  });

  it('a_section_with_no_blocks_still_has_its_sheet', () => {
    const sheets = fillDb4Sheets([block('masthead-0')], fitsByHeight({ available: 700, frame: 250, heights }));
    expect(sheets.map((sheet) => [sheet.section, sheet.blocks.length])).toEqual([
      ['header', 1],
      ['services', 0],
      ['legal', 0],
    ]);
    expect(sheetAnchor(sheets[1])).toBe('section:services');
  });
});

describe('resolveDb4Sheet', () => {
  it('a_re_measure_keeps_the_patient_on_the_sheet_holding_the_block_they_were_reading', () => {
    const portrait = fillDb4Sheets(LONG, fitsByHeight({ available: 1200, frame: 250, heights }));
    const landscape = fillDb4Sheets(LONG, fitsByHeight({ available: 600, frame: 250, heights }));
    // Reading the sheet that starts at service-6 upright...
    const reading = 'service-6';
    const before = resolveDb4Sheet(portrait, 'services', reading);
    expect(portrait[before].blocks).toContain(reading);
    // ...and turned on its side: a different sheet number, the same block.
    const after = resolveDb4Sheet(landscape, 'services', reading);
    expect(landscape[after].blocks).toContain(reading);
    expect(landscape.length).toBeGreaterThan(portrait.length);
  });

  it('a_ticks_only_sheet_remembered_by_its_section_stays_at_the_end_of_that_section', () => {
    // Upright the services ticks had a sheet of their own (anchor
    // `section:services`). Turned, they share a sheet with the last rows: the
    // patient lands there — the section's LAST sheet — not back at its first.
    const rows = Array.from({ length: 12 }, (_, index) => block(`service-${index}`));
    const wide = fillDb4Sheets(rows, fitsByHeight({ available: 800, frame: 250, heights, ticks: { services: 120 } }));
    const index = resolveDb4Sheet(wide, 'services', 'section:services');
    const services = wide.filter((sheet) => sheet.section === 'services');
    expect(wide[index]).toBe(services[services.length - 1]);
    expect(services.length).toBeGreaterThan(1);
  });

  it('arrives_at_the_first_sheet_of_a_section_and_back_from_the_signature_at_the_last', () => {
    const sheets = fillDb4Sheets(LONG, fitsByHeight({ available: 600, frame: 250, heights }));
    const header = resolveDb4Sheet(sheets, 'header', null);
    expect(sheets[header].blocks[0]).toBe('masthead-0');
    const legal = resolveDb4Sheet(sheets, 'legal', null);
    expect(sheets[legal].lastOfAll).toBe(true);
    // An anchor from another section is no anchor for this one.
    expect(resolveDb4Sheet(sheets, 'header', 'service-3')).toBe(header);
  });
});

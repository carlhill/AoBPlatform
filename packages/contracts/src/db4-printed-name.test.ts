/**
 * THE PRINTED-NAME COMPARISON (D-2026-10-10-11).
 *
 * A DB4 is matched to a patient by chart number only, so the name PracSoft
 * printed can differ from the name in the patient record it was matched to.
 * These pin what counts as "the same name" — rendering differences do not
 * flag, a genuinely different given or family name always does — and that the
 * part list is the only thing safe to carry outside a staff screen.
 *
 * Fixture names are obviously fake; no test name carries one.
 */
import { describe, expect, it } from 'vitest';
import {
  DB4_NAME_PARTS,
  DB4_PRINTED_NAME_DIFFERS_CODE,
  comparableNamePart,
  db4PrintedNameDifference,
  db4PrintedNamePartsDiffering,
} from './db4-printed-name';

const record = { givenNames: 'Testa Mae', familyName: "O'Fakename-Smith" };

describe('the printed name against the patient record', () => {
  it('an exact match is no difference', () => {
    expect(db4PrintedNamePartsDiffering(record, record)).toEqual([]);
    expect(db4PrintedNameDifference(record, record)).toBeNull();
  });

  it('case, surrounding and internal whitespace are not a difference', () => {
    const printed = { givenNames: '  TESTA   mae ', familyName: "o'fakename-smith " };
    expect(db4PrintedNameDifference(printed, record)).toBeNull();
  });

  it('a composed and a decomposed accent are the same name (NFC)', () => {
    const composed = { givenNames: 'Zoé', familyName: 'Fakename' };
    const decomposed = { givenNames: 'Zoé', familyName: 'Fakename' };
    expect(db4PrintedNameDifference(decomposed, composed)).toBeNull();
  });

  it('typographic apostrophes and dashes, and spacing around them, are not a difference', () => {
    const printed = { givenNames: 'Testa Mae', familyName: 'O’ Fakename – Smith' };
    expect(db4PrintedNameDifference(printed, record)).toBeNull();
  });

  it('a missing apostrophe or hyphen IS a difference - punctuation is normalised, never dropped', () => {
    expect(db4PrintedNamePartsDiffering({ ...record, familyName: 'OFakename-Smith' }, record)).toEqual([
      'family_name',
    ]);
    expect(db4PrintedNamePartsDiffering({ ...record, familyName: "O'Fakename Smith" }, record)).toEqual([
      'family_name',
    ]);
  });

  it('an accent is not stripped: an unaccented spelling is a difference', () => {
    expect(
      db4PrintedNamePartsDiffering({ givenNames: 'Zoe', familyName: 'Fakename' }, { givenNames: 'Zoé', familyName: 'Fakename' }),
    ).toEqual(['given_names']);
  });

  it('a different given name flags given_names only, with both names', () => {
    const printed = { givenNames: 'Otherly Mae', familyName: record.familyName };
    const difference = db4PrintedNameDifference(printed, record);
    expect(difference).toEqual({
      code: DB4_PRINTED_NAME_DIFFERS_CODE,
      parts: ['given_names'],
      printed: { givenNames: 'Otherly Mae', familyName: record.familyName },
      recorded: record,
    });
  });

  it('a missing middle name is a difference - no fuzzy matching', () => {
    expect(db4PrintedNamePartsDiffering({ ...record, givenNames: 'Testa' }, record)).toEqual(['given_names']);
  });

  it('a different family name flags family_name only', () => {
    expect(db4PrintedNamePartsDiffering({ ...record, familyName: 'Differentname' }, record)).toEqual([
      'family_name',
    ]);
  });

  it('given and family names are compared part against part, so a swap flags both', () => {
    const swapped = { givenNames: record.familyName, familyName: record.givenNames };
    expect(db4PrintedNamePartsDiffering(swapped, record)).toEqual(['given_names', 'family_name']);
  });

  it('the same whole name split at a different space is no difference (D-2026-10-11-06)', () => {
    // The template splits a printed name at its last space; a family name with
    // a space in it then comes off the page split differently from the record.
    const spaced = { givenNames: 'Testa', familyName: 'Van Der Fakename' };
    expect(db4PrintedNameDifference({ givenNames: 'Testa Van Der', familyName: 'Fakename' }, spaced)).toBeNull();
    expect(db4PrintedNameDifference({ givenNames: 'TESTA  van der', familyName: 'fakename' }, spaced)).toBeNull();
    // A genuinely different whole name still differs, part by part.
    expect(db4PrintedNamePartsDiffering({ givenNames: 'Testa Van De', familyName: 'Fakename' }, spaced)).toEqual([
      'given_names',
      'family_name',
    ]);
  });

  it('a part the form did not print is not compared - there is no second name on screen', () => {
    expect(db4PrintedNameDifference({ familyName: record.familyName }, record)).toBeNull();
    expect(db4PrintedNameDifference({ givenNames: '  ', familyName: undefined }, record)).toBeNull();
    expect(db4PrintedNamePartsDiffering({ givenNames: 'Otherly' }, record)).toEqual(['given_names']);
  });

  it('reports parts in contract order and the code is the one the console maps', () => {
    expect(DB4_NAME_PARTS).toEqual(['given_names', 'family_name']);
    expect(DB4_PRINTED_NAME_DIFFERS_CODE).toBe('print_record_name_differs');
  });

  it('the part list carries no name - it is the only field safe in a log or an event', () => {
    const difference = db4PrintedNameDifference({ givenNames: 'Otherly', familyName: 'Differentname' }, record);
    const typesOnly = JSON.stringify({ code: difference?.code, parts: difference?.parts });
    for (const value of ['Otherly', 'Differentname', 'Testa', 'Fakename']) {
      expect(typesOnly).not.toContain(value);
    }
  });

  it('a lookalike letter from another script IS a difference - no NFKC, no confusable folding', () => {
    // Cyrillic "а" (U+0430) in place of Latin "a".
    const printed = { givenNames: 'Testа Mae', familyName: record.familyName };
    expect(db4PrintedNamePartsDiffering(printed, record)).toEqual(['given_names']);
  });

  it('a zero-width character IS a difference - it is not whitespace and is never stripped', () => {
    const printed = { givenNames: 'Tes​ta Mae', familyName: record.familyName };
    expect(db4PrintedNamePartsDiffering(printed, record)).toEqual(['given_names']);
  });

  it('comparableNamePart is idempotent', () => {
    const once = comparableNamePart(' O’ Fake–Name ');
    expect(comparableNamePart(once)).toBe(once);
    expect(once).toBe("o'fake-name");
  });
});

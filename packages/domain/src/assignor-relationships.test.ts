/**
 * The relationship list is CONTENT, and this is the test that keeps it so.
 *
 * Two things are being protected. First, that the mapping from a relationship
 * to a legal authority basis is read from
 * `content/assignor-relationships.json` and not written anywhere in
 * TypeScript — the regime has already moved twice, and versioning is the
 * defence (hard rule 14). Second, that three of the six bases can never be
 * reached from a relationship word, because reaching them would be the
 * platform asserting a fact nobody declared.
 */
import {
  ASSIGNOR_RELATIONSHIP_KEYS,
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  ASSIGNOR_RELATIONSHIPS_VERSION,
  assignorRelationshipOption,
  authorityBasisFor,
  parseAssignorRelationshipContent,
  relationshipNeedsFreeText,
} from './assignor-relationships';
import { AUTHORITY_BASES_FOR_ANOTHER } from './assignor';

describe('the relationship list is versioned content', () => {
  it('relationship_list_is_loaded_from_content', () => {
    // It loaded, it is not empty, and it carries a version that will be
    // recorded alongside every assignor made from it.
    expect(ASSIGNOR_RELATIONSHIP_OPTIONS.length).toBeGreaterThan(0);
    expect(ASSIGNOR_RELATIONSHIPS_VERSION).toMatch(/^relationships-/);

    // Every basis in the file is one the platform knows.
    for (const option of ASSIGNOR_RELATIONSHIP_OPTIONS) {
      expect(AUTHORITY_BASES_FOR_ANOTHER).toContain(option.authorityBasis);
    }

    // Order is file order, and the keys are what a screen renders.
    expect(ASSIGNOR_RELATIONSHIP_KEYS).toEqual(ASSIGNOR_RELATIONSHIP_OPTIONS.map((o) => o.key));

    // Exactly one option asks for free text — the "something else" case, where
    // the note IS the basis.
    const freeText = ASSIGNOR_RELATIONSHIP_OPTIONS.filter((o) => o.freeText);
    expect(freeText).toHaveLength(1);
    expect(relationshipNeedsFreeText(freeText[0].key)).toBe(true);
  });

  it('a_relationship_never_asserts_co_residence_or_a_legal_instrument', () => {
    /*
     * THE SUBSTANCE OF THE MAPPING. `co_resident_relative_18_plus` asserts that
     * two people live at one address; `guardian` and `health_epoa` assert a
     * legal instrument. Neither can be inferred from a relationship word — a
     * grandparent may or may not live with the patient, and a spouse is not
     * thereby an attorney. Mapping to any of the three would put a declaration
     * on the record that nobody made.
     */
    const forbidden = ['co_resident_relative_18_plus', 'guardian', 'health_epoa'];
    for (const option of ASSIGNOR_RELATIONSHIP_OPTIONS) {
      expect(forbidden).not.toContain(option.authorityBasis);
    }
  });

  it('derives_the_basis_and_carries_the_words_as_the_note', () => {
    expect(authorityBasisFor('father', 'Father')).toEqual({ authorityBasis: 'parent', note: null });
    expect(authorityBasisFor('mother', 'Mother')).toEqual({ authorityBasis: 'parent', note: null });
    expect(authorityBasisFor('spouse', 'Spouse')).toEqual({ authorityBasis: 'spouse', note: null });

    // Everything else lands on `other_with_note`, carrying the relationship
    // itself. "Friend" was always a legitimate answer there.
    expect(authorityBasisFor('friend', 'Friend')).toEqual({
      authorityBasis: 'other_with_note',
      note: 'Friend',
    });
    expect(authorityBasisFor('carer', 'Carer')).toEqual({
      authorityBasis: 'other_with_note',
      note: 'Carer',
    });

    // A basis that needs a note and has not been given one is NOT ANSWERED,
    // which a form treats as "keep asking" rather than as an error.
    const freeTextKey = ASSIGNOR_RELATIONSHIP_OPTIONS.find((o) => o.freeText)!.key;
    expect(authorityBasisFor(freeTextKey, '   ')).toBeNull();
    expect(authorityBasisFor(freeTextKey, 'Next-door neighbour')).toEqual({
      authorityBasis: 'other_with_note',
      note: 'Next-door neighbour',
    });

    // A key that is not in the file is not answered either — never a guess.
    expect(authorityBasisFor('', '')).toBeNull();
    expect(authorityBasisFor('solicitor', 'Solicitor')).toBeNull();
    expect(assignorRelationshipOption('solicitor')).toBeNull();
  });

  it('a_bad_edit_fails_loudly_rather_than_reaching_a_patient', () => {
    /*
     * The file is editable by design, so somebody will edit it. Validation runs
     * at load: a malformed list stops the build and the test run at the bench
     * rather than producing a dropdown with a hole in it at a tablet.
     */
    expect(() => parseAssignorRelationshipContent(null)).toThrow(/not usable/i);
    expect(() => parseAssignorRelationshipContent({ options: [] })).toThrow(/version/i);
    expect(() => parseAssignorRelationshipContent({ version: 'v1', options: [] })).toThrow(/non-empty/i);
    expect(() =>
      parseAssignorRelationshipContent({ version: 'v1', options: [{ key: 'Friend', authorityBasis: 'spouse' }] }),
    ).toThrow(/lower_snake_case/i);
    expect(() =>
      parseAssignorRelationshipContent({ version: 'v1', options: [{ key: 'friend', authorityBasis: 'self' }] }),
    ).toThrow(/authorityBasis/i);
    expect(() =>
      parseAssignorRelationshipContent({
        version: 'v1',
        options: [
          { key: 'friend', authorityBasis: 'spouse' },
          { key: 'friend', authorityBasis: 'parent' },
        ],
      }),
    ).toThrow(/twice/i);
  });

  it('an_added_option_needs_no_code_change', () => {
    /*
     * THE PROPERTY THE WHOLE ARRANGEMENT EXISTS FOR. A fixture with an extra
     * option parses, keeps file order, and derives correctly — with nothing in
     * TypeScript edited. The screen renders whatever this returns, so an
     * option added to the real file appears without a component change.
     */
    const fixture = parseAssignorRelationshipContent({
      version: 'relationships-fixture-1',
      options: [
        { key: 'father', authorityBasis: 'parent' },
        { key: 'foster_parent', authorityBasis: 'other_with_note' },
        { key: 'other', authorityBasis: 'other_with_note', freeText: true },
      ],
    });
    expect(fixture.options.map((o) => o.key)).toEqual(['father', 'foster_parent', 'other']);
    expect(fixture.options[1].freeText).toBe(false);
    expect(fixture.options[2].freeText).toBe(true);
    expect(fixture.version).toBe('relationships-fixture-1');
  });
});

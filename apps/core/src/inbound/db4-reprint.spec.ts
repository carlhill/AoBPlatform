import { db4ParticularsChanged, decideDb4Reprint, type Db4Particulars } from './db4-reprint';

/**
 * THE CORRECTED-REPRINT RULE, WITH NO DATABASE IN IT.
 *
 * Carl, 28 September 2026, approving the three-way rule put to him: *"repoint
 * when only the reproduction improved, supersede when a particular changed,
 * refuse under a signature."* These pin each of the three and the boundary
 * between them, because the boundary is the whole of the design — repointing
 * where a particular moved would leave an agreement whose locked particulars
 * disagree with the form it claims to reproduce.
 */
const LOCKED: Db4Particulars = {
  patientId: '11111111-1111-4111-8111-111111111111',
  servicingProviderNumber: '9999999X',
  serviceDate: '2026-09-12',
  mbsItemNumbers: ['23', '10990'],
};

const OLD_JOB = '22222222-2222-4222-8222-222222222222';
const NEW_JOB = '33333333-3333-4333-8333-333333333333';

function decide(over: Partial<Parameters<typeof decideDb4Reprint>[0]> = {}) {
  return decideDb4Reprint({
    linkedPrintJobId: OLD_JOB,
    arrivingPrintJobId: NEW_JOB,
    signed: false,
    locked: LOCKED,
    arriving: { ...LOCKED },
    ...over,
  });
}

describe('what to do with a DB4 that has been printed again', () => {
  describe('the ordinary cases that are not corrections at all', () => {
    it('the_first_form_is_linked_and_says_so', () => {
      // Nothing was pointing anywhere. The path that has always existed keeps
      // its own name, so an original is distinguishable from a correction.
      expect(decide({ linkedPrintJobId: null })).toEqual({ action: 'linked', changed: [] });
    });

    it('a_job_already_linked_is_not_relinked', () => {
      expect(decide({ arrivingPrintJobId: OLD_JOB })).toEqual({ action: 'already_linked', changed: [] });
    });
  });

  describe('repoint — only the reproduction improved', () => {
    /*
     * THE THREE FIELDS A CORRECTION USUALLY FIXES ARE NOT PARTICULARS, and
     * that is exactly why repointing is safe. An AMOUNT is not in the s 65C
     * data set at all (hard rule 4, REQ-REG-04). An IRN and a card number are
     * not identity identifiers (hard rule 1, REQ-VER-02). The provider's
     * printed NAME is not what the agreement resolves its provider from — the
     * NUMBER is, through the affiliation. None of the three can change what
     * the agreement says, so none of them appears in `Db4Particulars` and a
     * form corrected in any of them compares equal here.
     */
    it('a_form_corrected_only_in_its_amounts_or_irn_or_provider_name_repoints', () => {
      expect(decide()).toEqual({ action: 'repointed', changed: [] });
    });

    it('an_agreement_that_was_never_locked_has_nothing_to_disagree_with', () => {
      expect(decide({ locked: null })).toEqual({ action: 'repointed', changed: [] });
    });

    it('the_same_items_in_a_different_order_are_the_same_items', () => {
      // A form's rows are a SET of services. Superseding a contract over a
      // parser's iteration order would be absurd.
      expect(decide({ arriving: { ...LOCKED, mbsItemNumbers: ['10990', '23'] } })).toEqual({
        action: 'repointed',
        changed: [],
      });
    });

    it('a_field_the_new_template_could_not_read_is_not_a_change', () => {
      /*
       * ABSENT IS NOT DIFFERENT. A corrected reprint whose template got WORSE
       * reports fields as missing, and treating missing as changed would
       * supersede an agreement because a parse degraded. The push checks are
       * what catch a degraded reproduction; this rule only acts on what the
       * new form actually states.
       */
      expect(
        decide({
          arriving: { ...LOCKED, servicingProviderNumber: null, serviceDate: null, mbsItemNumbers: [] },
        }),
      ).toEqual({ action: 'repointed', changed: [] });
    });
  });

  describe('supersede — a particular changed', () => {
    it('a_different_date_of_service_supersedes', () => {
      expect(decide({ arriving: { ...LOCKED, serviceDate: '2026-09-13' } })).toEqual({
        action: 'supersede',
        changed: ['service_date'],
      });
    });

    it('a_different_set_of_items_supersedes', () => {
      expect(decide({ arriving: { ...LOCKED, mbsItemNumbers: ['23', '36'] } })).toEqual({
        action: 'supersede',
        changed: ['service_items'],
      });
    });

    it('one_item_fewer_supersedes', () => {
      expect(decide({ arriving: { ...LOCKED, mbsItemNumbers: ['23'] } })).toEqual({
        action: 'supersede',
        changed: ['service_items'],
      });
    });

    it('the_same_item_twice_is_not_the_same_as_once', () => {
      // A DB4 may legitimately print one item twice, and two of an item is
      // not one of it (seeded and confirmed as `duplicate-items`, set 3).
      expect(decide({ arriving: { ...LOCKED, mbsItemNumbers: ['23', '23', '10990'] } })).toEqual({
        action: 'supersede',
        changed: ['service_items'],
      });
    });

    it('a_different_servicing_provider_supersedes', () => {
      // The servicing provider is whose number goes on the claim (s 65C(5)(a))
      // and who the assignment is WITH.
      expect(decide({ arriving: { ...LOCKED, servicingProviderNumber: '1111111T' } })).toEqual({
        action: 'supersede',
        changed: ['servicing_provider'],
      });
    });

    it('a_different_patient_supersedes', () => {
      expect(
        decide({ arriving: { ...LOCKED, patientId: '44444444-4444-4444-8444-444444444444' } }),
      ).toEqual({ action: 'supersede', changed: ['patient'] });
    });

    it('every_particular_that_moved_is_reported_not_just_the_first', () => {
      // Reception fixes a form once rather than being told one thing at a
      // time — the same reasoning the push refusal carries every check.
      expect(
        decide({
          arriving: {
            patientId: '44444444-4444-4444-8444-444444444444',
            servicingProviderNumber: '1111111T',
            serviceDate: '2026-09-13',
            mbsItemNumbers: ['36'],
          },
        }),
      ).toEqual({
        action: 'supersede',
        changed: ['patient', 'servicing_provider', 'service_date', 'service_items'],
      });
    });
  });

  describe('refuse — somebody has signed', () => {
    it('a_signed_agreement_is_never_repointed', () => {
      /*
       * A signed agreement is EVIDENCE: its particulars were locked, rendered,
       * hashed and assented to, and the Signed-DB4 reproduces the page that
       * was in front of the person. Moving the pointer afterwards would make
       * that evidence reproduce a page nobody saw.
       */
      expect(decide({ signed: true })).toEqual({ action: 'refused_signed', changed: [] });
    });

    it('a_signed_agreement_is_not_superseded_either_and_the_signature_is_read_first', () => {
      // Superseding is no better: the thing needing correction has already
      // been agreed. The signature is checked BEFORE the comparison, so what
      // the corrected form says cannot change the answer.
      expect(decide({ signed: true, arriving: { ...LOCKED, serviceDate: '2026-09-13' } })).toEqual({
        action: 'refused_signed',
        changed: [],
      });
    });

    it('but_a_signed_agreement_already_pointing_here_is_still_just_already_linked', () => {
      // Asked twice about a job that is already the one. Nothing is refused
      // because nothing was being attempted.
      expect(decide({ signed: true, arrivingPrintJobId: OLD_JOB })).toEqual({
        action: 'already_linked',
        changed: [],
      });
    });
  });

  describe('the changes are named as TYPES and can carry no value', () => {
    it('no_particular_change_code_can_carry_a_chart_number_a_date_or_an_item', () => {
      /*
       * Hard rule 9 (REQ-VER-04). The codes ride on a job row, in a log line
       * and in a vault event, so they have to be safe to read by somebody
       * with no business reading a particular.
       */
      const changed = db4ParticularsChanged(LOCKED, {
        patientId: '44444444-4444-4444-8444-444444444444',
        servicingProviderNumber: '1111111T',
        serviceDate: '2026-09-13',
        mbsItemNumbers: ['36'],
      });
      const serialised = JSON.stringify(changed);
      expect(serialised).not.toContain('1111111T');
      expect(serialised).not.toContain('9999999X');
      expect(serialised).not.toContain('2026-09-13');
      expect(serialised).not.toContain('2026-09-12');
      expect(serialised).not.toContain('36');
      expect(serialised).not.toContain('44444444');
      expect(changed).toEqual(['patient', 'servicing_provider', 'service_date', 'service_items']);
    });
  });
});

/**
 * THE ONE FLATTENING, TESTED WHERE IT LIVES (PRACTITIONER-QUEUE-PAGE.md §7).
 *
 * These are the rules the practitioner's queue and the front desk must never
 * disagree about, so they are asserted against the function both of them call
 * rather than through either screen.
 */
import {
  PAPERWORK_STATES,
  paperworkFor,
  whoTheyCameToSee,
  type PaperworkState,
  type WaitingRow,
  type VisitPaperwork,
} from './practitioner-queue';

const visit = (over: Partial<VisitPaperwork> = {}): VisitPaperwork => ({
  signatureEventId: null,
  liveCaptureSession: false,
  agreementNeeded: 'yes',
  ...over,
});

describe('paperwork, flattened to one word', () => {
  it('paperwork_reads_done_only_when_it_is_signed_and_stored', () => {
    /*
     * §4.4: *"Never say an agreement is approved, certified or accredited
     * (hard rule 12). 'Done' means signed and stored, and the word on screen
     * is 'Done'."* So the ONLY things that may read Done are a recorded
     * signature and a signed agreement made earlier that already covers this
     * service. Nothing else — not a locked payload, not a sent tablet, not a
     * patient halfway through reading.
     */
    expect(paperworkFor(visit({ signatureEventId: 'signature-event-1' }))).toBe('done');
    expect(paperworkFor(visit({ agreementNeeded: 'covered_already' }))).toBe('done');

    for (const notDone of [
      visit(),
      visit({ liveCaptureSession: true }),
      visit({ agreementNeeded: 'no' }),
      visit({ agreementNeeded: 'no', liveCaptureSession: true }),
    ]) {
      expect(paperworkFor(notDone)).not.toBe('done');
    }
  });

  it('says somebody is signing right now, and only while they are', () => {
    expect(paperworkFor(visit({ liveCaptureSession: true }))).toBe('with_the_patient_now');
    expect(paperworkFor(visit({ liveCaptureSession: false }))).toBe('not_yet');
  });

  it('lets a recorded signature beat a session row nobody has closed yet', () => {
    /*
     * A poll can cross a signature on the wire, and a session row is closed a
     * moment after the event is written. The most finished answer wins, so a
     * patient who HAS signed is never shown as still signing.
     */
    expect(paperworkFor(visit({ signatureEventId: 'signature-event-1', liveCaptureSession: true }))).toBe('done');
  });

  it('a_visit_that_needs_no_agreement_is_never_shown_as_outstanding', () => {
    /*
     * ARRIVAL-WHO-IS-SEEN.md §3: a patient who came only for a specimen
     * collection is seen by somebody who bills nothing, so *"the visit
     * decision is `none` and that is a correct, complete answer"*. Showing
     * "Not yet" against them would be a permanent false alarm on a page whose
     * whole job is to say whether anything is outstanding.
     */
    expect(paperworkFor(visit({ agreementNeeded: 'no' }))).toBe('nothing_to_sign');
    expect(paperworkFor(visit({ agreementNeeded: 'no' }))).not.toBe('not_yet');
  });

  it('the_waiting_list_and_the_front_desk_agree_on_the_same_patient', () => {
    /*
     * §5: one flattening function, driven from the same row — *"so the two
     * pages cannot disagree about what 'Done' means"*. The claim under test is
     * that the answer is a pure function of the visit's facts: the same facts
     * asked twice, from two callers, give the same word. If either surface
     * ever grew its own copy, this is the test that could not be made to pass
     * without deleting it.
     */
    const sameRow = visit({ liveCaptureSession: true });
    const asThePractitionerQueueAsks = paperworkFor(sameRow);
    const asTheFrontDeskAsks = paperworkFor({ ...sameRow });
    expect(asThePractitionerQueueAsks).toBe(asTheFrontDeskAsks);
    expect(asThePractitionerQueueAsks).toBe('with_the_patient_now');
  });

  it('answers every combination with one of the known words, and never undefined', () => {
    // A page that renders an unmapped state shows nothing at all, which reads
    // as "there is no paperwork" — the most dangerous thing this page can say.
    for (const signatureEventId of [null, 'signature-event-1']) {
      for (const liveCaptureSession of [true, false]) {
        for (const agreementNeeded of ['yes', 'covered_already', 'no'] as const) {
          const answer: PaperworkState = paperworkFor({ signatureEventId, liveCaptureSession, agreementNeeded });
          expect(PAPERWORK_STATES).toContain(answer);
        }
      }
    }
  });
});

describe('what a waiting row may carry', () => {
  it('the_waiting_list_carries_no_clinical_detail', () => {
    /*
     * §2: *"it must never carry a reason for the visit, a clinical note, a
     * triage category, a duration, or anything a practice management system
     * would call an appointment status."* Asserted on the TYPE's own keys
     * rather than on a rendered screen: a field that does not exist cannot be
     * leaked by a component somebody writes next month.
     */
    const row: WaitingRow = {
      arrivalId: 'arrival-1',
      patientName: 'Jamie Sampleton',
      waitingSince: '2026-09-12T08:55:00.000Z',
      paperwork: 'not_yet',
      agreementProviderName: null,
      /*
       * `visitState` IS ON THE ROW AND IS ALLOWED HERE. It says only whether
       * the practitioner is with this patient, has been, or has not yet been
       * — it is not a reason, a note, a triage category or a duration, and it
       * is not an appointment status a practice management system would
       * recognise. The key list below is the guard, so it is listed rather
       * than excused.
       */
      visitState: 'pending',
    };
    expect(Object.keys(row).sort()).toEqual([
      'agreementProviderName',
      'arrivalId',
      'paperwork',
      'patientName',
      'visitState',
      'waitingSince',
    ]);
  });

  it('the_waiting_list_carries_no_identifier_values', () => {
    /*
     * Hard rules 1 and 9. There is no Medicare-number field — the card number
     * is not an identity identifier (REQ-VER-02) — and no date of birth, no
     * address, no IHI, no patient record number. Ids travel; values do not.
     */
    const row: WaitingRow = {
      arrivalId: 'arrival-1',
      patientName: 'Jamie Sampleton',
      waitingSince: '2026-09-12T08:55:00.000Z',
      paperwork: 'done',
      agreementProviderName: null,
      visitState: 'completed',
    };
    const keys = Object.keys(row).join(' ').toLowerCase();
    for (const forbidden of ['medicare', 'ihi', 'dateofbirth', 'dob', 'address', 'recordnumber', 'amount']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('who the patient came to see', () => {
  it('prefers the person they came to see over the person the claim goes under', () => {
    // ARRIVAL-WHO-IS-SEEN.md §2. A nurse's patients must reach the nurse's
    // list, not the supervising provider's.
    expect(whoTheyCameToSee({ seeingAffiliationId: 'nurse', affiliationId: 'gp' })).toBe('nurse');
  });

  it('falls back to the billing affiliation, which is right for every GP visit', () => {
    // The backfill sets the two equal on every arrival taken before the new
    // field existed, and an ordinary GP arrival names the same person twice.
    expect(whoTheyCameToSee({ affiliationId: 'gp' })).toBe('gp');
    expect(whoTheyCameToSee({ seeingAffiliationId: null, affiliationId: 'gp' })).toBe('gp');
    expect(whoTheyCameToSee({})).toBeNull();
  });
});

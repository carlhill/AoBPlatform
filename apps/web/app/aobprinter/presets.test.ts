/**
 * THE AOBPRINTER TEST TOOL'S PRESETS AND THE ENVELOPE THEY BECOME.
 *
 * In the web Vitest include list since 12 October 2026, so CI runs it.
 */
import { describe, expect, it } from 'vitest';
import { buildEnvelope, draftFromEnvelope } from './envelope';
import { BLANK, PRESETS, startFromPreset, type Draft } from './presets';

const preset = (key: string) => {
  const found = PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`no preset ${key}`);
  return found;
};

/** What the tester has typed before picking a preset. Fake throughout. */
const TYPED: Draft = {
  ...BLANK,
  patientRecordNumber: '00999',
  givenNames: 'Fern',
  familyName: 'Dummyfield',
};

describe('picking a preset', () => {
  it('a_preset_keeps_the_name_typed_against_the_chart_number', () => {
    for (const p of PRESETS) {
      const next = startFromPreset(p, TYPED);
      expect(next.patientRecordNumber, p.key).toBe(p.key === 'refused-no-chart' ? '' : '00999');
      expect(next.givenNames, p.key).toBe('Fern');
      expect(next.familyName, p.key).toBe('Dummyfield');
    }
  });

  it('the_typed_name_reaches_the_envelope_patient_block', () => {
    const envelope = buildEnvelope(startFromPreset(preset('clean'), TYPED));
    expect(envelope.patient).toMatchObject({ givenNames: 'Fern', familyName: 'Dummyfield' });
  });
});

describe('the long-form preset', () => {
  const long = startFromPreset(preset('long-form'), { ...BLANK, patientRecordNumber: '00999' });
  const envelope = buildEnvelope(long) as Record<string, unknown> & {
    services: Record<string, unknown>[];
    providers: Record<string, unknown>[];
    servicingLocation: { addressLines: string[] };
    assignment: { privacyNotice: string[]; statements: { inScope?: boolean }[] };
    patient: Record<string, unknown>;
  };

  it('carries_twelve_service_rows_each_with_an_item_and_a_dollar_amount', () => {
    expect(envelope.services).toHaveLength(12);
    for (const s of envelope.services) {
      expect(s.mbsItemNumber).toMatch(/^\d{1,5}$/);
      // THE STRING AS PRACSOFT PRINTS IT, $ included (D-2026-10-10-08).
      expect(s.benefitAssigned).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);
    }
  });

  it('keeps_the_servicing_number_the_dev_practice_anchors_on', () => {
    const servicing = envelope.providers.find((p) => p.role === 'servicing');
    expect(servicing?.providerNumber).toBe('9999999X');
  });

  it('sends_the_printed_privacy_notice_and_both_statements', () => {
    expect(envelope.assignment.privacyNotice.length).toBeGreaterThanOrEqual(5);
    expect(envelope.assignment.statements.map((s) => s.inScope)).toEqual([true, false]);
  });

  it('fills_a_blank_name_with_a_long_fake_and_keeps_a_typed_one', () => {
    expect(String(envelope.patient.givenNames).length).toBeGreaterThan(20);
    const typed = startFromPreset(preset('long-form'), TYPED);
    expect(typed.givenNames).toBe('Fern');
  });

  it('long_form_card_number_is_the_invalid_checksum_fake', () => {
    // eslint-disable-next-line no-restricted-syntax -- asserting the fixture is the fake (CLAUDE.md §7c), never used to identify anybody (hard rule 1).
    expect(long.medicareCardNumber).toBe(BLANK.medicareCardNumber);
  });

  it('every_value_fits_the_door_dto_limits', () => {
    expect(long.address.length).toBeLessThanOrEqual(500);
    expect(long.locationName.length).toBeLessThanOrEqual(200);
    for (const line of envelope.servicingLocation.addressLines) expect(line.length).toBeLessThanOrEqual(200);
    for (const p of envelope.providers) expect(String(p.name).length).toBeLessThanOrEqual(200);
    for (const s of envelope.services) expect(String(s.description).length).toBeLessThanOrEqual(1000);
    for (const para of envelope.assignment.privacyNotice) expect(para.length).toBeLessThanOrEqual(2000);
  });

  it('a_loaded_long_form_reprints_its_privacy_notice', () => {
    const reloaded = draftFromEnvelope(long.practiceId, envelope, BLANK);
    expect(buildEnvelope(reloaded).assignment).toEqual(envelope.assignment);
  });

  it('a_form_with_no_assignment_block_sends_none', () => {
    expect(buildEnvelope(startFromPreset(preset('clean'), TYPED))).not.toHaveProperty('assignment');
    expect(draftFromEnvelope(BLANK.practiceId, buildEnvelope(BLANK), BLANK).assignment).toBeNull();
  });
});

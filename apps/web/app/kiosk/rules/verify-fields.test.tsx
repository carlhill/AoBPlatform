/**
 * K-2's structured inputs, and the composition that keeps the SERVER CONTRACT
 * unchanged: `stated` is still one string per identifier type.
 *
 * Re-homed from `apps/kiosk/src/rules/verify-fields.test.tsx`. The tests that
 * matter here are the ones that are easy to get wrong by being helpful —
 * letting a half-chosen date go out as a whole one, and trimming a free-text
 * value somewhere that would strip the space between two words while it is
 * still being typed.
 */
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { VerifyScreen } from '../screens/VerifyScreen';
import { identifierFieldsFor } from './identifiers';
import { firstAttempt } from './verification';
import {
  composeDateOfBirth,
  composeName,
  dayOptions,
  EMPTY_PARTS,
  monthOptions,
  partsComplete,
  readyToSubmit,
  trimStatedValues,
  YEAR_SPAN,
  yearOptions,
} from './verify-fields';
import { strings } from '../strings';

const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };
const noop = () => undefined;

describe('composition — the parts become the one string per identifier', () => {
  it('address_sent_trimmed_and_unchanged', () => {
    // THE POINT OF THIS TEST. Address is one free-text line — the server's own
    // token-containment match is what lets a short stated line find a longer
    // held record, so the only thing this device owes the server is the value
    // the patient typed, trimmed of whatever whitespace surrounds it and
    // otherwise untouched: no joining, no reordering, no reformatting.
    const stated = { address: '  2 Example St Sampletown 2000  ', name: 'Jamie Sampleton' };
    expect(trimStatedValues(stated)).toEqual({
      address: '2 Example St Sampletown 2000',
      name: 'Jamie Sampleton',
    });
    // Interior spacing — the words themselves — is untouched.
    expect(trimStatedValues({ address: 'Unit 4 2 Example St' }).address).toBe('Unit 4 2 Example St');
    // Nothing here invents a country, a comma, or any other token the
    // practice's record does not hold.
    expect(trimStatedValues({ address: ' Sampletown ' }).address.toLowerCase()).not.toContain('australia');
  });

  it('composes an ISO date, and nothing at all until all three parts are chosen', () => {
    expect(composeDateOfBirth({ day: '04', month: '08', year: '1962' })).toBe('1962-08-04');
    // Single digits are padded — a picker value of "4" is still the 4th.
    expect(composeDateOfBirth({ day: '4', month: '8', year: '1962' })).toBe('1962-08-04');
    for (const partial of [
      { day: '', month: '08', year: '1962' },
      { day: '04', month: '', year: '1962' },
      { day: '04', month: '08', year: '' },
    ]) {
      expect(composeDateOfBirth(partial)).toBe('');
    }
  });

  it('composes the name given-first, which the server matches in either order', () => {
    expect(composeName({ given: 'Jamie', family: 'Sampleton' })).toBe('Jamie Sampleton');
    expect(composeName({ given: '  Jamie Lee ', family: ' Sampleton ' })).toBe('Jamie Lee Sampleton');
    expect(composeName({ given: '', family: '' })).toBe('');
  });

  it('requires both name parts and a complete date — address is not composed here at all', () => {
    expect(partsComplete('name', { ...EMPTY_PARTS, name: { given: 'Jamie', family: 'Sampleton' } })).toBe(true);
    expect(partsComplete('name', { ...EMPTY_PARTS, name: { given: 'Jamie', family: '' } })).toBe(false);
    expect(
      partsComplete('date_of_birth', { ...EMPTY_PARTS, dateOfBirth: { day: '04', month: '08', year: '1962' } }),
    ).toBe(true);
    // Address is a plain field; this module has no notion of it being "complete".
    expect(partsComplete('address', EMPTY_PARTS)).toBe(false);
  });

  it('offers sensible picker ranges, with the month as a name', () => {
    expect(dayOptions()).toHaveLength(31);
    expect(monthOptions().map((option) => option.label)).toEqual([...strings.verify.monthNames]);
    expect(monthOptions()[7]).toEqual({ value: '08', label: 'August' });
    const years = yearOptions(new Date('2026-09-03T00:00:00.000Z'));
    expect(years).toHaveLength(YEAR_SPAN + 1);
    expect(years[0].value).toBe('2026');
    expect(years[years.length - 1].value).toBe(String(2026 - YEAR_SPAN));
  });
});

describe('K-2 — the structured verification screen', () => {
  const fields = identifierFieldsFor(['name', 'date_of_birth', 'address']);

  /**
   * A THIN STAND-IN FOR THE CEREMONY. `address` is a plain field — its
   * readiness comes from `stated[type]` (see `readyToSubmit`), not from a
   * local draft the way the composite identifiers work — so a test that wants
   * Continue to react to what was typed into it has to behave like
   * `Ceremony.tsx` actually does and feed `onChange` back into the `stated`
   * prop, or the address box types into the void and Continue never sees it.
   */
  function Harness({
    onContinue = noop,
    onSent,
  }: {
    onContinue?: () => void;
    onSent?: (sent: Readonly<Record<string, string>>) => void;
  }) {
    const [stated, setStated] = useState<Record<string, string>>({});
    return (
      <VerifyScreen
        {...CHROME}
        fields={fields}
        stated={stated}
        state={firstAttempt()}
        busy={false}
        incomplete={false}
        startError={false}
        mismatch={false}
        onChange={(type, value) => {
          setStated((prev) => {
            const next = { ...prev, [type]: value };
            onSent?.(next);
            return next;
          });
        }}
        onContinue={onContinue}
        onSeeReception={noop}
      />
    );
  }

  function renderScreen(onContinue = noop, onSent?: (sent: Readonly<Record<string, string>>) => void) {
    return render(<Harness onContinue={onContinue} onSent={onSent} />);
  }

  it('renders a structured control for both composite identifiers, and one plain line for address', () => {
    const view = renderScreen();
    for (const testId of [
      'identifier-name-given',
      'identifier-name-family',
      'identifier-dob-day',
      'identifier-dob-month',
      'identifier-dob-year',
      'identifier-address',
    ]) {
      expect(view.getByTestId(testId)).toBeTruthy();
    }
    // The single free-text boxes name/DOB replaced are gone; address never
    // grew line1/line2/suburb/state/postcode/country controls.
    expect(view.queryByTestId('identifier-name')).toBeNull();
    expect(view.queryByTestId('identifier-date_of_birth')).toBeNull();
    expect(view.queryByTestId('identifier-address-line1')).toBeNull();
    expect(view.queryByTestId('identifier-address-state')).toBeNull();
    expect(view.queryByTestId('identifier-address-country')).toBeNull();
    // The placeholder is inside the box.
    expect(view.getByTestId('identifier-address').getAttribute('placeholder')).toBe(
      strings.verify.identifierHints.address,
    );
  });

  it('address_is_labelled_once_and_hinted_once', () => {
    /*
     * CARL, 3 SEP 2026, LOOKING AT K-2: "Your home address" appeared twice —
     * as the group heading and again as the field's own label — and "Street,
     * suburb and postcode" appeared twice as well, as the placeholder AND as a
     * hint line under the box. Four pieces of chrome for one input, on a screen
     * read standing up by somebody who may be unwell.
     *
     * A group heading exists to name a SET of sub-fields. "Your full name" over
     * Given/Family and "Date of birth" over Day/Month/Year are doing work; over
     * a single box it is the label printed twice. So the heading is drawn for
     * the composite identifiers only, and the hint is passed as the placeholder
     * alone.
     */
    const view = renderScreen();
    const body = view.container.textContent ?? '';

    const addressLabel = strings.verify.identifierNames.address;
    const addressHint = strings.verify.identifierHints.address;
    expect(body.split(addressLabel).length - 1).toBe(1);
    // The hint lives in the placeholder attribute, which is not text content —
    // so it must not appear in the rendered text at all.
    expect(body).not.toContain(addressHint);
    expect(view.getByTestId('identifier-address').getAttribute('placeholder')).toBe(addressHint);

    // The composite identifiers KEEP their heading, because they have
    // sub-fields to name and their sub-labels say something different.
    expect(body).toContain(strings.verify.identifierNames.name);
    expect(body).toContain(strings.verify.nameGiven);
    expect(body).toContain(strings.verify.identifierNames.date_of_birth);
    expect(body).toContain(strings.verify.dobDay);
  });

  it('composes what the ceremony sends', () => {
    let sent: Readonly<Record<string, string>> = {};
    const view = renderScreen(noop, (next) => {
      sent = next;
    });

    fireEvent.change(view.getByTestId('identifier-name-given'), { target: { value: 'Jamie' } });
    fireEvent.change(view.getByTestId('identifier-name-family'), { target: { value: 'Sampleton' } });
    fireEvent.change(view.getByTestId('identifier-address'), {
      target: { value: '2 Example St Sampletown 2000' },
    });
    fireEvent.change(view.getByTestId('identifier-dob-day'), { target: { value: '04' } });
    fireEvent.change(view.getByTestId('identifier-dob-month'), { target: { value: '08' } });
    fireEvent.change(view.getByTestId('identifier-dob-year'), { target: { value: '1962' } });

    expect(sent.name).toBe('Jamie Sampleton');
    expect(sent.date_of_birth).toBe('1962-08-04');
    expect(sent.address).toBe('2 Example St Sampletown 2000');
  });

  it('continue_disabled_until_the_mandatory_parts_are_filled', () => {
    const onContinue = vi.fn();
    const view = renderScreen(onContinue);
    const blocked = view.getByTestId('verify-continue') as HTMLButtonElement;
    // The disabled control is a real `button[disabled]` with no handler — the
    // same primitive the signature gate uses — so there is nothing to press.
    expect(blocked.disabled).toBe(true);
    expect(blocked.getAttribute('aria-label')).toBe(strings.verify.continueBlocked);
    fireEvent.click(blocked);
    expect(onContinue).toHaveBeenCalledTimes(0);

    fireEvent.change(view.getByTestId('identifier-name-given'), { target: { value: 'Jamie' } });
    fireEvent.change(view.getByTestId('identifier-name-family'), { target: { value: 'Sampleton' } });
    fireEvent.change(view.getByTestId('identifier-address'), {
      target: { value: '2 Example St Sampletown 2000' },
    });
    // Still short of a date of birth: two of three pickers is not a date.
    fireEvent.change(view.getByTestId('identifier-dob-day'), { target: { value: '04' } });
    fireEvent.change(view.getByTestId('identifier-dob-month'), { target: { value: '08' } });
    expect((view.getByTestId('verify-continue') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(view.getByTestId('identifier-dob-year'), { target: { value: '1962' } });
    const enabled = view.getByTestId('verify-continue') as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    expect(enabled.getAttribute('aria-label')).toBe(strings.verify.continueAction);
    fireEvent.click(enabled);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('the refusal names no identifier, exactly as the mismatch copy does not', () => {
    expect(strings.verify.continueBlocked.toLowerCase()).not.toMatch(/name|birth|address|gender|record|ihi/);
    expect(readyToSubmit(['name'], EMPTY_PARTS, {})).toBe(false);
    // A non-composite identifier still comes from `stated`, as it always did.
    expect(readyToSubmit(['address'], EMPTY_PARTS, { address: '2 Example St' })).toBe(true);
    expect(readyToSubmit(['gender'], EMPTY_PARTS, { gender: 'Female' })).toBe(true);
    expect(readyToSubmit(['gender'], EMPTY_PARTS, { gender: '  ' })).toBe(false);
  });

  it('every field is labelled', () => {
    // WCAG 2.2 AA — every control has a real, bound `<label>`. A placeholder is
    // not a label: it disappears the moment somebody types, which is exactly
    // when an unwell person at a tablet most needs to know what the box was for.
    const view = renderScreen();
    for (const [testId, label] of [
      ['identifier-name-given', strings.verify.nameGiven],
      ['identifier-name-family', strings.verify.nameFamily],
      ['identifier-dob-day', strings.verify.dobDay],
      ['identifier-dob-month', strings.verify.dobMonth],
      ['identifier-dob-year', strings.verify.dobYear],
      ['identifier-address', strings.verify.identifierNames.address],
    ] as const) {
      const control = view.getByTestId(testId);
      expect(control.getAttribute('aria-label')).toBe(label);
      // And a real `<label for>` as well, not only the aria attribute.
      const bound = view.container.querySelector(`label[for="${control.id}"]`);
      expect(bound?.textContent).toBe(label);
    }
  });
});

/**
 * K-2's structured inputs, and the composition that keeps the SERVER CONTRACT
 * unchanged: `stated` is still one string per identifier type.
 *
 * The tests that matter here are the ones that are easy to get wrong by being
 * helpful — letting a half-chosen date go out as a whole one, and trimming a
 * free-text value somewhere that would strip the space between two words
 * while it is still being typed.
 */
import { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
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
    // THE POINT OF THIS TEST. Address went back to one free-text line (Carl,
    // 3 Sep 2026) — the server's own token-containment match is what lets a
    // short stated line find a longer held record, so the only thing this
    // device owes the server is the value the patient typed, trimmed of
    // whatever whitespace surrounds it and otherwise untouched: no joining,
    // no reordering, no reformatting.
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
    // Address is a plain field now (see VerifyScreen's generic branch); this
    // module has no notion of it being "complete".
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
   * A THIN STAND-IN FOR THE CEREMONY. `address` is a plain field now — its
   * readiness comes from `stated[type]` (see `readyToSubmit`), not from a
   * local draft the way the composite identifiers work — so a test that
   * wants Continue to react to what was typed into it has to behave like
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
        onChange={(type, value) => {
          setStated((prev) => {
            const next = { ...prev, [type]: value };
            onSent?.(next);
            return next;
          });
        }}
        onContinue={onContinue}
        onRetry={noop}
        onSeeReception={noop}
      />
    );
  }

  function renderScreen(onContinue = noop, onSent?: (sent: Readonly<Record<string, string>>) => void) {
    return render(<Harness onContinue={onContinue} onSent={onSent} />);
  }

  it('renders a structured control for both composite identifiers, and one plain line for address', async () => {
    const screen = await renderScreen();
    for (const testID of [
      'identifier-name-given',
      'identifier-name-family',
      'identifier-dob-day',
      'identifier-dob-month',
      'identifier-dob-year',
      'identifier-address',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
    // The single free-text boxes name/DOB replaced are gone; address never
    // grew line1/line2/suburb/state/postcode/country controls.
    expect(screen.queryByTestId('identifier-name')).toBeNull();
    expect(screen.queryByTestId('identifier-date_of_birth')).toBeNull();
    expect(screen.queryByTestId('identifier-address-line1')).toBeNull();
    expect(screen.queryByTestId('identifier-address-state')).toBeNull();
    expect(screen.queryByTestId('identifier-address-country')).toBeNull();
    // The placeholder inside the box, not a second label.
    expect(screen.getByTestId('identifier-address').props.placeholder).toBe(strings.verify.identifierHints.address);
    await screen.unmount();
  });

  it('composes what the ceremony sends', async () => {
    let sent: Readonly<Record<string, string>> = {};
    const screen = await renderScreen(noop, (next) => {
      sent = next;
    });

    await fireEvent.changeText(screen.getByTestId('identifier-name-given'), 'Jamie');
    await fireEvent.changeText(screen.getByTestId('identifier-name-family'), 'Sampleton');
    await fireEvent.changeText(screen.getByTestId('identifier-address'), '2 Example St Sampletown 2000');
    await fireEvent(screen.getByTestId('identifier-dob-day'), 'valueChange', '04');
    await fireEvent(screen.getByTestId('identifier-dob-month'), 'valueChange', '08');
    await fireEvent(screen.getByTestId('identifier-dob-year'), 'valueChange', '1962');

    expect(sent.name).toBe('Jamie Sampleton');
    expect(sent.date_of_birth).toBe('1962-08-04');
    expect(sent.address).toBe('2 Example St Sampletown 2000');
    await screen.unmount();
  });

  it('continue_disabled_until_the_mandatory_parts_are_filled', async () => {
    const onContinue = jest.fn();
    const screen = await renderScreen(onContinue);
    const blocked = screen.getByTestId('verify-continue');
    // The disabled control is a View with no `onPress` at all — the same
    // primitive the signature gate uses — so there is nothing to press.
    // (It is not fired here on purpose: RNTL's fireEvent walks up to the
    // COMPOSITE element's props and would find the `onPress` passed to
    // GuardedButton, which the disabled branch never renders.)
    expect(blocked.props.accessibilityState?.disabled).toBe(true);
    expect(blocked.props.accessibilityLabel).toBe(strings.verify.continueBlocked);
    expect(blocked.props.onPress).toBeUndefined();
    expect(onContinue).toHaveBeenCalledTimes(0);

    await fireEvent.changeText(screen.getByTestId('identifier-name-given'), 'Jamie');
    await fireEvent.changeText(screen.getByTestId('identifier-name-family'), 'Sampleton');
    await fireEvent.changeText(screen.getByTestId('identifier-address'), '2 Example St Sampletown 2000');
    // Still short of a date of birth: two of three pickers is not a date.
    await fireEvent(screen.getByTestId('identifier-dob-day'), 'valueChange', '04');
    await fireEvent(screen.getByTestId('identifier-dob-month'), 'valueChange', '08');
    expect(screen.getByTestId('verify-continue').props.accessibilityState?.disabled).toBe(true);

    await fireEvent(screen.getByTestId('identifier-dob-year'), 'valueChange', '1962');
    const enabled = screen.getByTestId('verify-continue');
    expect(enabled.props.accessibilityState?.disabled).toBeFalsy();
    expect(enabled.props.accessibilityLabel).toBe(strings.verify.continueAction);
    await fireEvent.press(enabled);
    expect(onContinue).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('the refusal names no identifier, exactly as the mismatch copy does not', () => {
    expect(strings.verify.continueBlocked.toLowerCase()).not.toMatch(/name|birth|address|gender|record|ihi/);
    expect(readyToSubmit(['name'], EMPTY_PARTS, {})).toBe(false);
    // A non-composite identifier still comes from `stated`, as it always did
    // — address included, now.
    expect(readyToSubmit(['address'], EMPTY_PARTS, { address: '2 Example St' })).toBe(true);
    expect(readyToSubmit(['gender'], EMPTY_PARTS, { gender: 'Female' })).toBe(true);
    expect(readyToSubmit(['gender'], EMPTY_PARTS, { gender: '  ' })).toBe(false);
  });

  it('every field is labelled', async () => {
    const screen = await renderScreen();
    for (const [testID, label] of [
      ['identifier-name-given', strings.verify.nameGiven],
      ['identifier-name-family', strings.verify.nameFamily],
      ['identifier-dob-day', strings.verify.dobDay],
      ['identifier-dob-month', strings.verify.dobMonth],
      ['identifier-dob-year', strings.verify.dobYear],
      ['identifier-address', strings.verify.identifierNames.address],
    ] as const) {
      expect(screen.getByTestId(testID).props.accessibilityLabel).toBe(label);
    }
    await screen.unmount();
  });
});

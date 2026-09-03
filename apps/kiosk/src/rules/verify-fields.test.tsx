/**
 * K-2's structured inputs, and the composition that keeps the SERVER CONTRACT
 * unchanged: `stated` is still one string per identifier type.
 *
 * The tests that matter here are the two that are easy to get wrong by being
 * helpful — sending the country the form collects, and letting a half-chosen
 * date go out as a whole one.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { VerifyScreen } from '../screens/VerifyScreen';
import { identifierFieldsFor } from './identifiers';
import { firstAttempt } from './verification';
import {
  composeAddress,
  composeDateOfBirth,
  composeName,
  dayOptions,
  EMPTY_PARTS,
  monthOptions,
  partsComplete,
  readyToSubmit,
  stateOptions,
  YEAR_SPAN,
  yearOptions,
} from './verify-fields';
import { strings } from '../strings';

const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };
const noop = () => undefined;

const FULL_ADDRESS = {
  line1: '2 Example St',
  line2: '',
  suburb: 'Sampletown',
  state: 'NSW',
  postcode: '2000',
  country: 'Australia',
};

describe('composition — the parts become the one string per identifier', () => {
  it('address_composed_without_country', () => {
    // THE POINT OF THIS TEST. The practice's record has no country in it and
    // the server compares tokens by containment, so a stated "Australia" is a
    // token the practice cannot hold — it would fail every attempt, on a
    // screen that is not allowed to say which detail was wrong.
    const composed = composeAddress(FULL_ADDRESS);
    expect(composed).toBe('2 Example St Sampletown NSW 2000');
    expect(composed.toLowerCase()).not.toContain('australia');
    // Any country, and a country the patient edited by hand, are both dropped.
    expect(composeAddress({ ...FULL_ADDRESS, country: 'New Zealand' })).toBe(composed);
    expect(composeAddress({ ...FULL_ADDRESS, country: '' })).toBe(composed);
    // The default is Australia, and it still never reaches the wire.
    expect(EMPTY_PARTS.address.country).toBe(strings.verify.defaultCountry);
  });

  it('joins the address components with single spaces and drops the empty ones', () => {
    expect(composeAddress({ ...FULL_ADDRESS, line2: 'Unit 4' })).toBe('2 Example St Unit 4 Sampletown NSW 2000');
    expect(composeAddress({ ...FULL_ADDRESS, state: '' })).toBe('2 Example St Sampletown 2000');
    expect(composeAddress({ ...FULL_ADDRESS, line1: '  2 Example St  ' })).toBe('2 Example St Sampletown NSW 2000');
    expect(composeAddress({ line1: '', line2: '', suburb: '', state: '', postcode: '', country: 'Australia' })).toBe('');
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

  it('requires line 1, suburb and postcode — but not line 2 or the state', () => {
    const parts = { ...EMPTY_PARTS, address: FULL_ADDRESS };
    expect(partsComplete('address', parts)).toBe(true);
    expect(partsComplete('address', { ...parts, address: { ...FULL_ADDRESS, line2: '' } })).toBe(true);
    expect(partsComplete('address', { ...parts, address: { ...FULL_ADDRESS, state: '' } })).toBe(true);
    for (const missing of ['line1', 'suburb', 'postcode'] as const) {
      expect(partsComplete('address', { ...parts, address: { ...FULL_ADDRESS, [missing]: '' } })).toBe(false);
    }
  });

  it('offers sensible picker ranges, with the month as a name', () => {
    expect(dayOptions()).toHaveLength(31);
    expect(monthOptions().map((option) => option.label)).toEqual([...strings.verify.monthNames]);
    expect(monthOptions()[7]).toEqual({ value: '08', label: 'August' });
    const years = yearOptions(new Date('2026-09-03T00:00:00.000Z'));
    expect(years).toHaveLength(YEAR_SPAN + 1);
    expect(years[0].value).toBe('2026');
    expect(years[years.length - 1].value).toBe(String(2026 - YEAR_SPAN));
    // Every Australian state and territory, none invented.
    expect(stateOptions().map((option) => option.value)).toEqual(
      ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'],
    );
  });
});

describe('K-2 — the structured verification screen', () => {
  const fields = identifierFieldsFor(['name', 'date_of_birth', 'address']);

  function renderScreen(onChange: (type: string, value: string) => void, onContinue = noop) {
    return render(
      <VerifyScreen
        {...CHROME}
        fields={fields}
        stated={{}}
        state={firstAttempt()}
        busy={false}
        incomplete={false}
        startError={false}
        onChange={onChange}
        onContinue={onContinue}
        onRetry={noop}
        onSeeReception={noop}
      />,
    );
  }

  it('renders a structured control for every composite identifier', async () => {
    const screen = await renderScreen(noop);
    for (const testID of [
      'identifier-name-given',
      'identifier-name-family',
      'identifier-dob-day',
      'identifier-dob-month',
      'identifier-dob-year',
      'identifier-address-line1',
      'identifier-address-line2',
      'identifier-address-suburb',
      'identifier-address-state',
      'identifier-address-postcode',
      'identifier-address-country',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
    // The single free-text boxes they replaced are gone.
    expect(screen.queryByTestId('identifier-name')).toBeNull();
    expect(screen.queryByTestId('identifier-date_of_birth')).toBeNull();
    expect(screen.queryByTestId('identifier-address')).toBeNull();
    // The country defaults so nobody has to answer a question with one answer.
    expect(screen.getByTestId('identifier-address-country').props.value).toBe(strings.verify.defaultCountry);
    await screen.unmount();
  });

  it('composes what the ceremony sends, and never sends the country', async () => {
    const sent: Record<string, string> = {};
    const screen = await renderScreen((type, value) => {
      sent[type] = value;
    });

    await fireEvent.changeText(screen.getByTestId('identifier-name-given'), 'Jamie');
    await fireEvent.changeText(screen.getByTestId('identifier-name-family'), 'Sampleton');
    await fireEvent.changeText(screen.getByTestId('identifier-address-line1'), '2 Example St');
    await fireEvent.changeText(screen.getByTestId('identifier-address-suburb'), 'Sampletown');
    await fireEvent.changeText(screen.getByTestId('identifier-address-postcode'), '2000');
    await fireEvent(screen.getByTestId('identifier-address-state'), 'valueChange', 'NSW');
    await fireEvent(screen.getByTestId('identifier-dob-day'), 'valueChange', '04');
    await fireEvent(screen.getByTestId('identifier-dob-month'), 'valueChange', '08');
    await fireEvent(screen.getByTestId('identifier-dob-year'), 'valueChange', '1962');

    expect(sent.name).toBe('Jamie Sampleton');
    expect(sent.date_of_birth).toBe('1962-08-04');
    expect(sent.address).toBe('2 Example St Sampletown NSW 2000');
    expect(JSON.stringify(sent).toLowerCase()).not.toContain('australia');
    await screen.unmount();
  });

  it('continue_disabled_until_the_mandatory_parts_are_filled', async () => {
    const onContinue = jest.fn();
    const screen = await renderScreen(noop, onContinue);
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
    await fireEvent.changeText(screen.getByTestId('identifier-address-line1'), '2 Example St');
    await fireEvent.changeText(screen.getByTestId('identifier-address-suburb'), 'Sampletown');
    await fireEvent.changeText(screen.getByTestId('identifier-address-postcode'), '2000');
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
    // A non-composite identifier still comes from `stated`, as it always did.
    expect(readyToSubmit(['gender'], EMPTY_PARTS, { gender: 'Female' })).toBe(true);
    expect(readyToSubmit(['gender'], EMPTY_PARTS, { gender: '  ' })).toBe(false);
  });

  it('every field is labelled', async () => {
    const screen = await renderScreen(noop);
    for (const [testID, label] of [
      ['identifier-name-given', strings.verify.nameGiven],
      ['identifier-name-family', strings.verify.nameFamily],
      ['identifier-dob-day', strings.verify.dobDay],
      ['identifier-dob-month', strings.verify.dobMonth],
      ['identifier-dob-year', strings.verify.dobYear],
      ['identifier-address-line1', strings.verify.addressLine1],
      ['identifier-address-line2', strings.verify.addressLine2],
      ['identifier-address-suburb', strings.verify.suburb],
      ['identifier-address-state', strings.verify.addressState],
      ['identifier-address-postcode', strings.verify.postcode],
      ['identifier-address-country', strings.verify.country],
    ] as const) {
      expect(screen.getByTestId(testID).props.accessibilityLabel).toBe(label);
    }
    await screen.unmount();
  });
});

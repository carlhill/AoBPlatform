/**
 * "FILLED" ON K-2 (Carl, 4 Sep 2026). Once a field has a value it is marked
 * so — an outline in the theme's own success token (`--ok`, tokens.css), never
 * a hard-coded colour, plus a tick glyph beside the label so the state does
 * not depend on colour alone (WCAG 1.4.1).
 *
 * "FILLED" IS NOT "VALID". The identifiers are not checked until Continue is
 * pressed and the server answers, so this state must never claim more than
 * "there is something here" — asserted below by checking the label text
 * never grows the words "valid" or "verified".
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Field, SelectField } from './Field';

describe('filled_fields_are_marked_without_relying_on_colour', () => {
  it('a text field shows the tick once it has a value, and drops it when cleared', () => {
    const view = render(
      <Field label="Given name(s)" value="" onChangeText={() => undefined} testId="given-name" />,
    );

    // Empty: no tick, and the input carries no filled marker.
    expect(view.queryByTestId('given-name-filled')).toBeNull();
    expect((view.getByTestId('given-name') as HTMLInputElement).className).not.toMatch(/inputFilled/);

    fireEvent.change(view.getByTestId('given-name'), { target: { value: 'Jamie' } });
    view.rerender(<Field label="Given name(s)" value="Jamie" onChangeText={() => undefined} testId="given-name" />);

    const tick = view.getByTestId('given-name-filled');
    expect(tick).toBeTruthy();
    expect(tick.getAttribute('aria-hidden')).toBe('true');
    expect((view.getByTestId('given-name') as HTMLInputElement).className).toMatch(/inputFilled/);

    // Never claims correctness — only presence.
    expect(view.getByText(/Given name\(s\)/).closest('label')?.textContent ?? '').not.toMatch(/valid|verified/i);

    // Cleared again: the marker goes with it.
    view.rerender(<Field label="Given name(s)" value="" onChangeText={() => undefined} testId="given-name" />);
    expect(view.queryByTestId('given-name-filled')).toBeNull();
  });

  it('a whitespace-only value is not treated as filled', () => {
    const view = render(<Field label="Address" value="   " onChangeText={() => undefined} testId="address" />);
    expect(view.queryByTestId('address-filled')).toBeNull();
  });

  it('a select field is marked the same way once an option is chosen', () => {
    const view = render(
      <SelectField
        label="Day"
        value=""
        options={[{ value: '04', label: '04' }]}
        placeholder="Choose"
        onValueChange={() => undefined}
        testId="dob-day"
      />,
    );
    expect(view.queryByTestId('dob-day-filled')).toBeNull();

    view.rerender(
      <SelectField
        label="Day"
        value="04"
        options={[{ value: '04', label: '04' }]}
        placeholder="Choose"
        onValueChange={() => undefined}
        testId="dob-day"
      />,
    );
    expect(view.getByTestId('dob-day-filled')).toBeTruthy();
    expect((view.getByTestId('dob-day') as HTMLSelectElement).className).toMatch(/inputFilled/);
  });
});

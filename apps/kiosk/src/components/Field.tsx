/**
 * One labelled input, sized for a tablet: 64px tall, 20px text, and a visible
 * focus ring rather than the platform default (handoff: 2px accent, offset 2).
 *
 * The label is passed in from the string table by the caller — this component
 * holds no copy of its own, which is what keeps REQ-LANG-01 true at the leaf.
 */
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { colors, fonts, layout, space, type } from '../theme';

/**
 * "Focus: 2px solid var(--color-accent), offset 2px — NEVER the browser
 * default" (handoff, design tokens). The browser default is an orange ring on
 * some platforms, which on this palette reads as an error.
 *
 * Cast, and here is why: `outline*` are real react-native-web style properties
 * but are absent from React Native's own `TextStyle`, so there is no
 * type-clean way to express them. Native ignores the object entirely.
 */
const FOCUS_RING = Platform.OS === 'web'
  ? ({
      outlineColor: colors.accent,
      outlineWidth: 2,
      outlineOffset: 2,
      outlineStyle: 'solid',
    } as unknown as TextStyle)
  : undefined;

export function Field({
  label,
  hint,
  value,
  onChangeText,
  testID,
  autoFocus,
  style,
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (next: string) => void;
  testID?: string;
  autoFocus?: boolean;
  /**
   * SIZING BELONGS TO THE CONTAINER, NOT TO THE FIELD.
   *
   * This used to carry `flexGrow: 1` so it would share a row nicely. In a
   * COLUMN it did the opposite: each field grew to fill the leftover height,
   * so portrait at 820x1180 put 196px of nothing between one input and the
   * next, and Carl's 670px window looked like an unfinished form. A field has
   * one height — its label plus a 64px input — and the row that wants two of
   * them side by side is the thing that should say so.
   */
  style?: object;
}): ReactNode {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        autoCorrect={false}
        style={[styles.input, focused ? styles.inputFocused : null, FOCUS_RING]}
        placeholder={hint}
        placeholderTextColor={colors.neutral600}
      />
    </View>
  );
}

/**
 * One labelled picker, sized to match `Field` exactly so a row of a text input
 * and a picker does not step up and down.
 *
 * WHY A PICKER AND NOT A TYPED VALUE. A date of birth typed into a box asks the
 * patient to guess our format, and the only feedback a wrong guess gets is
 * "some details don't match" — the mismatch copy cannot say which detail it
 * was (REQ-SEC-07), so a format trap is unrecoverable by design. Choosing from
 * a list cannot be mis-formatted.
 *
 * ON WEB THIS IS A REAL `<select>`. `@react-native-picker/picker` resolves to
 * `Picker.web.js`, which renders a DOM select through react-native-web — so it
 * is in the tab order, operable by keyboard alone, and announced by a screen
 * reader as a native control, without this file re-implementing any of that
 * (WCAG 2.2 AA). On the tablet it is the platform's own wheel or dropdown.
 *
 * THE FIRST OPTION IS EMPTY on purpose. Nothing is chosen on the patient's
 * behalf — a picker that defaults to "January" invites somebody to leave it
 * there and then tells them their details do not match.
 */
export function PickerField({
  label,
  value,
  options,
  placeholder,
  onValueChange,
  testID,
  style,
}: {
  label: string;
  value: string;
  options: readonly { readonly value: string; readonly label: string }[];
  /** The empty first option's label. */
  placeholder: string;
  onValueChange: (next: string) => void;
  testID?: string;
  /** Sizing belongs to the container — see the note on `Field`. */
  style?: object;
}): ReactNode {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <Picker
        testID={testID}
        accessibilityLabel={label}
        selectedValue={value}
        onValueChange={(next) => onValueChange(String(next ?? ''))}
        style={[styles.input, styles.picker] as never}
        itemStyle={styles.pickerItem}
      >
        <Picker.Item label={placeholder} value="" />
        {options.map((option) => (
          <Picker.Item key={option.value} label={option.label} value={option.value} />
        ))}
      </Picker>
    </View>
  );
}

export function Checkbox({
  label,
  checked,
  onToggle,
  testID,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  testID?: string;
}): ReactNode {
  return (
    <View style={styles.checkboxRow}>
      <Text
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        testID={testID}
        onPress={onToggle}
        style={[styles.checkbox, checked ? styles.checkboxChecked : null]}
      >
        {checked ? '✓' : ' '}
      </Text>
      <Text style={styles.checkboxLabel} onPress={onToggle}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  label: { fontFamily: fonts.bodyMedium, fontSize: type.label, color: colors.neutral700 },
  input: {
    minHeight: 64,
    fontFamily: fonts.body,
    fontSize: 20,
    color: colors.ink,
    backgroundColor: colors.white,
    borderWidth: layout.borderWidth,
    borderColor: colors.divider,
    borderRadius: layout.radius,
    paddingHorizontal: space.md,
  },
  inputFocused: { borderColor: colors.accent, borderWidth: 2 },
  /*
   * The web `<select>` needs its own height: `minHeight` alone leaves a
   * browser-sized control inside a 64px box, so the row of DOB pickers sat
   * short beside the text inputs next to it.
   */
  picker: { height: 64, paddingVertical: 0, width: '100%', maxWidth: '100%' },
  /** iOS renders the wheel with this; every other platform ignores it. */
  pickerItem: { fontFamily: fonts.body, fontSize: 20, color: colors.ink },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: layout.minTarget },
  checkbox: {
    width: 44,
    height: 44,
    lineHeight: 44,
    textAlign: 'center',
    fontSize: 22,
    color: colors.white,
    backgroundColor: colors.surface,
    borderWidth: layout.borderWidth,
    borderColor: colors.divider,
    borderRadius: layout.radius,
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent700 },
  checkboxLabel: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink, flexShrink: 1 },
});

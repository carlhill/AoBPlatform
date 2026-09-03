/**
 * Buttons, and the one primitive every REQ-REG-06 surface is built on.
 *
 * `GuardedButton` is disabled-with-a-reason. A disabled control that says only
 * "no" sends the patient to a staff member who also cannot see why, so the
 * reason travels with the refusal — on the label and, where there is room, in
 * the list beside it.
 *
 * EVERY TARGET IS AT LEAST `layout.minTarget` (56px). That is not the WCAG
 * floor of 44 — it is the kiosk floor, because the person tapping is standing
 * up, often elderly, sometimes holding a bag. `minHeight` is set from the
 * token in every variant here so a new button cannot be born too small.
 */
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, layout, space, type } from '../theme';

type Size = 'primary' | 'standard';

export function PrimaryButton({
  label,
  onPress,
  size = 'primary',
  testID,
}: {
  label: string;
  onPress: () => void;
  size?: Size;
  testID?: string;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles.primary,
        size === 'primary' ? styles.tallTarget : styles.standardTarget,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.label, styles.primaryLabel, size === 'primary' ? styles.labelLarge : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * `selected` is for a CHOICE among options — K-5's "who is signing" pair is
 * the first user — not for a generic pressed/active state. Unselected and
 * selected must never look the same: this fills the control and sets
 * `accessibilityState.selected`, which react-native-web renders as
 * `aria-selected` (Carl, 3 Sep 2026 live test — tapping "I am signing for
 * myself" looked like it had done nothing, because nothing about the button
 * changed).
 */
export function SecondaryButton({
  label,
  onPress,
  align = 'center',
  selected = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  align?: 'center' | 'left';
  selected?: boolean;
  testID?: string;
}): ReactNode {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles.secondary,
        selected ? styles.secondarySelected : null,
        styles.standardTarget,
        align === 'left' ? styles.alignLeft : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        style={[
          styles.label,
          styles.secondaryLabel,
          selected ? styles.secondaryLabelSelected : null,
          align === 'left' ? styles.labelLeft : null,
        ]}
      >
        {selected ? `${CHECK_MARK} ` : ''}
        {label}
      </Text>
    </Pressable>
  );
}

/** The same glyph `Checkbox` already uses for its ticked state — one mark, one meaning, across this device. */
const CHECK_MARK = '✓';

/**
 * The disabled-with-reason primitive.
 *
 * `disabledReason` is REQUIRED whenever `disabled` is true — the type below
 * makes the two travel together, so it is not possible to build a control that
 * refuses without saying why.
 */
export type GuardedButtonState =
  | { readonly disabled: false }
  | { readonly disabled: true; readonly disabledLabel: string; readonly reasons?: readonly string[] };

export function GuardedButton({
  label,
  state,
  onPress,
  testID,
}: {
  label: string;
  state: GuardedButtonState;
  onPress: () => void;
  testID?: string;
}): ReactNode {
  if (state.disabled) {
    return (
      <View>
        <View
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityLabel={state.disabledLabel}
          testID={testID}
          style={[styles.base, styles.tallTarget, styles.disabled]}
        >
          <Text style={[styles.label, styles.labelLarge, styles.disabledLabel]}>{state.disabledLabel}</Text>
        </View>
        {state.reasons && state.reasons.length > 0 ? (
          <View style={styles.reasons}>
            {state.reasons.map((reason, index) => (
              <View key={reason} style={styles.reasonRow}>
                <Text style={styles.reasonOrdinal}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.reasonText}>{reason}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  }
  return <PrimaryButton label={label} onPress={onPress} testID={testID} />;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: layout.radius,
    borderWidth: layout.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  standardTarget: { minHeight: layout.minTarget },
  tallTarget: { minHeight: layout.primaryTarget },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent700 },
  secondary: { backgroundColor: colors.surface, borderColor: colors.divider },
  // Filled and accent-bordered, not a colour tint alone — the unmistakable
  // state a choice control needs (Buttons.tsx doc comment, above).
  secondarySelected: { backgroundColor: colors.accent100, borderColor: colors.accent, borderWidth: 2 },
  disabled: { backgroundColor: colors.neutral300, borderColor: colors.neutral400 },
  alignLeft: { alignItems: 'flex-start' },
  pressed: { opacity: 0.85 },
  label: { fontFamily: fonts.bodyMedium, fontSize: type.body, textAlign: 'center' },
  labelLarge: { fontSize: type.bodyLarge },
  labelLeft: { textAlign: 'left' },
  primaryLabel: { color: colors.white },
  secondaryLabel: { color: colors.ink },
  secondaryLabelSelected: { color: colors.accent800, fontFamily: fonts.bodyBold },
  // Colour is never the sole carrier of state: the disabled label says what is
  // missing, in words, and the reasons are listed beneath it.
  disabledLabel: { color: colors.neutral800 },
  reasons: { marginTop: space.sm, gap: space.xs },
  reasonRow: { flexDirection: 'row', gap: space.xs },
  reasonOrdinal: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
  reasonText: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink, flexShrink: 1 },
});

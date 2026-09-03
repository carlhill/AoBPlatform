/**
 * K-2 — verification, and K-2b's mismatch and lockout states.
 *
 * THE FIELD SET IS THE SERVER'S. `identifierTypes` arrives on the waiting-list
 * response and `identifierFieldsFor` puts it through the domain's own
 * `assertValidIdentifierSet` before a single input is drawn. There is no
 * Medicare card field on this screen and no setting on this device that could
 * add one — the kiosk holds no configuration at all (REQ-VER-02).
 *
 * A MISMATCH SAYS ONE THING. "Some details don't match" — never which one,
 * never a highlighted field, never "two of three". Naming the failure tells
 * whoever is standing there which details they already have right.
 *
 * PORTRAIT STACKS, IT DOES NOT REDUCE. The same fields appear in both
 * orientations; only the column count changes.
 *
 * A LOCKOUT ROUTES TO RECEPTION AND SAYS THE APPOINTMENT IS UNAFFECTED
 * (REQ-REC-04). Nothing on this screen can stop a patient being seen.
 */
import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Blueprint, Kicker, Screen, useOrientation } from '../components/Chrome';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';
import type { IdentifierField } from '../rules/identifiers';
import { KIOSK_MAX_ATTEMPTS, mismatchHeading, mismatchMessage, type VerificationState } from '../rules/verification';

export function VerifyScreen({
  practiceName,
  locationLine,
  fields,
  stated,
  state,
  busy,
  incomplete,
  startError,
  onChange,
  onContinue,
  onRetry,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  fields: readonly IdentifierField[];
  stated: Readonly<Record<string, string>>;
  state: VerificationState;
  busy: boolean;
  incomplete: boolean;
  startError: boolean;
  onChange: (type: string, value: string) => void;
  onContinue: () => void;
  onRetry: () => void;
  onSeeReception: () => void;
}): ReactNode {
  const orientation = useOrientation();
  const stepTag = `${strings.chrome.stepOf(1, 4)} — ${strings.chrome.stepDetails}`;

  if (state.kind === 'locked') {
    return (
      <Screen
        practiceName={practiceName}
        locationLine={locationLine}
        stepTag={strings.chrome.stepOf(1, 4)}
        context={strings.verify.lockedFooter}
      >
        <Blueprint style={styles.panel}>
          <Text style={styles.h3}>{strings.verify.lockedHeading}</Text>
          <Text style={styles.body}>{strings.verify.lockedBody}</Text>
          <Text style={styles.muted}>{strings.verify.lockedReassurance}</Text>
        </Blueprint>
        <View style={styles.actions}>
          <SecondaryButton label={strings.errors.seeReception} onPress={onSeeReception} testID="locked-reception" />
        </View>
      </Screen>
    );
  }

  if (state.kind === 'mismatch') {
    return (
      <Screen
        practiceName={practiceName}
        locationLine={locationLine}
        stepTag={stepTag}
        context={strings.verify.attemptOf(state.attempt, KIOSK_MAX_ATTEMPTS)}
      >
        <Blueprint accented style={styles.panel}>
          <Text style={styles.h3} testID="mismatch-heading">
            {mismatchHeading()}
          </Text>
          <Text style={styles.body} testID="mismatch-body">
            {mismatchMessage()}
          </Text>
        </Blueprint>
        <View style={styles.actions}>
          <PrimaryButton label={strings.verify.tryAgain} onPress={onRetry} size="standard" testID="verify-retry" />
          <SecondaryButton label={strings.errors.seeReception} onPress={onSeeReception} />
        </View>
      </Screen>
    );
  }

  const attempt = state.kind === 'asking' ? state.attempt : 1;

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={stepTag}
      context={strings.verify.attemptOf(attempt, KIOSK_MAX_ATTEMPTS)}
    >
      <View style={orientation === 'landscape' ? styles.twoColumn : styles.oneColumn}>
        <ScrollView contentContainerStyle={styles.form}>
          <Text style={styles.h2}>{strings.verify.heading}</Text>
          <Text style={styles.lede}>{strings.verify.lede(fields.length)}</Text>
          {startError ? <Text style={styles.error}>{strings.verify.failedToStart}</Text> : null}
          <View style={orientation === 'landscape' ? styles.fieldGrid : styles.fieldStack}>
            {fields.map((field, index) => (
              <Field
                key={field.type}
                label={field.label}
                hint={field.hint}
                value={stated[field.type] ?? ''}
                onChangeText={(next) => onChange(field.type, next)}
                testID={`identifier-${field.type}`}
                autoFocus={index === 0}
              />
            ))}
          </View>
          {incomplete ? <Text style={styles.error}>{strings.verify.incomplete}</Text> : null}
          <View style={styles.actions}>
            <PrimaryButton
              label={busy ? strings.particulars.validating : strings.verify.continueAction}
              onPress={onContinue}
              testID="verify-continue"
            />
          </View>
        </ScrollView>
        <Blueprint style={styles.annotation}>
          <Kicker label={strings.verify.annotationKicker} />
          <Text style={styles.annotationText}>{strings.verify.annotationBody}</Text>
        </Blueprint>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  twoColumn: { flex: 1, flexDirection: 'row', gap: space.xl },
  oneColumn: { flex: 1, flexDirection: 'column', gap: space.lg },
  form: { gap: space.lg, paddingRight: space.md, flexGrow: 1 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  fieldStack: { flexDirection: 'column', gap: space.lg },
  annotation: { width: 300, alignSelf: 'flex-start' },
  annotationText: { fontFamily: fonts.body, fontSize: type.footnote, color: colors.ink },
  h2: { fontFamily: fonts.heading, fontSize: type.h2, color: colors.ink },
  h3: { fontFamily: fonts.heading, fontSize: type.h3, color: colors.ink },
  lede: { fontFamily: fonts.body, fontSize: type.body, color: colors.neutral700 },
  body: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
  error: { fontFamily: fonts.bodyMedium, fontSize: type.label, color: colors.ink },
  panel: { gap: space.sm, maxWidth: 640 },
  actions: { flexDirection: 'row', gap: space.md, alignItems: 'center', flexWrap: 'wrap' },
});

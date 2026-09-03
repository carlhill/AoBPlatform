/**
 * K-2 — verification, and K-2b's mismatch and lockout states.
 *
 * THE FIELD SET IS THE SERVER'S. `identifierTypes` arrives on the waiting-list
 * response and `identifierFieldsFor` puts it through the domain's own
 * `assertValidIdentifierSet` before a single input is drawn. There is no
 * Medicare card field on this screen and no setting on this device that could
 * add one — the kiosk holds no configuration at all (REQ-VER-02).
 *
 * THE INPUTS ARE STRUCTURED; THE CONTRACT IS NOT (Carl, 3 Sep 2026). Three of
 * the six approved identifiers are composite, and each used to be one free-text
 * box: a name, a date the patient had to render as "YYYY-MM-DD", and a whole
 * address on one line. They are now family/given, three pickers, and the parts
 * of an address — and `verify-fields.ts` composes each back into the single
 * string per identifier type that the attempt endpoint has always taken. The
 * server contract is untouched.
 *
 * WHY THAT MATTERS MORE HERE THAN ON AN ORDINARY FORM: a failed attempt says
 * "some details don't match" and is not allowed to say which (REQ-SEC-07). So
 * a formatting trap on this screen is unrecoverable by design — the patient
 * cannot be told that the date was right and only the punctuation was wrong.
 * Removing the chance to mis-format is the only fix available.
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
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Blueprint, Kicker, Screen, useLayout } from '../components/Chrome';
import { GuardedButton, PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Field, PickerField } from '../components/Field';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';
import type { IdentifierField } from '../rules/identifiers';
import {
  composeIdentifier,
  dayOptions,
  EMPTY_PARTS,
  isStructured,
  monthOptions,
  readyToSubmit,
  stateOptions,
  yearOptions,
  type IdentifierParts,
} from '../rules/verify-fields';
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
  const { isWide, contentMax } = useLayout();
  const stepTag = `${strings.chrome.stepOf(1, 4)} — ${strings.chrome.stepDetails}`;

  if (state.kind === 'locked') {
    return (
      <Screen
        practiceName={practiceName}
        locationLine={locationLine}
        stepTag={strings.chrome.stepOf(1, 4)}
        context={strings.verify.lockedFooter}
        onLeave={onSeeReception}
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
        onLeave={onSeeReception}
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
        </View>
      </Screen>
    );
  }

  const attempt = state.kind === 'asking' ? state.attempt : 1;

  /*
   * ONE PANEL, TWO PLACES. Wide, it is a column beside the form. Narrow, it
   * flows INSIDE the scroller directly under the Continue button — because a
   * sibling of a `flex: 1` scroller gets pinned to the bottom of the screen,
   * which is exactly the "marooned below a sea of empty space" Carl saw. Same
   * element either way, so the two layouts cannot drift apart.
   */
  const annotation = (
    <Blueprint style={isWide ? styles.annotation : styles.annotationBelow}>
      <Kicker label={strings.verify.annotationKicker} />
      <Text style={styles.annotationText}>{strings.verify.annotationBody}</Text>
    </Blueprint>
  );

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={stepTag}
      context={strings.verify.attemptOf(attempt, KIOSK_MAX_ATTEMPTS)}
      onLeave={onSeeReception}
    >
      <View style={isWide ? styles.twoColumn : styles.oneColumn}>
        {/*
          KEYED ON THE ATTEMPT. The ceremony clears `stated` after every
          attempt, and the sub-field state that composes it lives in this form.
          Remounting on a new attempt is what keeps the two from drifting into
          the state where the boxes look full and the payload is empty.
        */}
        <VerifyForm
          key={attempt}
          fields={fields}
          stated={stated}
          isWide={isWide}
          contentMax={contentMax}
          busy={busy}
          incomplete={incomplete}
          startError={startError}
          onChange={onChange}
          onContinue={onContinue}
          below={isWide ? null : annotation}
        />
        {isWide ? annotation : null}
      </View>
    </Screen>
  );
}

/** Which parts group composes which identifier type. */
const GROUP_FOR_TYPE = {
  name: 'name',
  date_of_birth: 'dateOfBirth',
  address: 'address',
} as const;

function VerifyForm({
  fields,
  stated,
  isWide,
  contentMax,
  busy,
  incomplete,
  startError,
  onChange,
  onContinue,
  below,
}: {
  fields: readonly IdentifierField[];
  stated: Readonly<Record<string, string>>;
  isWide: boolean;
  contentMax: number;
  busy: boolean;
  incomplete: boolean;
  startError: boolean;
  onChange: (type: string, value: string) => void;
  onContinue: () => void;
  below: ReactNode;
}): ReactNode {
  const [parts, setParts] = useState<IdentifierParts>(EMPTY_PARTS);

  /**
   * Patch one group of sub-fields and push the recomposed string up. The
   * composition runs on the value being set rather than on `parts` from the
   * next render, so the string the ceremony holds is never one keystroke
   * behind the boxes.
   */
  function update<K extends keyof IdentifierParts>(group: K, patch: Partial<IdentifierParts[K]>): void {
    const next: IdentifierParts = { ...parts, [group]: { ...parts[group], ...patch } };
    setParts(next);
    for (const [type, name] of Object.entries(GROUP_FOR_TYPE)) {
      if (name !== group) continue;
      onChange(type, composeIdentifier(type, next) ?? '');
    }
  }

  const ready = readyToSubmit(fields.map((field) => field.type), parts, stated);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.form, { maxWidth: contentMax }]}>
      <Text style={styles.h2}>{strings.verify.heading}</Text>
      <Text style={styles.lede}>{strings.verify.lede(fields.length)}</Text>
      {startError ? <Text style={styles.error}>{strings.verify.failedToStart}</Text> : null}
      {/*
        THE SAME FIELD SET IN BOTH ORIENTATIONS — always. Only the number of
        columns changes: sub-fields sit two or three abreast where there is
        room and wrap where there is not. Portrait never renders fewer inputs
        than landscape, because a turned tablet must not be a different consent
        form.

        NOTHING IN HERE GROWS. Every cell is `flexBasis` + `flexGrow` on the
        HORIZONTAL axis only; no field takes a share of the leftover height.
        That is the defect Carl caught at 820x1180 — 196px of nothing between
        one input and the next — and it comes back the moment a style here
        gains a vertical `flex`.
      */}
      {fields.map((field, index) => (
        <View key={field.type} style={styles.group}>
          <Text style={styles.groupLabel}>{field.label}</Text>
          <View style={styles.row}>
            {field.type === 'name' ? (
              <>
                <Field
                  label={strings.verify.nameGiven}
                  value={parts.name.given}
                  onChangeText={(given) => update('name', { given })}
                  testID="identifier-name-given"
                  autoFocus={index === 0}
                  style={styles.pairCell}
                />
                <Field
                  label={strings.verify.nameFamily}
                  value={parts.name.family}
                  onChangeText={(family) => update('name', { family })}
                  testID="identifier-name-family"
                  style={styles.pairCell}
                />
              </>
            ) : null}

            {field.type === 'date_of_birth' ? (
              <>
                <PickerField
                  label={strings.verify.dobDay}
                  value={parts.dateOfBirth.day}
                  options={dayOptions()}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(day) => update('dateOfBirth', { day })}
                  testID="identifier-dob-day"
                  style={styles.dobDayCell}
                />
                <PickerField
                  label={strings.verify.dobMonth}
                  value={parts.dateOfBirth.month}
                  options={monthOptions()}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(month) => update('dateOfBirth', { month })}
                  testID="identifier-dob-month"
                  style={styles.dobMonthCell}
                />
                <PickerField
                  label={strings.verify.dobYear}
                  value={parts.dateOfBirth.year}
                  options={yearOptions()}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(year) => update('dateOfBirth', { year })}
                  testID="identifier-dob-year"
                  style={styles.dobYearCell}
                />
              </>
            ) : null}

            {field.type === 'address' ? (
              <>
                <Field
                  label={strings.verify.addressLine1}
                  value={parts.address.line1}
                  onChangeText={(line1) => update('address', { line1 })}
                  testID="identifier-address-line1"
                  autoFocus={index === 0}
                  style={styles.fullCell}
                />
                <Field
                  label={strings.verify.addressLine2}
                  hint={strings.verify.addressOptional}
                  value={parts.address.line2}
                  onChangeText={(line2) => update('address', { line2 })}
                  testID="identifier-address-line2"
                  style={styles.fullCell}
                />
                <Field
                  label={strings.verify.suburb}
                  value={parts.address.suburb}
                  onChangeText={(suburb) => update('address', { suburb })}
                  testID="identifier-address-suburb"
                  style={styles.addressPartCell}
                />
                <PickerField
                  label={strings.verify.addressState}
                  value={parts.address.state}
                  options={stateOptions()}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(state) => update('address', { state })}
                  testID="identifier-address-state"
                  style={styles.addressPartCell}
                />
                <Field
                  label={strings.verify.postcode}
                  value={parts.address.postcode}
                  onChangeText={(postcode) => update('address', { postcode })}
                  testID="identifier-address-postcode"
                  style={styles.postcodeCell}
                />
                {/*
                  COLLECTED, NEVER SENT. `composeAddress` leaves the country
                  out: the practice's record does not carry one, the server
                  does not compare one, and its containment rule fails on any
                  token the practice does not hold — so appending "Australia"
                  would fail every attempt. See verify-fields.ts.
                */}
                <Field
                  label={strings.verify.country}
                  value={parts.address.country}
                  onChangeText={(country) => update('address', { country })}
                  testID="identifier-address-country"
                  style={styles.countryCell}
                />
              </>
            ) : null}

            {isStructured(field.type) ? null : (
              <Field
                label={field.label}
                hint={field.hint}
                value={stated[field.type] ?? ''}
                onChangeText={(next) => onChange(field.type, next)}
                testID={`identifier-${field.type}`}
                autoFocus={index === 0}
                style={isWide ? styles.pairCell : styles.fullCell}
              />
            )}
          </View>
        </View>
      ))}
      {incomplete ? <Text style={styles.error}>{strings.verify.incomplete}</Text> : null}
      <View style={styles.actions}>
        {/*
          DISABLED UNTIL THE MANDATORY PARTS ARE THERE, and it says so rather
          than only refusing — the codebase's disabled-with-a-reason primitive.
          The refusal names no identifier, for the same reason the mismatch
          copy names none.
        */}
        <GuardedButton
          label={busy ? strings.particulars.validating : strings.verify.continueAction}
          state={ready ? { disabled: false } : { disabled: true, disabledLabel: strings.verify.continueBlocked }}
          onPress={onContinue}
          testID="verify-continue"
        />
      </View>
      {below}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  twoColumn: { flex: 1, flexDirection: 'row', gap: space.xl },
  oneColumn: { flex: 1, flexDirection: 'column', gap: space.md },
  scroll: { flex: 1 },
  /*
   * NO `flexGrow: 1` HERE EITHER. On a content container it lets the children
   * spread down the page, which is the same band-of-nothing defect one level
   * up from the fields. The step should read as one group at the top of the
   * content area, with the empty space beneath it rather than inside it.
   */
  form: { gap: space.md, paddingRight: space.xs, paddingBottom: space.lg },
  /** One identifier: its name, then its parts. `gap` only — never a vertical flex. */
  group: { gap: space.xs },
  groupLabel: { fontFamily: fonts.bodyMedium, fontSize: type.bodySmall, color: colors.ink },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  /*
   * SIZING IS HORIZONTAL ONLY. `flexGrow` shares the leftover WIDTH of a
   * wrapping row; nothing here touches height. A cell that gained `flex: 1`
   * would put a band of nothing under every input again.
   */
  fullCell: { width: '100%' },
  pairCell: { flexGrow: 3, flexBasis: 200 },
  /*
   * The three date cells add up to less than one column, so the row never
   * wraps and "Please choose" is never clipped in the day picker — which is
   * what it did at 1024x768 when the day cell was the narrow one.
   */
  dobDayCell: { flexGrow: 2, flexBasis: 130 },
  dobMonthCell: { flexGrow: 3, flexBasis: 190 },
  dobYearCell: { flexGrow: 2, flexBasis: 150 },
  addressPartCell: { flexGrow: 3, flexBasis: 180 },
  postcodeCell: { flexGrow: 1, flexBasis: 120 },
  countryCell: { flexGrow: 2, flexBasis: 160 },
  annotation: { width: 300, alignSelf: 'flex-start' },
  annotationBelow: { alignSelf: 'stretch', marginTop: space.xs },
  annotationText: { fontFamily: fonts.body, fontSize: type.footnote, color: colors.ink },
  h2: { fontFamily: fonts.heading, fontSize: type.h2, color: colors.ink, marginBottom: -space.xs },
  h3: { fontFamily: fonts.heading, fontSize: type.h3, color: colors.ink },
  lede: { fontFamily: fonts.body, fontSize: type.body, color: colors.neutral700 },
  body: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
  error: { fontFamily: fonts.bodyMedium, fontSize: type.label, color: colors.ink },
  panel: { gap: space.sm, maxWidth: 640 },
  actions: { flexDirection: 'row', gap: space.md, alignItems: 'center', flexWrap: 'wrap' },
});

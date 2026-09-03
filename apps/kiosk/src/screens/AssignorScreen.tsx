/**
 * K-5 — who is signing.
 *
 * TWO CHOICES AND NO THIRD. The patient signs for themselves, or somebody else
 * does. `assignorIsPatient` is D7 and is explicit here, as it is everywhere
 * else in the platform (CLAUDE.md §3): the branch is a control the person
 * touches, never something the code infers from a name.
 *
 * WHAT IS NOT ON THIS SCREEN. No capacity question. No control that asks a
 * staff member to judge whether the patient can consent. Not hidden behind a
 * flag, not deferred — absent (REQ-VUL-05).
 *
 * THE REFUSALS ARE NEUTRAL. A blocked assignor is told to ask reception. They
 * are not told that they matched the staff list, and the rule is not explained
 * to them — a refusal that teaches the rule teaches how to get around it
 * (REQ-VUL-04).
 *
 * THE "SOMEONE ELSE" BRANCH ENDS AT THE DESK IN THIS MVP, and that is stated
 * plainly rather than mimed. Recording a different assignor means creating an
 * `Assignor` and re-pointing the agreement at it; `POST /practices/:id/
 * assignors` exists but nothing re-points a draft, so the kiosk would have to
 * fabricate a record it cannot attach. It runs the gates — the staff block and
 * the 18+ check, which are the parts that must never be skipped — and then
 * hands over. Nobody is trapped and nobody is billed differently for it
 * (REQ-REC-04).
 */
import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Blueprint, Kicker, Screen, useOrientation } from '../components/Chrome';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Checkbox, Field } from '../components/Field';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';
import { MIN_AGE_ASSIGN_FOR_OTHER, type AssignorChoice } from '../rules/assignor';

export function AssignorScreen({
  practiceName,
  locationLine,
  patientName,
  choice,
  refusal,
  onChoose,
  onChangeOther,
  onContinue,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  patientName: string;
  choice: AssignorChoice;
  refusal: string | null;
  onChoose: (assignorIsPatient: boolean) => void;
  onChangeOther: (patch: Partial<AssignorChoice>) => void;
  onContinue: () => void;
  onSeeReception: () => void;
}): ReactNode {
  const orientation = useOrientation();
  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={`${strings.chrome.stepOf(2, 4)} — ${strings.chrome.stepSigning}`}
      context={strings.chrome.staffHelp}
    >
      <View style={orientation === 'landscape' ? styles.twoColumn : styles.oneColumn}>
        <ScrollView contentContainerStyle={styles.main}>
          <Text style={styles.h2}>{strings.assignor.heading}</Text>
          <SecondaryButton
            label={strings.assignor.self(patientName)}
            align="left"
            onPress={() => onChoose(true)}
            testID="assignor-self"
          />
          <SecondaryButton
            label={strings.assignor.other(patientName)}
            align="left"
            onPress={() => onChoose(false)}
            testID="assignor-other"
          />

          {!choice.assignorIsPatient ? (
            <Blueprint style={styles.panel}>
              <Text style={styles.panelHeading}>{strings.assignor.panelHeading}</Text>
              <View style={orientation === 'landscape' ? styles.fieldGrid : styles.fieldStack}>
                <Field
                  label={strings.assignor.otherName}
                  value={choice.otherName}
                  onChangeText={(next) => onChangeOther({ otherName: next })}
                  testID="assignor-other-name"
                />
                <Field
                  label={strings.assignor.otherRelationship}
                  value={choice.otherRelationship}
                  onChangeText={(next) => onChangeOther({ otherRelationship: next })}
                  testID="assignor-other-relationship"
                />
              </View>
              <Checkbox
                label={strings.assignor.otherAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER)}
                checked={choice.otherDeclaredOfAge}
                onToggle={() => onChangeOther({ otherDeclaredOfAge: !choice.otherDeclaredOfAge })}
                testID="assignor-other-of-age"
              />
            </Blueprint>
          ) : null}

          {refusal ? (
            <Blueprint accented style={styles.panel}>
              <Text style={styles.h3}>{strings.assignor.blockedHeading}</Text>
              <Text style={styles.body} testID="assignor-refusal">
                {refusal}
              </Text>
              <SecondaryButton label={strings.errors.seeReception} onPress={onSeeReception} />
            </Blueprint>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              label={strings.assignor.continueAction}
              onPress={onContinue}
              testID="assignor-continue"
            />
          </View>
        </ScrollView>

        <View style={styles.rail}>
          <Blueprint>
            <Kicker label={strings.assignor.railAgeKicker} />
            <Text style={styles.railText}>{strings.assignor.railAgeBody}</Text>
          </Blueprint>
          <Blueprint>
            <Kicker label={strings.assignor.railAbsentKicker} />
            <Text style={styles.railText}>{strings.assignor.railAbsentBody}</Text>
          </Blueprint>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  twoColumn: { flex: 1, flexDirection: 'row', gap: space.xl },
  oneColumn: { flex: 1, flexDirection: 'column', gap: space.lg },
  main: { gap: space.lg, flexGrow: 1 },
  rail: { width: 320, gap: space.md },
  railText: { fontFamily: fonts.body, fontSize: type.footnote, color: colors.ink },
  panel: { gap: space.md },
  panelHeading: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  fieldStack: { flexDirection: 'column', gap: space.md },
  h2: { fontFamily: fonts.heading, fontSize: type.h2, color: colors.ink },
  h3: { fontFamily: fonts.heading, fontSize: type.h3, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink },
  actions: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
});

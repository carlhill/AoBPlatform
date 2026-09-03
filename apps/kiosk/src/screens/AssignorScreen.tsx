/**
 * K-5 — who is signing.
 *
 * TWO CHOICES AND NO THIRD. The patient signs for themselves, or somebody else
 * does. `assignorIsPatient` is D7 and is explicit here, as it is everywhere
 * else in the platform (CLAUDE.md §3): the branch is a control the person
 * touches, never something the code infers from a name.
 *
 * THE CHOICE IS UNMISTAKABLE (Carl, 3 Sep 2026 live test). Tapping "I am
 * signing for myself" used to change nothing about how either button looked
 * — the tap registered, but there was no way to tell. `SecondaryButton`'s
 * `selected` prop now fills the chosen option and sets
 * `accessibilityState.selected`.
 *
 * SELF ADVANCES ON THE TAP, NO CONTINUE NEEDED (same live test — fewest taps,
 * the Tyro-terminal feel). The kiosk holds no date of birth, so self-assign is
 * never blocked from this device — `decideAssignor`'s self branch always
 * defers to the server — and there is nothing to gain by making the patient
 * find and press Continue for a choice that cannot fail here. "Someone else"
 * still reveals the form and keeps Continue, because that branch has real
 * gates to pass (the age declaration, the staff block) before it can go
 * anywhere.
 *
 * WHAT IS NOT ON THIS SCREEN. No capacity question. No control that asks a
 * staff member to judge whether the patient can consent. Not hidden behind a
 * flag, not deferred — absent (REQ-VUL-05).
 *
 * CONTINUE IS A `GuardedButton` (same live test, CLAUDE.md §6 — blocked states
 * are unreachable, not merely inert). `guard` is computed live by the
 * ceremony from `evaluateAssignorGate`, so the button is already disabled,
 * with its reason, before anybody presses it — missing details, an unticked
 * age box, or a practice-staff match all show up here as soon as they are
 * true, not only after a press finds them. The staff match additionally gets
 * the fuller explanation panel below: `blockedBody` now names the rule
 * (practice staff cannot sign for a patient) rather than pointing at
 * reception and stopping there, on the reasoning that naming the rule without
 * naming the PERSON or the match still protects what REQ-VUL-04 protects.
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
import { Blueprint, Kicker, Screen, useLayout } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import { Checkbox, Field } from '../components/Field';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';
import { MIN_AGE_ASSIGN_FOR_OTHER, type AssignorChoice, type AssignorGate } from '../rules/assignor';

export function AssignorScreen({
  practiceName,
  locationLine,
  patientName,
  choice,
  guard,
  onChoose,
  onChangeOther,
  onContinue,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  patientName: string;
  choice: AssignorChoice;
  /** Live, from `evaluateAssignorGate` — the single source of truth behind this screen's Continue and its explanation panel. */
  guard: AssignorGate;
  onChoose: (assignorIsPatient: boolean) => void;
  onChangeOther: (patch: Partial<AssignorChoice>) => void;
  onContinue: () => void;
  onSeeReception: () => void;
}): ReactNode {
  const { isWide, contentMax } = useLayout();

  /*
   * The annotation rail, in one place. Wide it is a column; narrow it flows
   * inside the scroller under the form, rather than being pinned to the foot
   * of the screen by a `flex: 1` sibling.
   */
  const rail = (
    <View style={isWide ? styles.rail : styles.railBelow}>
      <Blueprint>
        <Kicker label={strings.assignor.railAgeKicker} />
        <Text style={styles.railText}>{strings.assignor.railAgeBody}</Text>
      </Blueprint>
      <Blueprint>
        <Kicker label={strings.assignor.railAbsentKicker} />
        <Text style={styles.railText}>{strings.assignor.railAbsentBody}</Text>
      </Blueprint>
    </View>
  );

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={`${strings.chrome.stepOf(2, 4)} — ${strings.chrome.stepSigning}`}
      context={strings.chrome.staffHelp}
      onLeave={onSeeReception}
    >
      <View style={isWide ? styles.twoColumn : styles.oneColumn}>
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.main, { maxWidth: contentMax }]}>
          <Text style={styles.h2}>{strings.assignor.heading}</Text>
          <SecondaryButton
            label={strings.assignor.self(patientName)}
            align="left"
            selected={choice.assignorIsPatient}
            onPress={() => onChoose(true)}
            testID="assignor-self"
          />
          <SecondaryButton
            label={strings.assignor.other(patientName)}
            align="left"
            selected={!choice.assignorIsPatient}
            onPress={() => onChoose(false)}
            testID="assignor-other"
          />

          {!choice.assignorIsPatient ? (
            <Blueprint style={styles.panel}>
              <Text style={styles.panelHeading}>{strings.assignor.panelHeading}</Text>
              <View style={styles.fieldGrid}>
                <Field
                  label={strings.assignor.otherName}
                  value={choice.otherName}
                  onChangeText={(next) => onChangeOther({ otherName: next })}
                  testID="assignor-other-name"
                  style={isWide ? styles.gridCell : styles.stackCell}
                />
                <Field
                  label={strings.assignor.otherRelationship(patientName)}
                  value={choice.otherRelationship}
                  onChangeText={(next) => onChangeOther({ otherRelationship: next })}
                  testID="assignor-other-relationship"
                  style={isWide ? styles.gridCell : styles.stackCell}
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

          {guard.state === 'blocked' && guard.explanation ? (
            <Blueprint accented style={styles.panel}>
              <Text style={styles.h3}>{strings.assignor.blockedHeading}</Text>
              <Text style={styles.body} testID="assignor-refusal">
                {guard.explanation}
              </Text>
            </Blueprint>
          ) : null}

          <View style={styles.actions}>
            <GuardedButton
              label={strings.assignor.continueAction}
              state={
                guard.state === 'valid'
                  ? { disabled: false }
                  : {
                      disabled: true,
                      disabledLabel: strings.assignor.continueBlocked(guard.reasons.length),
                      reasons: guard.reasons,
                    }
              }
              onPress={onContinue}
              testID="assignor-continue"
            />
          </View>
          {isWide ? null : rail}
        </ScrollView>

        {isWide ? rail : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  twoColumn: { flex: 1, flexDirection: 'row', gap: space.xl },
  oneColumn: { flex: 1, flexDirection: 'column', gap: space.md },
  scroll: { flex: 1 },
  main: { gap: space.md, paddingBottom: space.lg },
  rail: { width: 320, gap: space.md },
  railBelow: { alignSelf: 'stretch', gap: space.sm },
  gridCell: { flexGrow: 1, flexBasis: 240 },
  stackCell: { width: '100%' },
  railText: { fontFamily: fonts.body, fontSize: type.footnote, color: colors.ink },
  panel: { gap: space.md },
  panelHeading: { fontFamily: fonts.heading, fontSize: 17, color: colors.ink },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  h2: { fontFamily: fonts.heading, fontSize: type.h2, color: colors.ink },
  h3: { fontFamily: fonts.heading, fontSize: type.h3, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink },
  actions: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
});

'use client';

/**
 * K-5 — who is signing.
 *
 * TWO CHOICES AND NO THIRD. The patient signs for themselves, or somebody else
 * does. `assignorIsPatient` is D7 and is explicit here, as it is everywhere
 * else in the platform (CLAUDE.md §3): the branch is a control the person
 * touches, never something the code infers from a name.
 *
 * SELF ADVANCES ON THE TAP, NO CONTINUE NEEDED (Carl, 3 Sep 2026 live test —
 * fewest taps, the Tyro-terminal feel). The kiosk holds no date of birth, so
 * self-assign is never blocked from this device — `decideAssignor`'s self
 * branch always defers to the server — and there is nothing to gain by making
 * the patient find and press Continue for a choice that cannot fail here. The
 * chosen option also FILLS and sets `aria-pressed`, because a tap that changes
 * nothing on screen reads as a tap that did not register.
 *
 * "SOMEONE ELSE" NOW REACHES THE SERVER, which is the one thing the Expo build
 * could not do. It ran the gates and then handed over to the desk, because
 * nothing re-pointed a draft at a new assignor; `POST /agreements/:id/assignor`
 * does, so this branch continues to K-3 like the other one. What it asks for is
 * exactly what reg 65CB(5) makes a self-declaration: a name, a relationship, a
 * description where the relationship needs one, the 18+ declaration, and a way
 * to send the copy.
 *
 * THE CONTACT FIELDS ARE FRAMED AS CONTACT, NEVER AS IDENTITY. A mobile number
 * is not one of the six approved identifiers (hard rule 1) and the copy above
 * them says what they are for — your copy of the agreement — rather than
 * implying they prove anything about who you are.
 *
 * WHAT IS NOT ON THIS SCREEN. No capacity question. No control that asks a
 * staff member to judge whether the patient can consent. Not hidden behind a
 * flag, not deferred — absent (REQ-VUL-05). And no authority-basis picker:
 * reg 65CB(5)'s categories are DERIVED from the relationship through versioned
 * content and sent alongside it, so the person answers in their own words and
 * the record still carries both attributes REQ-VUL-01 asks for.
 *
 * CONTINUE IS A `GuardedButton` (CLAUDE.md §6 — blocked states are
 * unreachable, not merely inert). `guard` is computed live by the ceremony
 * from `evaluateAssignorGate`, so the button is already disabled, with its
 * reason, before anybody presses it. The staff match additionally gets the
 * fuller explanation panel: it states that the name MATCHES a member of
 * practice staff — the match is name-based and can catch a namesake, so the
 * copy is a statement rather than an accusation — and it still never says
 * which name matched or how, which is the half of REQ-VUL-04 worth protecting.
 *
 * IT IS NEVER RENDERED ON A LOCKED AGREEMENT ANY MORE (Carl, 4 Sep 2026).
 *
 * It used to be, and the result is worth recording. On a locked agreement the
 * screen drew the self option, then — in the place where "Someone else is
 * signing for Riley Example" belongs — a panel explaining that who signs is
 * locked, then a Continue. Carl read the panel AS the second option, which is
 * the only sensible reading of a box sitting in an option's slot.
 *
 * The fix was not better wording. When the particulars are locked there is
 * nothing to choose, so the CEREMONY SKIPS THIS SCREEN: verification goes
 * straight to K-3, whose "Signing" line already states who signs and now
 * carries a one-line note saying it was set at reception. Back from K-3 is
 * withdrawn there for the same reason — there is nothing behind it.
 *
 * So this screen has exactly one state: two real options, self advancing on
 * the tap, "someone else" revealing a form with real gates. THE RULE IT
 * ENCODES: never render an option-shaped box that is not an option.
 *
 * This is also the shape the reception-push flow wants. A pushed agreement is
 * always locked before it reaches a device (REQ-REG-06), so the tablet will
 * never show K-5 for one.
 */

import type { ReactNode } from 'react';
import { Blueprint, Kicker, Screen } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import { Checkbox, Field, SelectField } from '../components/Field';
import {
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  MIN_AGE_ASSIGN_FOR_OTHER,
  relationshipLabel,
  relationshipNeedsFreeText,
  type AssignorChoice,
  type AssignorGate,
} from '../rules/assignor';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

/*
 * THE OPTIONS AND THEIR ORDER COME FROM THE CONTENT FILE, NOT FROM THIS
 * COMPONENT (hard rule 14). `ASSIGNOR_RELATIONSHIP_OPTIONS` is
 * `packages/domain/content/assignor-relationships.json`, validated at load;
 * adding a relationship there — or reordering them — changes this dropdown
 * with no edit here. All this file contributes is the WORDS, looked up in the
 * string table by the content file's key, because the words get translated and
 * a translated word must never move a legal mapping.
 */
const RELATIONSHIP_OPTIONS = ASSIGNOR_RELATIONSHIP_OPTIONS.map((option) => ({
  value: option.key,
  label: relationshipLabel(option.key),
}));

export function AssignorScreen({
  practiceName,
  locationLine,
  patientName,
  choice,
  guard,
  saveError,
  saving,
  onChoose,
  onChangeOther,
  onContinue,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  patientName: string;
  choice: AssignorChoice;
  /** Live, from `evaluateAssignorGate` — the single source of truth behind Continue and the explanation panel. */
  guard: AssignorGate;
  /** The server refused the change. Shown as our sentence, never its message. */
  saveError: boolean;
  saving: boolean;
  onChoose: (assignorIsPatient: boolean) => void;
  onChangeOther: (patch: Partial<AssignorChoice>) => void;
  onContinue: () => void;
  onSeeReception: () => void;
}): ReactNode {
  const rail = (
    <div className={styles.rail}>
      <Blueprint>
        <Kicker label={strings.assignor.railAgeKicker} />
        <p className={styles.railText}>{strings.assignor.railAgeBody}</p>
      </Blueprint>
      <Blueprint>
        <Kicker label={strings.assignor.railAbsentKicker} />
        <p className={styles.railText}>{strings.assignor.railAbsentBody}</p>
      </Blueprint>
    </div>
  );

  const needsDescription = relationshipNeedsFreeText(choice.relationship);

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={`${strings.chrome.stepOf(2, 4)} — ${strings.chrome.stepSigning}`}
      context={strings.chrome.staffHelp}
      onLeave={onSeeReception}
    >
      <div className={styles.twoColumn}>
        <div className={styles.main}>
          <h1 className={styles.h2}>{strings.assignor.heading}</h1>

          {/*
            SELF ADVANCES ON THE TAP. Nothing about it can fail on this device
            — the kiosk holds no date of birth, so the self-assign gate is the
            server's — and a Continue under a choice already made reads as a
            step somebody is still waiting for.
          */}
          <SecondaryButton
            label={strings.assignor.self(patientName)}
            align="left"
            selected={choice.assignorIsPatient}
            onPress={() => onChoose(true)}
            testId="assignor-self"
          />

          {/*
            BOTH OPTIONS ARE REAL OPTIONS, ALWAYS — because this screen is
            reached only when there is a genuine choice to make. A locked
            agreement never gets here; see the module note for the box that
            used to sit in this slot and read as an option.
          */}
          <SecondaryButton
            label={strings.assignor.other(patientName)}
            align="left"
            selected={!choice.assignorIsPatient}
            onPress={() => onChoose(false)}
            testId="assignor-other"
          />

          {!choice.assignorIsPatient ? (
            <Blueprint className={styles.panel}>
              <h2 className={styles.panelHeading}>{strings.assignor.panelHeading}</h2>
              <div className={styles.fieldGrid}>
                <Field
                  label={strings.assignor.otherName}
                  value={choice.otherName}
                  onChangeText={(next) => onChangeOther({ otherName: next })}
                  testId="assignor-other-name"
                  className={styles.gridCell}
                />
                {/*
                  THE PERSON IS ASKED WHAT THEY ARE, NOT WHAT THE STATUTE CALLS
                  IT (Carl, 3 Sep 2026). The legal authority basis is DERIVED
                  from this answer through versioned content and is never shown
                  — a daughter who drove her father here should not be asked
                  whether she is a "co-resident relative 18+".
                */}
                <SelectField
                  label={strings.assignor.relationship(patientName)}
                  value={choice.relationship}
                  options={RELATIONSHIP_OPTIONS}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(next) => onChangeOther({ relationship: next })}
                  testId="assignor-relationship"
                  className={styles.gridCell}
                />
              </div>

              {/*
                REVEALED BY THE ONE OPTION THE CONTENT FILE MARKS `freeText`.
                Which option that is comes from the file, not from a comparison
                written here — so a later edit that moves the free-text flag to
                a different option needs no change in this component. What is
                typed becomes the recorded relationship AND the authority note,
                because for `other_with_note` the note IS the basis.
              */}
              {needsDescription ? (
                <Field
                  label={strings.assignor.relationshipDescribeLabel}
                  value={choice.describe}
                  onChangeText={(next) => onChangeOther({ describe: next })}
                  testId="assignor-describe"
                  className={styles.fullCell}
                />
              ) : null}

              <Checkbox
                label={strings.assignor.otherAgeConfirm(MIN_AGE_ASSIGN_FOR_OTHER)}
                checked={choice.otherDeclaredOfAge}
                onToggle={() => onChangeOther({ otherDeclaredOfAge: !choice.otherDeclaredOfAge })}
                testId="assignor-other-of-age"
              />

              <div>
                <h3 className={styles.panelHeading}>{strings.assignor.contactHeading}</h3>
                <p className={styles.fieldHint}>{strings.assignor.contactHint}</p>
              </div>
              <div className={styles.fieldGrid}>
                <Field
                  label={strings.assignor.mobileLabel}
                  value={choice.mobile}
                  inputMode="tel"
                  onChangeText={(next) => onChangeOther({ mobile: next })}
                  testId="assignor-mobile"
                  className={styles.gridCell}
                />
                <Field
                  label={strings.assignor.emailLabel}
                  value={choice.email}
                  inputMode="email"
                  onChangeText={(next) => onChangeOther({ email: next })}
                  testId="assignor-email"
                  className={styles.gridCell}
                />
              </div>
            </Blueprint>
          ) : null}

          {guard.state === 'blocked' && guard.explanation ? (
            <Blueprint accented className={styles.panel}>
              <h2 className={styles.h3}>{strings.assignor.blockedHeading}</h2>
              <p className={styles.body} data-testid="assignor-refusal">
                {guard.explanation}
              </p>
            </Blueprint>
          ) : null}

          {/*
            THE SERVER REFUSED. Our sentence, never its message — a rules
            refusal names a rule and a 500 names nothing anybody at a tablet
            can use, and neither is written for a patient to read.
          */}
          {saveError ? (
            <p className={styles.error} data-testid="assignor-save-error">
              {strings.assignor.saveFailed}
            </p>
          ) : null}

          {/*
            CONTINUE BELONGS TO THE BRANCH THAT NEEDS IT, AND ONLY THAT ONE
            (Carl, 3 Sep 2026 live test — "tapping 'I am signing for myself'
            shows the selected state but a Continue is still shown and
            required").
            
            The tap DOES advance, and always did. What was wrong was the
            screen: a second control sitting under a choice that has already
            been made reads as the thing you still have to press, so a person
            waits for a step that is not there. Self needs no Continue —
            nothing about it can fail on this device — so it is not drawn. The
            "someone else" branch keeps it, because that branch has real gates
            to pass and something has to submit them.
          */}
          {!choice.assignorIsPatient ? (
            <div className={styles.actions}>
              <GuardedButton
                label={saving ? strings.particulars.validating : strings.assignor.continueAction}
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
                testId="assignor-continue"
              />
            </div>
          ) : null}
        </div>

        {rail}
      </div>
    </Screen>
  );
}

'use client';

/**
 * K-2 — verification, and K-2b's mismatch and lockout states.
 *
 * THE FIELD SET IS THE SERVER'S. `identifierTypes` arrives on the waiting-list
 * response and `identifierFieldsFor` puts it through the domain's own
 * `assertValidIdentifierSet` before a single input is drawn. There is no
 * Medicare card field on this screen and no setting on this device that could
 * add one — the kiosk holds no configuration at all (REQ-VER-02).
 *
 * THE INPUTS ARE STRUCTURED; THE CONTRACT IS NOT (Carl, 3 Sep 2026). Two of
 * the six approved identifiers are composite, and each used to be one free-text
 * box: a name, and a date the patient had to render as "YYYY-MM-DD". They are
 * now family/given and three pickers — and `verify-fields.ts` composes each
 * back into the single string per identifier type that the attempt endpoint
 * has always taken. The server contract is untouched.
 *
 * ADDRESS IS NOT ONE OF THE TWO. It is one free-text line, because a
 * server-side address-validation endpoint is coming and a split made here
 * would be redone there. It renders through the same plain-field branch as
 * gender, the record number and the IHI.
 *
 * WHY THAT MATTERS MORE HERE THAN ON AN ORDINARY FORM: a failed attempt says
 * "some details don't match" and is not allowed to say which (REQ-SEC-07). So
 * a formatting trap on this screen is unrecoverable by design — the patient
 * cannot be told that the date was right and only the punctuation was wrong.
 * Removing the chance to mis-format is the only fix available.
 *
 * A MISMATCH SAYS ONE THING, AND IT SAYS IT HERE (Carl, 3 Sep 2026 live test).
 * "Some details don't match" — never which one, never a highlighted field,
 * never "two of three". It appears INLINE, above Continue, and the screen does
 * not move: the Expo build navigated to a separate mismatch screen whose "Try
 * again" came back to an EMPTY form, so somebody who had mistyped one letter
 * of an address retyped all three identifiers. Everything entered stays on
 * screen, in component state, and Continue stays live. Only the third failure
 * leaves K-2, for the lockout, which clears the form by unmounting it.
 *
 * KEEPING THE VALUES IS NOT A BREACH OF THE ZERO-FOOTPRINT RULE. That rule is
 * about PERSISTENCE — storage, caches, cookies, a service worker, anything
 * that outlives the tab or reaches another patient. React state is neither
 * persisted nor shared, and it is dropped by the exit, by the lockout and by
 * the reset between patients.
 *
 * A LOCKOUT ROUTES TO RECEPTION AND SAYS THE APPOINTMENT IS UNAFFECTED
 * (REQ-REC-04). Nothing on this screen can stop a patient being seen.
 */

import { useState, type ReactNode } from 'react';
import { Blueprint, Kicker, Screen } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import { Field, SelectField } from '../components/Field';
import type { IdentifierField } from '../rules/identifiers';
import {
  composeIdentifier,
  dayOptions,
  EMPTY_PARTS,
  isStructured,
  monthOptions,
  readyToSubmit,
  yearOptions,
  type IdentifierParts,
} from '../rules/verify-fields';
import {
  KIOSK_MAX_ATTEMPTS,
  mismatchHeading,
  mismatchMessage,
  type VerificationState,
} from '../rules/verification';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

/** Which parts group composes which identifier type. Address is plain text — see verify-fields.ts. */
const GROUP_FOR_TYPE = {
  name: 'name',
  date_of_birth: 'dateOfBirth',
} as const;

export function VerifyScreen({
  practiceName,
  locationLine,
  fields,
  stated,
  state,
  busy,
  incomplete,
  startError,
  mismatch,
  onChange,
  onContinue,
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
  /** The last attempt did not match. Shown inline; the form keeps what was entered. */
  mismatch: boolean;
  onChange: (type: string, value: string) => void;
  onContinue: () => void;
  onSeeReception: () => void;
}): ReactNode {
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
        <Blueprint className={styles.panel}>
          <h1 className={styles.h3}>{strings.verify.lockedHeading}</h1>
          <p className={styles.body}>{strings.verify.lockedBody}</p>
          <p className={styles.muted}>{strings.verify.lockedReassurance}</p>
        </Blueprint>
        <div className={styles.actions}>
          <SecondaryButton
            label={strings.errors.seeReception}
            onPress={onSeeReception}
            testId="locked-reception"
          />
        </div>
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
      onLeave={onSeeReception}
    >
      <div className={styles.twoColumn}>
        {/*
          DELIBERATELY NOT KEYED ON THE ATTEMPT. It used to be, because the
          ceremony cleared `stated` after every attempt and the sub-field state
          that composes it lives in this form — remounting kept the two from
          drifting into "the boxes look full and the payload is empty". The
          ceremony no longer clears on a mismatch, so there is nothing to drift
          FROM, and remounting here would throw away exactly what the patient
          is being asked to check. It is still remounted on the way out: the
          lockout branch above renders a different tree entirely.
        */}
        <VerifyForm
          fields={fields}
          stated={stated}
          busy={busy}
          incomplete={incomplete}
          startError={startError}
          mismatch={mismatch}
          onChange={onChange}
          onContinue={onContinue}
        />
        <div className={styles.rail}>
          <Blueprint>
            <Kicker label={strings.verify.annotationKicker} />
            <p className={styles.railText}>{strings.verify.annotationBody}</p>
          </Blueprint>
        </div>
      </div>
    </Screen>
  );
}

function VerifyForm({
  fields,
  stated,
  busy,
  incomplete,
  startError,
  mismatch,
  onChange,
  onContinue,
}: {
  fields: readonly IdentifierField[];
  stated: Readonly<Record<string, string>>;
  busy: boolean;
  incomplete: boolean;
  startError: boolean;
  mismatch: boolean;
  onChange: (type: string, value: string) => void;
  onContinue: () => void;
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

  const ready = readyToSubmit(
    fields.map((field) => field.type),
    parts,
    stated,
  );

  return (
    <div className={styles.main}>
      <h1 className={styles.h2}>{strings.verify.heading}</h1>
      <p className={styles.lede}>{strings.verify.lede(fields.length)}</p>
      {startError ? <p className={styles.error}>{strings.verify.failedToStart}</p> : null}
      {/*
        THE SAME FIELD SET AT EVERY WIDTH — always. Only the number of columns
        changes: sub-fields sit two or three abreast where there is room and
        wrap where there is not. A narrow window never renders fewer inputs
        than a wide one, because a turned tablet must not be a different
        consent form.
      */}
      {fields.map((field, index) => (
        <div key={field.type} className={styles.group}>
          <span className={styles.groupLabel}>{field.label}</span>
          <div className={styles.row}>
            {field.type === 'name' ? (
              <>
                <Field
                  label={strings.verify.nameGiven}
                  value={parts.name.given}
                  onChangeText={(given) => update('name', { given })}
                  testId="identifier-name-given"
                  autoFocus={index === 0}
                  className={styles.pairCell}
                />
                <Field
                  label={strings.verify.nameFamily}
                  value={parts.name.family}
                  onChangeText={(family) => update('name', { family })}
                  testId="identifier-name-family"
                  className={styles.pairCell}
                />
              </>
            ) : null}

            {field.type === 'date_of_birth' ? (
              <>
                <SelectField
                  label={strings.verify.dobDay}
                  value={parts.dateOfBirth.day}
                  options={dayOptions()}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(day) => update('dateOfBirth', { day })}
                  testId="identifier-dob-day"
                  className={styles.dobDayCell}
                />
                <SelectField
                  label={strings.verify.dobMonth}
                  value={parts.dateOfBirth.month}
                  options={monthOptions()}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(month) => update('dateOfBirth', { month })}
                  testId="identifier-dob-month"
                  className={styles.dobMonthCell}
                />
                <SelectField
                  label={strings.verify.dobYear}
                  value={parts.dateOfBirth.year}
                  options={yearOptions()}
                  placeholder={strings.verify.chooseOption}
                  onValueChange={(year) => update('dateOfBirth', { year })}
                  testId="identifier-dob-year"
                  className={styles.dobYearCell}
                />
              </>
            ) : null}

            {/*
              ADDRESS AND EVERY OTHER NON-COMPOSITE IDENTIFIER go through this
              one generic branch. Nothing here composes them; the address takes
              the full width of its row because a home address reads badly
              squeezed into half a column.
            */}
            {isStructured(field.type) ? null : (
              <Field
                label={field.label}
                hint={field.hint}
                value={stated[field.type] ?? ''}
                onChangeText={(next) => onChange(field.type, next)}
                testId={`identifier-${field.type}`}
                autoFocus={index === 0}
                className={styles.fullCell}
              />
            )}
          </div>
        </div>
      ))}
      {incomplete ? <p className={styles.error}>{strings.verify.incomplete}</p> : null}
      {/*
        ONE LINE, IN PLACE, NAMING NOTHING. `role="alert"` so it is announced
        when it appears rather than silently painted — a patient using a screen
        reader gets told the attempt failed, and gets told exactly as much as
        everybody else does (REQ-SEC-07).
      */}
      {mismatch ? (
        <Blueprint accented className={styles.panel}>
          <p className={styles.error} role="alert" data-testid="mismatch-heading">
            {mismatchHeading()}
          </p>
          <p className={styles.body} data-testid="mismatch-body">
            {mismatchMessage()}
          </p>
        </Blueprint>
      ) : null}
      <div className={styles.actions}>
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
          testId="verify-continue"
        />
      </div>
    </div>
  );
}

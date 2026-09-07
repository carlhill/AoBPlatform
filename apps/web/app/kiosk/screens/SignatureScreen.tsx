'use client';

/**
 * K-4 — signing.
 *
 * THE CONTROL IS THE SAME COMPONENT AS THE GATE ELSEWHERE. `SignatureControl`
 * takes `validation` as a required prop with no default here as everywhere;
 * this screen cannot reach an enabled control except through the one union
 * member `evaluateSignatureGate` produces from a locked, validated, rendered
 * payload (REQ-REG-06).
 *
 * BOTH METHODS ARE REAL SIGNATURES (Carl, Part 6 decision 4: BOTH). Drawing on
 * glass and tapping to approve are offered one under the other, and
 * `SignatureEvent.method` records which was used. Tap-to-approve is not a
 * degraded path for a failing pad — it is there because signing on glass is
 * genuinely hard for some hands, and it is captioned as such.
 *
 * BACK RETURNS TO K-3, AND ONLY WHILE NOTHING HAS BEEN SIGNED (Carl, 3 Sep
 * 2026 live test). Once a signature is in flight or recorded the control is
 * gone: re-reading the particulars is a step somebody may want, un-signing is
 * not a thing this platform does. Like every Back on this device it calls
 * nothing.
 *
 * NO PRACTITIONER SIGNATURE FIELD (rule 3, abolished 1 July 2026) and no
 * amount (rule 4). There is one signature on this screen and it belongs to the
 * assignor.
 *
 * AND IT SAYS WHOSE (Carl, 7 Sep 2026, from testing the pushed flow: "did not
 * ask who is signing"). K-3's "Signing" row is one line inside a document
 * somebody is reading; this screen said nothing at all, so the person holding
 * the pen was never told whose signature this is.
 *
 * IT STATES, IT DOES NOT ASK. D7 is a LOCKED PARTICULAR by the time this screen
 * draws — settled at reception before the push, validated and locked on the
 * server (hard rule 2, REQ-REG-06) — and the tablet has never offered a field
 * that could move it. Adding a question here would be a tablet editing a
 * particular of a contract in a waiting room, which is exactly what K-3 has no
 * field for. Changing it is reception's, by correct → supersede.
 *
 * SO THE ONLY THING UNDER IT IS THE WAY OUT. "If this is not right, do not sign
 * — see reception", and the same See reception action every other screen
 * carries. Nothing about the appointment moves either way (REQ-REC-04, hard
 * rule 8).
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen } from '../components/Chrome';
import { SecondaryButton } from '../components/Buttons';
import { SignaturePad, type SignaturePadHandle } from '../components/SignaturePad';
import { SignatureControl } from '../components/SignatureControl';
import type { SignatureValidation } from '../rules/signature-gate';
import { relationshipLabel } from '../rules/assignor';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function SignatureScreen({
  practiceName,
  locationLine,
  heading,
  patientName,
  assignorIsPatient,
  assignorName,
  assignorRelationship,
  validation,
  padRef,
  inkPresent,
  submitting,
  error,
  onInkChange,
  onClear,
  onSignDrawn,
  onSignTap,
  onBack,
  sessionId,
  patientId,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  /**
   * SAME HEADING AS K-3, CARRIED FORWARD (Carl, 4 Sep 2026 copy follow-up).
   * Reading and signing are one act about one agreement — Ceremony.tsx looks
   * this up once from `strings.particulars.headingByAgreementType`, which is
   * why it arrives here as plain text rather than as an agreement type this
   * screen would have to look up itself.
   */
  heading: string;
  /**
   * WHO THIS AGREEMENT IS ABOUT, AND WHO IS PUTTING A MARK ON IT.
   *
   * ALL FOUR ARRIVE FROM THE SAME PLACE K-3 READ THEM FROM (`ParticularsView`,
   * built once in `Ceremony.tsx` from the locked particulars and the pushed
   * session). This screen looks nothing up: two screens reading one object is
   * what stops the reading step and the signing step from naming two different
   * parties.
   *
   * `assignorIsPatient` IS THE DISCRIMINATOR AND IS NEVER INFERRED from whether
   * a name happens to be present (CLAUDE.md §3, D7).
   */
  patientName: string;
  assignorIsPatient: boolean;
  assignorName: string | null;
  /**
   * The relationship AS THE RECORD CARRIES IT — already a display word on
   * anything written since the assignor list became content. Passed through
   * `relationshipLabel` below so a key-shaped value from an older record still
   * reads as a word rather than as `family_member`.
   */
  assignorRelationship: string | null;
  validation: SignatureValidation;
  padRef: { current: SignaturePadHandle | null };
  inkPresent: boolean;
  submitting: boolean;
  error: string | null;
  onInkChange: (hasInk: boolean) => void;
  onClear: () => void;
  onSignDrawn: () => void;
  onSignTap: () => void;
  /** K-3. Offered only while nothing has been signed; navigation, never a mutation. */
  onBack: () => void;
  /** The pushed session's own id — an audit/testing aid in the footer. See `Chrome.tsx`'s `Screen`. */
  sessionId?: string | null;
  /**
   * The patient's own AoBPlatform id, on a PUSHED session only — the walk-up
   * screens know nobody yet and pass nothing. See `Chrome.tsx`'s `Screen`.
   */
  patientId?: string | null;
  onSeeReception: () => void;
}): ReactNode {
  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.stepOf(4, 4)}
      context={strings.signature.footer}
      sessionId={sessionId}
      patientId={patientId}
      onLeave={onSeeReception}
    >
      <div className={styles.stack}>
        <h1 className={styles.h2} data-testid="signature-heading">
          {heading}
        </h1>

        {/*
          WHO IS SIGNING, ABOVE THE PAD AND BEFORE THE BANNER. It is the first
          thing on the screen after the heading because it is the thing the
          person holding the tablet has to agree with before they touch the
          glass — and because a statement placed under a signature pad is a
          statement read after the fact.
        */}
        <div className={styles.whoIsSigning}>
          <p className={styles.whoIsSigningLine} data-testid="signature-who">
            {assignorIsPatient
              ? strings.signature.signingByPatient(patientName)
              : assignorRelationship
                ? strings.signature.signingByOther(
                    assignorName ?? '',
                    patientName,
                    relationshipLabel(assignorRelationship),
                  )
                : strings.signature.signingByOtherUnstated(assignorName ?? '', patientName)}
          </p>
          <p className={styles.muted} data-testid="signature-who-wrong">
            {strings.signature.whoNotRight}
          </p>
          <SecondaryButton
            label={strings.errors.seeReception}
            onPress={onSeeReception}
            testId="signature-who-see-reception"
          />
        </div>
        {validation.state === 'valid' ? (
          <Blueprint accented className={styles.banner}>
            <p className={styles.body} data-testid="validated-banner">
              {strings.signature.validatedBanner}
            </p>
          </Blueprint>
        ) : null}

        <SignaturePad handleRef={padRef} onInkChange={onInkChange} />

        {error ? <p className={styles.error}>{strings.signature.failed}</p> : null}

        <div className={styles.signRow}>
          {/*
            BACK DISAPPEARS THE MOMENT A SIGNATURE IS IN FLIGHT. A control that
            looks like it could undo one would be a lie about what this
            platform does.
          */}
          {submitting ? null : (
            <SecondaryButton label={strings.chrome.backAction} onPress={onBack} testId="signature-back" />
          )}
          <SecondaryButton label={strings.signature.clear} onPress={onClear} testId="signature-clear" />
          <div className={styles.grow}>
            <SignatureControl
              validation={validation}
              inkPresent={inkPresent}
              submitting={submitting}
              onSign={onSignDrawn}
            />
          </div>
        </div>

        <div className={styles.tapRow}>
          <p className={styles.muted}>{strings.signature.tapToApprove}</p>
          <div className={styles.grow}>
            {/*
              The same required-prop control, with ink treated as present
              because a tap IS the mark. It still cannot enable from an invalid
              payload — the gate is the same one.
            */}
            <SignatureControl
              validation={validation}
              inkPresent
              submitting={submitting}
              onSign={onSignTap}
              label={strings.signature.tapToApproveAction}
              testId="sign-control-tap"
            />
          </div>
        </div>
        <p className={styles.muted}>{strings.signature.tapToApproveHint}</p>
        <p className={styles.muted}>{strings.signature.binding}</p>
      </div>
    </Screen>
  );
}

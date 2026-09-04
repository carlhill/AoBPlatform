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
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen } from '../components/Chrome';
import { SecondaryButton } from '../components/Buttons';
import { SignaturePad, type SignaturePadHandle } from '../components/SignaturePad';
import { SignatureControl } from '../components/SignatureControl';
import type { SignatureValidation } from '../rules/signature-gate';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function SignatureScreen({
  practiceName,
  locationLine,
  heading,
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
  onSeeReception: () => void;
}): ReactNode {
  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.stepOf(4, 4)}
      context={strings.signature.footer}
      onLeave={onSeeReception}
    >
      <div className={styles.stack}>
        <h1 className={styles.h2} data-testid="signature-heading">
          {heading}
        </h1>
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

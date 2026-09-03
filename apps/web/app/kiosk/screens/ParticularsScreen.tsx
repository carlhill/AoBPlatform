'use client';

/**
 * K-3 — the locked particulars, and the screen the REQ-REG-06 rule is really
 * about.
 *
 * THE ARTEFACT IS THE SERVER'S. Nothing here composes a document: the kiosk
 * asks `POST /agreements/:id/particulars` to assemble the payload from the
 * platform's own records, validate it against the s 65C rule set, render it
 * and hash it — one deterministic render path (rule 13) — and then displays
 * what came back. A field the server did not send is not drawn.
 *
 * THIS SCREEN OFFERS THE PATIENT NO FIELD AT ALL (Carl, 3 Sep 2026 — this
 * supersedes the Expo build's staff-entry box, and the select that was
 * proposed to replace it).
 *
 * The box that used to sit here let anybody standing at the tablet type the
 * Basic Service Description — a validated particular of a contract — into a
 * patient-facing screen in a waiting room. It was matched exactly and
 * case-sensitively against a mapping nobody could see, so the honest outcomes
 * were a refusal that made no sense or a particular somebody had guessed. D6a
 * comes from the PMS appointment type through the practice's versioned mapping
 * (CONSULTATION-CAPTURE-PLAN §2.4). It does not come from the tablet.
 *
 * SO K-3 HAS EXACTLY TWO STATES IT CAN BE IN:
 *   validating — the lock round trip is in flight. The primary is disabled.
 *   valid      — particulars locked, rule-set and mapping versions recorded,
 *                artefact hashed. The primary is live.
 * Anything else — a rules refusal, a 500, an unreachable core — is not a state
 * of this screen: the ceremony hands over instead, stating the situation and
 * changing nothing. Staff fix it on a STAFF surface, where the mapping, the
 * booking and the audit trail are. The disabled fallback below exists only so
 * that a `blocked` gate arriving here through some future path is inert rather
 * than signable; it still offers no field.
 *
 * ONE PRIMARY, AND IT IS "CONTINUE TO SIGN". The Expo build drew a disabled
 * signature control here as well, so the screen had two primaries and the
 * patient could reasonably think they had signed on the reading step. Reading
 * is a step; signing is the next one.
 *
 * BACK RETURNS TO K-5 (Carl, 3 Sep 2026 live test). It is NAVIGATION, not the
 * way out: it calls nothing, changes no agreement, and sits beside the primary
 * rather than in the header where "See reception" lives.
 *
 * NO DOLLAR AMOUNT AND NO PRACTITIONER SIGNATURE FIELD appear anywhere on this
 * screen (rules 3 and 4); the three tags along the bottom say so out loud,
 * because a reviewer standing at the tablet should be able to see the rule
 * being kept rather than take it on trust.
 */

import type { ReactNode } from 'react';
import { Blueprint, Kicker, Screen, Tag } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import { shortHash } from '../components/SignatureControl';
import type { SignatureValidation } from '../rules/signature-gate';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export interface ParticularsView {
  readonly patientName: string;
  readonly providerName: string | null;
  readonly providerAddress: string | null;
  readonly serviceDate: string | null;
  readonly agreementDate: string | null;
  readonly basicServiceDescription: string | null;
  readonly assignorIsPatient: boolean;
  readonly assignorName: string | null;
  readonly assignorRelationship: string | null;
  readonly ruleSetVersion: string | null;
  readonly mappingVersion: string | null;
  readonly artefactHash: string | null;
}

export function ParticularsScreen({
  practiceName,
  locationLine,
  view,
  validation,
  onContinue,
  onBack,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  view: ParticularsView;
  validation: SignatureValidation;
  onContinue: () => void;
  /** K-5. Navigation, never a mutation — see the module note. */
  onBack: () => void;
  onSeeReception: () => void;
}): ReactNode {
  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.stepOf(3, 4)}
      context={strings.particulars.footer}
      onLeave={onSeeReception}
    >
      <div className={styles.twoColumn}>
        <Blueprint className={styles.document}>
          <div className={styles.documentHeader}>
            <h1 className={styles.documentTitle}>{strings.particulars.documentTitle}</h1>
            {view.ruleSetVersion && view.mappingVersion ? (
              <p className={styles.versions} data-testid="versions">
                {strings.particulars.versions(view.ruleSetVersion, view.mappingVersion)}
              </p>
            ) : null}
          </div>
          <div className={styles.grid}>
            <Row label={strings.particulars.patient} value={view.patientName} />
            <Row label={strings.particulars.provider} value={view.providerName} />
            <Row label={strings.particulars.placeOfPractice} value={view.providerAddress} />
            <Row label={strings.particulars.serviceDate} value={view.serviceDate} />
            <Row label={strings.particulars.agreementDate} value={view.agreementDate} />
            <Row label={strings.particulars.service} value={view.basicServiceDescription} />
            <Row
              label={strings.particulars.assignor}
              value={
                view.assignorIsPatient
                  ? strings.particulars.assignorIsPatient
                  : strings.particulars.assignorIsOther(
                      view.assignorName ?? '',
                      view.assignorRelationship ?? '',
                    )
              }
            />
            <p className={styles.consent}>{strings.particulars.consentText}</p>
          </div>
          <div className={styles.tags}>
            <Tag label={strings.particulars.tagNoAmount} />
            <Tag label={strings.particulars.tagNoProviderSignature} />
            <Tag label={strings.particulars.tagHashBeforeSigning} />
          </div>
        </Blueprint>

        <div className={styles.rail}>
          {validation.state === 'valid' ? (
            <Blueprint>
              <Kicker label={strings.particulars.validatedHeading} />
              <p className={styles.railText}>{strings.particulars.validatedBody}</p>
              <p className={styles.hash} data-testid="artefact-hash">
                {strings.particulars.hashLine(shortHash(validation.artefactHash))}
              </p>
            </Blueprint>
          ) : (
            /*
             * WAITING, OR — defensively — INERT. There is nothing to do here
             * and nothing to fill in: a refusal has already sent the ceremony
             * to the hand-over screen, and if one ever reaches this branch the
             * right answer is still not to hand the patient a form.
             */
            <Blueprint>
              <Kicker label={strings.particulars.validating} />
              <p className={styles.railText}>{strings.particulars.needsReceptionBody}</p>
            </Blueprint>
          )}

          {/*
            ONE PRIMARY. Back sits to its left and is a secondary — navigation,
            not the way out, which lives in the header and looks like neither.
          */}
          <div className={styles.actions}>
            <SecondaryButton label={strings.chrome.backAction} onPress={onBack} testId="particulars-back" />
            <div className={styles.grow}>
              <GuardedButton
                label={strings.particulars.continueToSign}
                state={
                  validation.state === 'valid'
                    ? { disabled: false }
                    : { disabled: true, disabledLabel: strings.particulars.continueNotReady }
                }
                onPress={onContinue}
                testId="continue-to-sign"
              />
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string | null }): ReactNode {
  if (!value) return null;
  return (
    <div className={styles.docRow}>
      <span className={styles.docRowLabel}>{label}</span>
      <span className={styles.docRowValue}>{value}</span>
    </div>
  );
}

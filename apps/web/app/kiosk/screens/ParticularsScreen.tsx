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
 * BACK RETURNS TO WHATEVER IS ACTUALLY BEHIND THIS SCREEN (Carl, 3 Sep 2026
 * live test; narrowed 4 Sep; widened again 4 Sep). It is NAVIGATION, not the
 * way out: it calls nothing, changes no agreement, and sits beside the primary
 * rather than in the header where "See reception" lives.
 *
 * On a LOCKED WALK-UP agreement the ceremony skips K-5 entirely — there is
 * nothing to choose — so `onBack` is not passed and the control is not drawn.
 * On the PUSHED path there IS something behind it, K-P1 "Please check your
 * details", and the ticks are held in the ceremony's state so returning costs
 * nobody a re-tick. This screen does not know or care which: it draws the
 * control when it is given a handler, which is what keeps one Back rather than
 * two.
 *
 * WHO SIGNS IS STATED HERE INSTEAD. The "Signing" line already says it, and on
 * a locked agreement a one-line note under it says where it was decided and
 * who can change it. That is where K-5's locked panel went, and one line under
 * an existing statement cannot be mistaken for an option (Carl, 4 Sep 2026).
 *
 * NO DOLLAR AMOUNT AND NO PRACTITIONER SIGNATURE FIELD appear anywhere on this
 * screen (rules 3 and 4); the three tags along the bottom say so out loud,
 * because a reviewer standing at the tablet should be able to see the rule
 * being kept rather than take it on trust.
 *
 * THE "READY TO SIGN" PANEL IS NOT ONE OF THOSE (Carl, 4 September 2026). Its
 * words are about the render — locked particulars, a voided hash, a SHA-256 —
 * and beside a document a patient is being asked to read they are a
 * developer's notes on a patient's screen. It renders on a TEST device only,
 * unchanged, because that is exactly what somebody demonstrating rule 13
 * wants; on every tablet a practice uses the document takes the width and the
 * same one primary sits under it.
 */

import type { ReactNode } from 'react';
import type { AgreementType } from '@aobplatform/domain';
import { Blueprint, Kicker, Screen, Tag } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import { shortHash } from '../components/SignatureControl';
import type { SignatureValidation } from '../rules/signature-gate';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export interface ParticularsView {
  /** Drives the type-specific heading (`strings.particulars.headingByAgreementType`), carried onto K-4 too. */
  readonly agreementType: AgreementType;
  readonly patientName: string;
  readonly providerName: string | null;
  readonly providerAddress: string | null;
  readonly serviceDate: string | null;
  readonly agreementDate: string | null;
  readonly basicServiceDescription: string | null;
  readonly assignorIsPatient: boolean;
  readonly assignorName: string | null;
  readonly assignorRelationship: string | null;
  /**
   * Who signs was decided before the tablet could offer a choice — at
   * reception, or by the staff-side lock. Draws the one-line note under the
   * "Signing" row, and is the same fact that made the ceremony skip K-5.
   */
  readonly particularsLocked: boolean;
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
  onDeclineEnduring,
  blueprintPanels = false,
  sessionId,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  view: ParticularsView;
  validation: SignatureValidation;
  onContinue: () => void;
  /**
   * "I'D RATHER AGREE EACH VISIT" — the ongoing agreement's quiet second
   * option (Carl, 4 Sep 2026; GA-PLAN B5).
   *
   * DRAWN ONLY WHEN IT IS GIVEN, AND ONLY ON AN ONGOING AGREEMENT, on exactly
   * the reasoning the Back control follows above: a screen draws a control
   * when it is handed a handler, and there is no episodic equivalent to
   * decline — declining "this visit" is what "See reception" already is.
   *
   * IT IS NOT A REFUSAL OF BULK BILLING and the copy says so. The patient is
   * offered an agreement for today's visit instead, and nothing about their
   * appointment moves (hard rule 8, REQ-REC-04).
   */
  onDeclineEnduring?: () => void;
  /**
   * K-5. Navigation, never a mutation — see the module note. OMITTED on a
   * locked agreement, because K-5 was skipped and there is nothing behind it.
   */
  onBack?: () => void;
  /**
   * THE "READY TO SIGN" PANEL IS DEVELOPER-FACING (Carl, 4 Sep 2026). Its
   * words are about the render — locked particulars, a voided hash, a SHA-256
   * — and they sit beside a document a patient is being asked to read. It
   * renders on a TEST device only, the same flag that banners the waiting
   * list, and is unchanged there: it is exactly what somebody demonstrating
   * rule 13 wants on the screen.
   *
   * WHAT NEVER MOVES IS CONTINUE. The primary and Back live in this column
   * too, so hiding the panel hides the panel — never the way forward. On an
   * ordinary tablet the document takes the full width and the actions sit
   * under it.
   */
  blueprintPanels?: boolean;
  /** The pushed session's own id — an audit/testing aid in the footer. See `Chrome.tsx`'s `Screen`. */
  sessionId?: string | null;
  onSeeReception: () => void;
}): ReactNode {
  /*
   * ONE PRIMARY, WHEREVER THE COLUMN ENDS UP. Composed once and placed either
   * in the rail (test device) or under the document (every other tablet), so
   * the two layouts cannot drift into offering different controls.
   */
  /**
   * ONE READING OF THE TYPE, USED TWICE. The coverage explanation and the
   * decline both belong to an ONGOING agreement and to nothing else, and a
   * component that asked the question twice would eventually answer it
   * differently in the two places.
   */
  const isEnduring = view.agreementType === 'enduring';

  const actions = (
    <div className={styles.actions}>
      {onBack ? (
        <SecondaryButton label={strings.chrome.backAction} onPress={onBack} testId="particulars-back" />
      ) : null}
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
      {/*
        AFTER THE PRIMARY, NEVER BEFORE IT. Signing is what this screen is for;
        the alternative is real and is offered, and it does not compete for the
        eye of somebody who already knows what they want.
      */}
      {isEnduring && onDeclineEnduring ? (
        <SecondaryButton
          label={strings.particulars.enduringDeclineAction}
          onPress={onDeclineEnduring}
          testId="decline-enduring"
        />
      ) : null}
    </div>
  );
  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.stepOf(3, 4)}
      context={strings.particulars.footer}
      sessionId={sessionId}
      onLeave={onSeeReception}
    >
      <div className={blueprintPanels ? styles.twoColumn : styles.oneColumn}>
        <Blueprint className={styles.document}>
          <div className={styles.documentHeader}>
            <h1 className={styles.documentTitle} data-testid="particulars-heading">
              {strings.particulars.headingByAgreementType[view.agreementType]}
            </h1>
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
            {/*
              ONE LINE, UNDER A STATEMENT THAT IS ALREADY BEING MADE. K-5 is
              skipped on a locked agreement, so this is where the fact lands —
              and it points at a person rather than at a control, because there
              is nothing here for the patient to do (Carl, 4 Sep 2026).
            */}
            {view.particularsLocked ? (
              <p className={styles.fieldHint} data-testid="assignor-locked-note">
                {strings.particulars.assignorLockedNote}
              </p>
            ) : null}
            {/*
              WHAT AN ONGOING AGREEMENT ACTUALLY COVERS (Carl, 4 Sep 2026;
              REQ-PORT-03's plain-language explanation, at the moment it is
              being agreed rather than afterwards).

              ABOVE THE CONSENT SENTENCE, because it explains the thing the
              sentence assigns. Every line is a documented fact -- the scope
              and its open end (REQ-END-06a), how either party ends it and
              when that takes effect (REQ-END-06), and that it is with ONE
              provider and not the practice (REQ-END-01, hard rule 6).

              NO AMOUNT ANYWHERE IN IT (hard rule 4). There is no field here
              for one and no sentence that implies one.
            */}
            {isEnduring ? (
              <div className={styles.grid} data-testid="enduring-coverage">
                <span className={styles.docRowLabel}>{strings.particulars.enduringCoverageHeading}</span>
                {strings.particulars.enduringCoverage.map((line) => (
                  <p key={line} className={styles.docRowValue}>
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
            <p className={styles.consent}>{strings.particulars.consentText}</p>
          </div>
          <div className={styles.tags}>
            <Tag label={strings.particulars.tagNoAmount} />
            <Tag label={strings.particulars.tagNoProviderSignature} />
            <Tag label={strings.particulars.tagHashBeforeSigning} />
          </div>
        </Blueprint>

        {blueprintPanels ? (
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
              ONE PRIMARY. Back sits to its left and is a secondary —
              navigation, not the way out, which lives in the header and looks
              like neither.
            */}
            {actions}
          </div>
        ) : (
          /*
            NO RAIL ON AN ORDINARY TABLET. The document has the width, and the
            same one primary sits under it — a patient loses a developer's
            annotation and nothing else.
          */
          <div className={styles.railBelow}>{actions}</div>
        )}
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

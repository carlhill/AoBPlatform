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
 * THE WORDS ARE THE SERVER'S, AND THEY ARE THE PDF'S (Carl, 5 Sep 2026; W1).
 * The statements the patient ticks are not written in this file and not in the
 * string table: they come back from the lock as part of the rendered document,
 * which is the same object the PDF is drawn from and hashed against. One
 * source of truth, rendered twice. A sentence written here would be a second
 * copy of the operative words of a contract, free to drift from the one that
 * was signed.
 *
 * AND THE TICKS ARE NOT THE PARTICULARS. Rule 2 is already satisfied before
 * this screen draws: the payload validated and locked on the server, and the
 * signature control can only enable from that. The ticks are the separate
 * thing the regulation actually wants — the assignor's affirmations — and they
 * gate CONTINUE rather than the lock. Their KEYS travel to the signature
 * event; the server refuses a signature missing any of them.
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
 *
 * AND SINCE 27 SEPTEMBER 2026 THE DOCUMENT CAN BE THE PRACTICE'S OWN DB4
 * (D-2026-09-27-01: *"patient sees the db4 with the cost on it"*). Carl looked
 * at this screen mid-ceremony and said it did not look like the form he had
 * shared — and it did not: the tablet drew the agreement's ceremony while the
 * Signed-DB4, our reproduction of the practice's paper, was rendered only after
 * signing and had no screen anywhere. The patient signed one presentation and
 * the chart folder received another.
 *
 * SO WHERE THE LOCK RETURNS A `Db4FormView`, THIS SCREEN DRAWS THE FORM: the
 * heading lines as printed, the servicing location, the patient block, the
 * providers, the service rows WITH the amount PracSoft printed, the privacy
 * notice and the in-scope assignment statements. Everything in it is the
 * server's, exactly as the statements already were — this file supplies labels,
 * column headings and nothing that is operative.
 *
 * IT IS ADDITIVE, AND "ADDITIVE" MEANS THE PATH DOES NOT RUN (D-2026-09-27-02;
 * Carl: *"We may still want a version that we have for a small practice that
 * does not have a PMS system. So keep the current build."*). A session with no
 * DB4 Print Record carries no block, so the ternary below takes the branch it
 * always took and the rows are the rows of this file before the feature
 * existed. That is asserted by name in `db4-form.test.tsx`, and more usefully
 * by the whole existing kiosk suite still passing untouched.
 *
 * THE FORM'S BLOCKS REPLACE THE ROWS THAT REPEAT THEM, and only those. Patient,
 * provider, place of practice, date of service and the service description are
 * all printed on the form, so drawing our own rows for them beside it would
 * show the patient the same five facts twice and invite them to compare two
 * renderings of one source. The agreement's own facts stay: the date of THIS
 * agreement, who is signing, and the tick boxes, which are the ceremony rather
 * than the form.
 *
 * THE AMOUNT IS DISPLAY ONLY, AND STRUCTURALLY SO. It is a string on a view
 * model that `composeSignRequest` cannot reach: the sign body is composed from
 * a method, a capture id, the drawing and the statement KEYS, and there is no
 * field on `SignRequestBody` an amount could occupy. Hard rule 4 as narrowed by
 * D-2026-09-14-02 — AoB never originates or computes an amount; it may
 * reproduce the one the practice's billing software printed — so it is rendered
 * as the string it arrived as and never parsed, reformatted, summed or totalled.
 *
 * AND THE THIRD TAG IS SWAPPED, BECAUSE IT WOULD OTHERWISE BE A LIE. "No amount
 * shown" beside a column of amounts would teach a reviewer that the tags are
 * decoration. Where an amount is on screen the tag states what is actually true
 * — that the figure is the practice's own and is never calculated by us. The
 * other two are unchanged and still true, and a print record carrying no
 * amounts keeps "No amount shown", which is also still true.
 *
 * NO SIGNATURE REGION IS REPRODUCED, of either kind. The practice's paper has a
 * practitioner signature box on it; hard rule 3 abolished that field on 1 July
 * 2026 and this screen draws none — `Db4FormView` carries no signature region
 * at all, which is the contract agreeing with the rule rather than this file
 * filtering for it. The assignor's own mark is taken on K-4, where it belongs.
 */

import type { ReactNode } from 'react';
import type { AgreementType } from '@aobplatform/domain';
import type { Db4FormView } from '@aobplatform/contracts';
import { Blueprint, Kicker, Screen, Tag, CeremonyHeading } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import { Checkbox } from '../components/Field';
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
  /**
   * D6b — THE MBS ITEM NUMBER(S), POST-AGREEMENTS ONLY (REQ-REG-01; s 65C(4)
   * table item 6). Carl, 11 Sep 2026, the post-service second push.
   *
   * EMPTY ON A PRE-AGREEMENT, and that is the discriminator rather than a flag:
   * D6a is "pre-agreements only" and D6b is "post-agreements only", so the two
   * rows are never both drawn and neither is ever drawn blank. A field the
   * server did not send is not drawn — this screen's own rule, unchanged.
   *
   * NO AMOUNT ANYWHERE NEAR IT (hard rule 4, REQ-REG-04). An invoice has a
   * figure on it; an assignment of benefit does not, and there is no field for
   * one on this type.
   */
  readonly mbsItemNumbers: readonly string[];
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
  /**
   * THE AFFIRMATIONS, FROM THE RENDERED DOCUMENT. Empty until the lock
   * answers, and empty forever on an agreement locked before templates
   * existed — in which case there is nothing to tick and Continue is gated
   * only by the signature gate, exactly as it was.
   */
  readonly statements?: readonly { readonly key: string; readonly text: string }[];
  /** Which wording produced them. Shown beside the rule-set version. */
  readonly templateVersion?: string | null;
  /**
   * THE PRACTICE'S OWN DB4, WHERE THERE IS ONE (D-2026-09-27-01).
   *
   * ABSENT ON EVERY SESSION THAT DID NOT COME FROM A DB4 PRINT RECORD, which is
   * every session at a practice with no PMS — and the absence is the feature,
   * not a fallback (D-2026-09-27-02). It is the same discriminator the rest of
   * this file already uses: a field the server did not send is not drawn.
   *
   * MASKED BEFORE IT ARRIVED. There is no unmasked Medicare number on this
   * type, so there is none in this component, none in the React tree and none
   * in the payload that reached the tablet (hard rule 1, and the reasoning in
   * `packages/contracts/src/db4-form-view.ts`). Nothing here logs any of it.
   */
  readonly db4Form?: Db4FormView | null;
}

export function ParticularsScreen({
  practiceName,
  locationLine,
  view,
  validation,
  affirmed = [],
  onToggleAffirmation,
  onContinue,
  onBack,
  onDeclineEnduring,
  blueprintPanels = false,
  sessionId,
  patientId,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  view: ParticularsView;
  validation: SignatureValidation;
  /** The statement keys ticked so far. Held by the ceremony so Back costs no re-tick. */
  affirmed?: readonly string[];
  /**
   * DRAWN ONLY WHEN IT IS GIVEN, on the reasoning this file already applies to
   * Back and to the enduring decline: a screen draws a control when it is
   * handed a handler.
   *
   * WITHOUT ONE THE SCREEN IS EXACTLY WHAT IT WAS — the single consent
   * sentence, no boxes, Continue gated only by the signature gate. That is the
   * right behaviour for an agreement locked before the wording became content,
   * and it is SAFE for any caller that forgets, because the server refuses a
   * signature that does not carry every statement key of the template the
   * agreement was rendered from. The tablet's gate is a courtesy; the refusal
   * is the rule.
   */
  onToggleAffirmation?: (key: string) => void;
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
  /**
   * The patient's own AoBPlatform id, on a PUSHED session only — the walk-up
   * screens know nobody yet and pass nothing. See `Chrome.tsx`'s `Screen`.
   */
  patientId?: string | null;
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

  /**
   * EVERY STATEMENT, OR CONTINUE STAYS SHUT. The count is in the disabled
   * label rather than only in a message, because a control that refuses
   * without saying how many things are outstanding is the fault CLAUDE.md §7
   * names — a shortcut to the answer, not a direction to a screen.
   *
   * THE SERVER HOLDS THE SAME LINE. This is markup; `POST /agreements/:id/sign`
   * refuses a signature that does not carry every key, so a client that
   * skipped this cannot record one.
   */
  const statements = onToggleAffirmation ? (view.statements ?? []) : [];
  const outstanding = statements.filter((statement) => !affirmed.includes(statement.key)).length;
  const readyToSign = validation.state === 'valid' && outstanding === 0;

  /**
   * ONE READING OF "IS THERE A PRINT RECORD", USED TWICE — for the document and
   * for the tag under it, which must agree with each other or the tag is the
   * lie it was just changed to stop being (D-2026-09-27-01).
   */
  const db4 = view.db4Form ?? null;
  /*
   * WHETHER AN AMOUNT IS ACTUALLY ON THE SCREEN, rather than whether a print
   * record exists. A DB4 whose rows carry no `benefitAssigned` shows no amount,
   * and "No amount shown" is still the true tag for it. `.some` on a string
   * that is present and non-empty — nothing here parses it (hard rule 4).
   */
  const showsAnAmount = (db4?.services ?? []).some(
    (service) => (service.benefitAssigned ?? '').trim().length > 0,
  );

  const actions = (
    <div className={styles.actions}>
      {onBack ? (
        <SecondaryButton label={strings.chrome.backAction} onPress={onBack} testId="particulars-back" />
      ) : null}
      <div className={styles.grow}>
        <GuardedButton
          label={strings.particulars.continueToSign}
          state={
            readyToSign
              ? { disabled: false }
              : {
                  disabled: true,
                  disabledLabel:
                    validation.state === 'valid'
                      ? strings.particulars.continueNotAffirmed(outstanding)
                      : strings.particulars.continueNotReady,
                }
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
      patientId={patientId}
      onLeave={onSeeReception}
    >
      <div className={blueprintPanels ? styles.twoColumn : styles.oneColumn}>
        <Blueprint className={styles.document}>
          <div className={styles.documentHeader}>
            {/*
              THE CEREMONY'S OWN TWO LINES, HERE TOO (Carl, 7 Sep 2026). This
              screen is a document, so the title sits inside the document
              header where it always has — but it is now the SAME title, with
              the same by-line under it, as the step before and the step after.
              `view` already carries all four party facts, and passing them
              rather than letting this screen compose a sentence is what keeps
              K-3 and K-4 naming one person.
            */}
            <CeremonyHeading
              parties={{
                patientName: view.patientName,
                assignorIsPatient: view.assignorIsPatient,
                assignorName: view.assignorName,
                assignorRelationship: view.assignorRelationship,
              }}
              subHeading={strings.chrome.ceremonySubHeading[view.agreementType]}
              headingTestId="particulars-heading"
            />
            {view.ruleSetVersion && view.mappingVersion ? (
              <p className={styles.versions} data-testid="versions">
                {strings.particulars.versions(view.ruleSetVersion, view.mappingVersion)}
                {view.templateVersion ? strings.particulars.wordingVersion(view.templateVersion) : ''}
              </p>
            ) : null}
          </div>
          <div className={styles.grid}>
            {/*
              THE FORM, OR THE ROWS — never both (D-2026-09-27-01/-02).

              WITH A PRINT RECORD the practice's own DB4 is the document, and
              our rows for the patient, the provider, the place of practice, the
              date of service and the service description would be a second
              rendering of five facts the form already prints. The date of THIS
              agreement is not one of them: it is the agreement's own particular
              and is not on the practice's paper, so it stays.

              WITHOUT ONE this branch is not taken and what follows is exactly
              the file as it was before 27 September 2026 — same rows, same
              order, same components. That is the guarantee Carl asked for, and
              `a_session_with_no_print_record_renders_the_walk_up_particulars`
              is its name.
            */}
            {db4 ? (
              <>
                <Db4Document form={db4} showParserTemplate={blueprintPanels} />
                <Row label={strings.particulars.agreementDate} value={view.agreementDate} />
              </>
            ) : (
              <>
                <Row label={strings.particulars.patient} value={view.patientName} />
                <Row label={strings.particulars.provider} value={view.providerName} />
                <Row label={strings.particulars.placeOfPractice} value={view.providerAddress} />
                <Row label={strings.particulars.serviceDate} value={view.serviceDate} />
                <Row label={strings.particulars.agreementDate} value={view.agreementDate} />
                <Row label={strings.particulars.service} value={view.basicServiceDescription} />
                {/*
                  D6b — WHAT WAS ACTUALLY DONE, on a post-agreement (REQ-REG-01).
                  Drawn only when the server sent item numbers, which is only on the
                  type that carries them. Never an amount beside them (hard rule 4).
                */}
                {view.mbsItemNumbers.length > 0 && (
                  <Row
                    label={
                      view.mbsItemNumbers.length === 1
                        ? strings.particulars.item
                        : strings.particulars.items
                    }
                    value={view.mbsItemNumbers.join(', ')}
                  />
                )}
              </>
            )}
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
            {/*
              THE OPERATIVE WORDS, FROM THE SERVER'S RENDERED DOCUMENT — the
              same sentences the PDF prints, ticked one at a time. Nothing
              here is written in this file or in the string table (see the
              module note); the heading around them is, because a heading is
              chrome and these are the instrument.

              THE FALLBACK IS THE OLD SENTENCE, for an agreement locked before
              templates existed. It is not a control and cannot be ticked,
              because there is nothing on that agreement's record to record a
              tick against.
            */}
            {statements.length > 0 && onToggleAffirmation ? (
              <div className={styles.grid} data-testid="affirmations">
                <span className={styles.docRowLabel}>{strings.particulars.statementsHeading}</span>
                {statements.map((statement) => (
                  <Checkbox
                    key={statement.key}
                    label={statement.text}
                    checked={affirmed.includes(statement.key)}
                    onToggle={() => onToggleAffirmation(statement.key)}
                    testId={`affirm-${statement.key}`}
                  />
                ))}
              </div>
            ) : (
              <p className={styles.consent}>{strings.particulars.consentText}</p>
            )}
          </div>
          <div className={styles.tags}>
            {/*
              THE TAG SAYS WHAT IS TRUE OF THIS SCREEN (D-2026-09-27-01). With
              the practice's amounts on it, "No amount shown" would be false —
              and a tag a reviewer can catch out is worse than no tag, because
              it teaches them the other two are decoration. Hard rule 4 as
              narrowed by D-2026-09-14-02 is what the replacement states.
            */}
            <Tag
              label={
                showsAnAmount
                  ? strings.particulars.tagAmountIsThePractices
                  : strings.particulars.tagNoAmount
              }
            />
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

/**
 * THE PRACTICE'S DB4, LAID OUT AS THE FORM (D-2026-09-27-01 part 1).
 *
 * A RENDERER AND NOTHING ELSE. Every word of substance is `form`'s: the heading
 * lines, the location, the patient's details, the descriptions, the amounts,
 * the privacy notice and the statements all arrive on the lock response, built
 * on the server from the same `PrintJobEnvelope` the Signed-DB4 is drawn from.
 * This function supplies labels, column headings and the order of the blocks.
 * It composes no sentence, parses no value and computes nothing.
 *
 * SEMANTICS, NOT A PICTURE. The refusal of a rendered PDF (D-2026-09-27-01 part
 * 4) was partly a WCAG refusal, so the replacement has to clear the bar it was
 * refused for: one `h2` for the form's own title with `h3` sections under it, a
 * real `<table>` with column headers for the service rows, a labelled region,
 * and type that reflows on a 10-inch tablet in portrait without scrolling
 * sideways. WCAG 2.2 AA on a patient surface is release-blocking (CLAUDE.md §6).
 *
 * AND NOTHING THAT IS NOT THERE IS DRAWN, which is this screen's oldest rule.
 * Every block below is conditional on the server having sent it.
 */
function Db4Document({
  form,
  showParserTemplate,
}: {
  form: Db4FormView;
  /** The TEST-device flag. A parser version is a developer's note (Carl, 4 Sep 2026). */
  showParserTemplate: boolean;
}): ReactNode {
  const copy = strings.particulars.db4;
  const headingLines = form.headingLines ?? [];
  /*
   * WHICH LINE IS THE TITLE, decided the same way `SignedDb4Renderer` decides
   * it — the second line, which on the practice's paper is "BULK BILL
   * ASSIGNMENT OF BENEFIT FORM". The rest are sentences about the form and are
   * paragraphs, because marking four consecutive lines as headings would give a
   * screen reader four headings and the patient none.
   */
  const titleIndex = headingLines.length > 1 ? 1 : 0;
  const addressLines = form.servicingLocationAddressLines ?? [];
  const patient = form.patient;
  const providers = form.providers ?? [];
  const services = form.services ?? [];
  const privacyNotice = form.privacyNotice ?? [];
  const statements = form.statements ?? [];
  /*
   * ONE NAME FROM TWO FIELDS. A join of two values the server sent, in the
   * order the form prints them — the same thing `mbsItemNumbers.join` above has
   * always done, and not a sentence this file composed.
   */
  const patientName = [patient?.givenNames, patient?.familyName].filter(Boolean).join(' ');
  /*
   * THE LINT RULE FIRES HERE, AND THE EXCEPTION IS DECLARED RATHER THAN
   * SIDESTEPPED (hard rule 1 / HARD-03).
   *
   * The root ESLint config refuses any identifier matching
   * `medicareCardNumber`, and a member expression's property is an identifier,
   * so reading this field trips it. Bracket access — `patient?.['…']` — would
   * also have silenced it, and that is exactly why it is not used: the rule's
   * own comment says its purpose is to make the name "loud at review time",
   * and a subscript is the quietest thing in the language. A declared
   * exception is greppable, shows up in the diff, and has to carry a reason.
   * The same choice, for the same reason, as `packages/contracts/src/
   * print-capture.ts` and `db4-form-view.ts`.
   *
   * What the rule protects is intact. The value arrived MASKED — the server
   * never sends an unmasked one, and `Db4FormView` has no field it could
   * arrive in — and it is never used to verify anybody, never used to find or
   * match a patient, and never logged.
   */
  // eslint-disable-next-line no-restricted-syntax
  const maskedCard = patient?.medicareCardNumberMasked ?? null;

  return (
    <section className={styles.db4} aria-label={copy.regionLabel} data-testid="db4-form">
      <div className={styles.db4Heading}>
        {headingLines.map((line, index) =>
          index === titleIndex ? (
            <h2 key={`db4-heading-${index}`} className={styles.db4Title}>
              {line}
            </h2>
          ) : (
            <p key={`db4-heading-${index}`} className={styles.db4HeadingLine}>
              {line}
            </p>
          ),
        )}
        {/*
          WHOSE PAGE THIS IS (hard rule 12), and it is not optional. The heading
          lines above are the government's words about the government's form,
          reproduced because they are what the practice printed; this line under
          them says who drew the screen, so nothing above can be read as our
          claim. It is the screen's equivalent of the Signed-DB4's provenance
          footer, and it makes no claim about our own wording at all.
        */}
        <p className={styles.db4Provenance} data-testid="db4-provenance">
          {copy.provenance}
        </p>
      </div>

      <Row label={copy.formReference} value={form.formReference ?? null} />
      <Row label={copy.serviceDate} value={form.serviceDate ?? null} />

      {form.servicingLocationName || addressLines.length > 0 ? (
        <div className={styles.db4Section}>
          <h3 className={styles.db4SectionHeading}>{copy.servicingLocation}</h3>
          {form.servicingLocationName ? (
            <p className={styles.docRowValue}>{form.servicingLocationName}</p>
          ) : null}
          {addressLines.map((line, index) => (
            <p key={`db4-location-${index}`} className={styles.docRowValue}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {patient ? (
        <div className={styles.db4Section} data-testid="db4-patient">
          <h3 className={styles.db4SectionHeading}>{copy.patient}</h3>
          {/* The name sits straight under its own heading, as the location's
              does — a "Patient" label under a "Patient" heading says it twice. */}
          {patientName ? <p className={styles.docRowValue}>{patientName}</p> : null}
          <Row label={copy.dateOfBirth} value={patient.dateOfBirth ?? null} />
          <Row label={copy.address} value={patient.address ?? null} />
          <Row label={copy.patientRecordNumber} value={patient.patientRecordNumber ?? null} />
          {/*
            THE NUMBER ARRIVED MASKED AND IS DRAWN AS IT ARRIVED (hard rule 1;
            D-2026-09-27-01 part 3). There is no unmasked value on the type, so
            there is nothing here to reconstruct and nothing to leak — and the
            note says why the card in the patient's wallet looks different,
            before they wonder whether we hold the wrong number.
          */}
          {maskedCard ? (
            <>
              <Row label={copy.maskedCardNumber} value={maskedCard} />
              <p className={styles.db4Note}>{copy.maskedCardNote}</p>
            </>
          ) : null}
          <Row label={copy.irn} value={patient.irn ?? null} />
        </div>
      ) : null}

      {providers.length > 0 ? (
        <div className={styles.db4Section} data-testid="db4-providers">
          <h3 className={styles.db4SectionHeading}>{copy.providers}</h3>
          {providers.map((provider, index) => (
            <div key={`db4-provider-${index}`} className={styles.db4Section}>
              <Row label={providerLabel(provider.role)} value={provider.name ?? null} />
              <Row label={copy.providerNumber} value={provider.providerNumber ?? null} />
            </div>
          ))}
        </div>
      ) : null}

      {services.length > 0 ? (
        <div className={styles.db4Section}>
          <h3 className={styles.db4SectionHeading}>{copy.services}</h3>
          {/*
            A REAL TABLE, WITH REAL HEADERS. Four columns of related values are
            a table to everybody who can see them, and they have to be one to
            everybody who cannot: a `<th scope="col">` is what lets a screen
            reader say "Benefit assigned, 45.05" instead of reading a wall of
            strings. The caption is the table's accessible name and is announced
            rather than drawn — the visible heading above already names it.
          */}
          <table className={styles.db4Table} data-testid="db4-services">
            <caption className={styles.visuallyHidden}>{copy.servicesCaption}</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.db4ColDate}>
                  {copy.columnDate}
                </th>
                <th scope="col" className={styles.db4ColItem}>
                  {copy.columnItem}
                </th>
                <th scope="col">{copy.columnDescription}</th>
                <th scope="col" className={styles.db4ColBenefit}>
                  {copy.columnBenefit}
                </th>
              </tr>
            </thead>
            <tbody>
              {services.map((service, index) => (
                <tr key={`db4-service-${index}`} data-testid={`db4-service-${index}`}>
                  <td>{service.serviceDate ?? ''}</td>
                  <td>{service.mbsItemNumber ?? ''}</td>
                  <td>{service.description ?? ''}</td>
                  {/*
                    THE STRING PRACSOFT PRINTED, PUT ON THE SCREEN (hard rule 4
                    as narrowed by D-2026-09-14-02). Not parsed to a number, not
                    reformatted, not given a currency symbol we chose, not
                    summed and not totalled — every one of those would be AoB
                    originating a figure, which the rule forbids even where the
                    figure would happen to agree. Display only: it is on no
                    payload this screen can send.
                  */}
                  <td className={styles.db4Benefit}>{service.benefitAssigned ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {privacyNotice.length > 0 ? (
        <div className={styles.db4Section} data-testid="db4-privacy-notice">
          <h3 className={styles.db4SectionHeading}>{copy.privacyNotice}</h3>
          {privacyNotice.map((line, index) => (
            <p key={`db4-privacy-${index}`} className={styles.db4Note}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/*
        THE IN-SCOPE STATEMENT(S), AND THE FILTERING HAPPENED ON THE SERVER.
        The practice's paper carries two, the second of which offers to assign
        pathology benefits — s 65C(4) items 1–4, out of scope (CLAUDE.md §8).
        `Db4FormView` drops it exactly as `SignedDb4Renderer.drawAssignment`
        does, so the screen and the chart folder agree, and this component
        simply never receives it. Nothing here filters, because a second filter
        is a second rule to drift.
      */}
      {statements.length > 0 ? (
        <div className={styles.db4Section} data-testid="db4-assignment">
          <h3 className={styles.db4SectionHeading}>{copy.assignment}</h3>
          {statements.map((statement, index) => (
            <p key={statement.key ?? `db4-statement-${index}`} className={styles.docRowValue}>
              {statement.text}
            </p>
          ))}
        </div>
      ) : null}

      {showParserTemplate && form.parserTemplateVersion ? (
        <p className={styles.db4Note} data-testid="db4-parser-template">
          {copy.parserTemplate(form.parserTemplateVersion)}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The label beside a provider's name. An unrecognised role falls back to the
 * plain "Provider" the rest of this screen uses rather than printing the role
 * key at a patient — the key is ours, not a word anybody standing at the tablet
 * can act on.
 */
function providerLabel(role: string | undefined): string {
  if (role === 'servicing') return strings.particulars.db4.servicingProvider;
  if (role === 'payee') return strings.particulars.db4.payeeProvider;
  return strings.particulars.provider;
}

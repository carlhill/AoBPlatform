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
 *
 * AND THE FORM IS READ AS THREE PAGES, NOT ONE (Carl, 27 September 2026, from a
 * live tablet: *"I think we need to break this down into maybe four pages from
 * step 2. 2A: Date / time and header info to identify the patient. 2B: Dr seen
 * and items in the table. 2C: legal blurb and tick-boxes for approval. Then
 * continue with sign-off."*). A whole DB4 on one tablet page is more than
 * anybody reads at once, and a patient who scrolls past the service rows to
 * reach the tick boxes has not read the service rows.
 *
 * THEY ARE PAGES WITHIN A STEP AND THE CHIP DOES NOT MOVE. Carl's own naming —
 * 2A, 2B, 2C — is the ruling: `rules/ceremony-steps.ts` counts the CEREMONY and
 * keeps saying "Step 2 of 3" or "Step 3 of 4" across all three, because a page
 * of a document is not a step of a ceremony. The page line under the heading is
 * this screen's own and says so in its own words.
 *
 * THE SPLIT RUNS ONLY WHERE THERE IS A FORM TO SPLIT, and "only" means the path
 * does not run — the same rule the DB4 block itself follows (D-2026-09-27-02).
 * A session with no print record has one page of rows and no pagination at all,
 * exactly as before; so does a caller that hands this screen no page state,
 * because the pages have to be remembered somewhere the screen outlives.
 * `Ceremony.tsx` holds them, which is what lets K-4's Back land the patient
 * back on 2C rather than at the top of the form. Named tests:
 * `a_session_with_no_print_record_is_never_paginated` and
 * `the_pages_are_not_steps_and_the_chip_does_not_move`.
 *
 * WHAT THE PAGES DO NOT CHANGE IS THE GATE (hard rule 2, REQ-REG-06). The
 * outstanding count still spans all three pages, Continue-to-sign is still shut
 * until every affirmation anywhere is ticked, and a box waiting on a page the
 * patient is not on gets a control that TAKES them to it rather than a sentence
 * telling them to go looking (CLAUDE.md §7). Which affirmation is read on which
 * page is `rules/db4-pages.ts` — presentation, never the instrument.
 */

import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import type { AgreementType } from '@aobplatform/domain';
import type { Db4FormView } from '@aobplatform/contracts';
import { Blueprint, Kicker, Screen, Tag, CeremonyHeading } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import { Checkbox } from '../components/Field';
import { shortHash } from '../components/SignatureControl';
import type { SignatureValidation } from '../rules/signature-gate';
import type { StepNumber } from '../rules/ceremony-steps';
import {
  db4PagePosition,
  nextDb4Page,
  previousDb4Page,
  statementPage,
  type Db4Page,
} from '../rules/db4-pages';
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
  step,
  page,
  onPage,
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
  /**
   * WHERE K-3 SITS IN THE CEREMONY THE PATIENT IS ACTUALLY ON, worked out once
   * by `Ceremony.tsx` from `rules/ceremony-steps.ts`. This screen is on all
   * three routes and is a different number on two of them — the third of four
   * on a walk-up with K-5, the second of three without it and on a push — which
   * is why it cannot number itself (Carl, 27 Sep 2026).
   */
  step?: StepNumber;
  /**
   * WHICH PAGE OF THE DB4 IS ON SCREEN, AND HOW TO TURN IT (Carl, 27 Sep 2026).
   *
   * THE STATE IS THE CEREMONY'S, NOT THIS SCREEN'S, and that is structural
   * rather than stylistic. K-4's Back returns to K-3 and must land on 2C — the
   * page the patient left — so the page has to be remembered by something that
   * outlives this component, and `Ceremony.tsx` is the only thing that does.
   * Named test: `back_from_the_signature_lands_on_the_page_the_patient_left`.
   *
   * BOTH ABSENT IS THE OLD SCREEN, on the reasoning this file already applies
   * to Back, the enduring decline and the affirmations: a screen draws a
   * control when it is handed a handler. Without them the whole form is one
   * page, which is also what a session with no print record gets — a caller
   * that forgets them loses pagination and nothing else, because every
   * affirmation is then on the one page and the gate is unchanged.
   */
  page?: Db4Page;
  onPage?: (next: Db4Page) => void;
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

  /**
   * IS THIS SCREEN PAGINATED AT ALL — asked once, as ONE object, so nothing
   * below can be half-paginated (Carl, 27 Sep 2026).
   *
   * THREE FACTS HAVE TO HOLD AND ALL THREE ARE REAL. There must be a form to
   * split (D-2026-09-27-02 — a practice with no PMS prints none), and there
   * must be somewhere to keep the page, which is the ceremony rather than this
   * component because K-4's Back has to land on the page the patient left. A
   * null here is the screen exactly as it was before 27 September 2026: one
   * page, every block, every tick box, no page line and no page turns.
   */
  const paged = db4 && page && onPage ? { page, onPage } : null;

  /**
   * WHICH BLOCKS THIS RENDER DRAWS. `true` for everything when the screen is
   * not paginated, which is what keeps the unpaginated markup byte-for-byte
   * what it was — the branch is not taken rather than taken and agreeing.
   */
  const on = (target: Db4Page): boolean => paged === null || paged.page === target;

  /**
   * THE AFFIRMATIONS THIS PAGE CARRIES, and every one of them still counts
   * towards `outstanding` above (hard rule 2, REQ-REG-06).
   *
   * `rules/db4-pages.ts` DECIDES, NOT THIS FILE, and an unknown key lands on
   * the legal page rather than disappearing — a dropped tick is a Continue
   * that will not open with nothing on screen to explain it. 2A carries none
   * by construction: no statement maps to it.
   */
  const pageStatements = paged
    ? statements.filter((statement) => statementPage(statement.key) === paged.page)
    : statements;

  /**
   * AN OUTSTANDING TICK THE PATIENT CANNOT SEE FROM HERE (CLAUDE.md §7 —
   * shortcuts to the answer, not directions to a screen).
   *
   * The blocked Continue already says HOW MANY are left and must stay
   * genuinely unpressable — `GuardedButton`'s blocked branch has no handler at
   * all, which is the whole of hard rule 2 on this screen. So the count stays
   * where it is and this is the separate control beside it that TAKES the
   * patient to the first box still waiting. Null when there is nothing
   * outstanding anywhere else, in which case no control is drawn.
   */
  const strandedTick = paged
    ? (statements.find(
        (statement) =>
          !affirmed.includes(statement.key) && statementPage(statement.key) !== paged.page,
      ) ?? null)
    : null;

  /**
   * THIS PAGE'S OWN TICKS, STILL OUTSTANDING (Carl, 27 September 2026, from a
   * live tablet: *"on page 1 or 3 Continue button should be enabled after the
   * box is ticked. Same rule on the next page"*).
   *
   * THE GATE MOVED FROM THE END OF THE DOCUMENT TO THE END OF EACH PAGE. It
   * used to be one gate on the sign-off control: pages turned freely and
   * every box anywhere had to be ticked before signing. That is sound and it
   * reads wrong — Carl watched a live tablet offer a live Continue under an
   * unticked box that says *"I confirm the details above are correct"*, which
   * invites somebody to page past an affirmation and meet it again later as a
   * blocked button on a page they have left behind.
   *
   * THE WHOLE-DOCUMENT GATE IS UNCHANGED AND STILL THE ONE THAT MATTERS.
   * `readyToSign` and `outstanding` below still span every page, so this is a
   * second, earlier gate and never a replacement: no arithmetic here can open
   * the signature path, which is hard rule 2 (REQ-REG-06) and is enforced by
   * `GuardedButton`'s blocked branch having no handler at all. What this does
   * is stop somebody reaching the last page with work behind them.
   *
   * 2A HAS NO STATEMENTS, so its Continue is ungated by construction rather
   * than by a special case — the filter simply returns nothing.
   *
   * IT NEVER BLOCKS CARE (hard rule 8). Back still turns the page, "See
   * reception" is in the chrome on every page, and a patient who will not
   * tick is a patient reception handles — which is the same answer this
   * screen has always given, one page earlier.
   */
  const pageOutstanding = pageStatements.filter(
    (statement) => !affirmed.includes(statement.key),
  ).length;

  /**
   * SIGN-OFF IS ON THE LAST PAGE AND NOWHERE ELSE. On 2A and 2B Continue turns
   * the page; a control there that read "Continue to sign" would tell somebody
   * they were about to sign a document they had read a third of.
   */
  const nextPage = paged ? nextDb4Page(paged.page) : null;
  const previousPage = paged ? previousDb4Page(paged.page) : null;

  /**
   * FOCUS FOLLOWS THE PAGE (WCAG 2.2 AA, and CLAUDE.md §6 — this is a patient
   * surface). A page turn that swaps the content under a stationary cursor is
   * a page turn a screen-reader user is never told about, so focus moves to
   * the new page's heading, which is the one element every page has exactly
   * one of (`Db4Document`'s `pageHeadingRef`).
   *
   * NOT ON ARRIVAL, ONLY ON A TURN. Stealing focus the moment K-3 draws would
   * skip the ceremony's own heading and the by-line above it, which are the
   * two lines a patient reads first. The ref below remembers what was last
   * drawn so the first render is left alone; it is memory inside one React
   * component, not a write to any storage surface (CLAUDE.md §7).
   */
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  /**
   * Names the document's scrolling region after the ceremony heading inside
   * it. A FIXED id, like K-P1's `check-details-lede`, not `useId`: one K-3 is
   * on screen at a time, and a per-render id would make two renders of the
   * same agreement differ (`an_absent_print_record_and_an_explicit_null_render_the_same_markup`).
   */
  const headingId = 'particulars-document-heading';
  const drawnPage = useRef<Db4Page | null>(null);
  const currentPage = paged?.page ?? null;
  useEffect(() => {
    const previous = drawnPage.current;
    drawnPage.current = currentPage;
    if (currentPage === null || previous === null || previous === currentPage) return;
    pageHeadingRef.current?.focus();
  }, [currentPage]);

  /**
   * WHO SIGNS, AND THE ONE LINE UNDER IT. Composed once because it is drawn in
   * two places that are not the same place: on a DB4 screen it joins the date
   * of this agreement in the full-width band under 2A's two columns, and on
   * the unpaginated walk-up screen it follows the six particulars rows exactly
   * as it always has. Writing it twice would be two copies of a sentence about
   * who is party to a contract, and the copy is the one that rots.
   *
   * K-5 IS SKIPPED ON A LOCKED AGREEMENT, so this is where the fact lands —
   * and it points at a person rather than at a control, because there is
   * nothing here for the patient to do (Carl, 4 Sep 2026).
   */
  const assignorFacts = (
    <>
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
      {view.particularsLocked ? (
        <p className={styles.fieldHint} data-testid="assignor-locked-note">
          {strings.particulars.assignorLockedNote}
        </p>
      ) : null}
    </>
  );

  const actions = (
    <div className={styles.actions}>
      {/*
        BACK IS THE PAGE'S FIRST AND THE CEREMONY'S SECOND. On 2B and 2C there
        is a page behind this one, so Back turns back to it — one call to the
        ceremony's page setter, no fetch, nothing on the agreement moves, which
        is the same thing Back has always been on this device. On 2A, and on
        every unpaginated screen, it is the ceremony's own Back and is not
        drawn at all when there is nothing behind the step (a locked walk-up
        skipped K-5).
      */}
      {previousPage && paged ? (
        <SecondaryButton
          label={strings.chrome.backAction}
          onPress={() => paged.onPage(previousPage)}
          testId="db4-page-back"
        />
      ) : onBack ? (
        <SecondaryButton label={strings.chrome.backAction} onPress={onBack} testId="particulars-back" />
      ) : null}
      <div className={`${styles.grow} ${styles.primaryStack}`}>
        {nextPage && paged ? (
          /*
            GATED ON THIS PAGE'S OWN TICKS (Carl, 27 September 2026). A
            `GuardedButton` rather than a `PrimaryButton` so the blocked state
            is a real `button[disabled]` with no handler, exactly as the
            sign-off control is, and so the reason is on the control rather
            than left for somebody to work out from an unticked box.
          */
          <GuardedButton
            label={strings.particulars.db4.continueToNextPage}
            state={
              pageOutstanding === 0
                ? { disabled: false }
                : { disabled: true, disabledLabel: strings.particulars.db4.continueNotTicked(pageOutstanding) }
            }
            onPress={() => paged.onPage(nextPage)}
            testId="db4-page-continue"
          />
        ) : (
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
        )}
        {/*
          AND WHERE THE OUTSTANDING BOX IS ON ANOTHER PAGE, THE WAY TO IT.
          Only beside the blocked sign-off control, and only while the lock
          itself is not what is blocking — a patient whose particulars are
          still validating has nothing to tick and nowhere useful to be sent.

          UNDER THE MESSAGE, NOT NEXT TO IT IN THE ROW (Carl, 27 Sep 2026:
          "there is NO visible control beside it"). It WAS rendering; it was
          the third item in a wrapping flex row, and in the 320px rail a TEST
          device draws the actions in, the three controls stack under two
          blueprint panels and the third one lands below the fold. On an
          ordinary tablet the same row is 1085px wide and all three sit side
          by side — which is why it looked fine in one place and absent in
          another. A shortcut that can be separated from the message naming
          its reason is CLAUDE.md §7's "directions to a screen", so it is now
          a child of the same box as the control it explains and cannot wrap
          away from it at any width.
        */}
        {!nextPage && strandedTick && validation.state === 'valid' ? (
          <SecondaryButton
            label={strings.particulars.db4.goToOutstanding}
            onPress={() => paged?.onPage(statementPage(strandedTick.key))}
            testId="go-to-outstanding-tick"
          />
        ) : null}
      </div>
      {/*
        AFTER THE PRIMARY, NEVER BEFORE IT. Signing is what this screen is for;
        the alternative is real and is offered, and it does not compete for the
        eye of somebody who already knows what they want.

        ON THE SIGN-OFF PAGE ONLY, for the same reason Continue changes there:
        declining is an answer to the whole agreement, and it belongs beside
        the control that accepts it rather than on a page of the form.
      */}
      {!nextPage && isEnduring && onDeclineEnduring ? (
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
      stepTag={step ? strings.chrome.stepOf(step.position, step.total) : undefined}
      context={strings.particulars.footer}
      sessionId={sessionId}
      patientId={patientId}
      /*
        THE PRINT RUN'S OWN IDS, BESIDE THE OTHER AUDIT IDS (Carl, 27 Sep 2026
        — "show this in the footer with the other audit ids").

        TEST DEVICES ONLY, and the gate is here rather than in `Screen`: it is
        the same `blueprintPanels` flag the parser template version and the
        "ready to sign" panel already sit behind, and on a patient's tablet an
        internal id is a developer's note. Identifiers, never content (hard
        rule 9), and neither is a link — the DB4 Print Record itself carries
        the unmasked card number and stays on a workstation (hard rule 1,
        `packages/contracts/src/db4-form-view.ts`).
      */
      printJobId={blueprintPanels ? (db4?.printJobId ?? null) : null}
      sourceSha256={blueprintPanels ? (db4?.sourceSha256 ?? null) : null}
      onLeave={onSeeReception}
    >
      {/*
        THE CONTROLS NEVER SCROLL OFF; THE TEXT MAY (Carl, 10 Oct 2026, from a
        Galaxy Tab S10 Ultra in landscape in Edge: the tick boxes were below
        the fold and the last thing on screen was "Please read and tick each
        of these").

        `fitColumns` makes this step exactly the height of the content row,
        and the document splits in two: the READ-ONLY part (the heading, the
        form's page, the ongoing agreement's explanation) is its own scrolling
        region, and everything the patient ACTS on — the tick boxes, the tags
        that close the document, and the actions — sits under it, always on
        screen. Nothing is reordered: the DOM order, the tab order and what a
        screen reader says are exactly what they were, and nothing overlaps
        anything, so no control can sit over a focused one (WCAG 2.2 2.4.11).

        ONLY WHERE THERE IS HEIGHT FOR IT. The split is inside a
        `min-height` media query in `kiosk.module.css`; below it — a zoomed
        page, a phone held sideways — the step is one column that scrolls as
        a whole, exactly as before, so nothing is trapped in a small box at
        400% zoom (WCAG 2.2 1.4.10).
      */}
      <div className={`${blueprintPanels ? styles.twoColumn : styles.oneColumn} ${styles.fitColumns}`}>
        <Blueprint className={`${styles.document} ${styles.documentFit}`}>
          {/*
            A REGION WITH A NAME AND A TAB STOP, because it scrolls on its own
            and a keyboard or switch user has to be able to reach and scroll
            it (WCAG 2.1.1). Named by the ceremony heading at its top.
          */}
          <div
            className={styles.documentScroll}
            role="region"
            aria-labelledby={headingId}
            tabIndex={0}
            data-testid="particulars-scroll"
          >
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
                headingId={headingId}
              />
              {view.ruleSetVersion && view.mappingVersion ? (
                <p className={styles.versions} data-testid="versions">
                  {strings.particulars.versions(view.ruleSetVersion, view.mappingVersion)}
                  {view.templateVersion ? strings.particulars.wordingVersion(view.templateVersion) : ''}
                </p>
              ) : null}
              {/*
                WHICH PAGE OF THE FORM THIS IS, AND IT IS NOT THE STEP CHIP
                (Carl, 27 Sep 2026). The chip in the header counts the CEREMONY
                and says the same number on all three pages, because pages within
                a step are not steps — that is `rules/ceremony-steps.ts` and
                nothing here touches it. This line counts the DOCUMENT, and it
                sits by the screen's own heading where the document is.
              */}
              {paged ? (
                <p className={styles.versions} data-testid="db4-page-of">
                  {strings.particulars.db4.pageOf(
                    db4PagePosition(paged.page).position,
                    db4PagePosition(paged.page).total,
                  )}
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
                  {/*
                    THE AGREEMENT'S OWN FACTS GO AT THE FOOT OF 2A's LEFT
                    COLUMN (Carl, 28 September 2026: *"move Date of this
                    agreement and Signing below Date of service / Too much
                    wasted white space"*, then *"put at foot of the left
                    column"* — below the practice's run rather than inside it).

                    THIS REVERSES 27 SEPTEMBER, AND THE REASON IT GAVE WAS REAL.
                    The two facts are neither practice nor patient — the date of
                    THIS agreement is not on the practice's paper, and who is
                    signing is a fact about the party rather than the record — so
                    they were put in a band across the foot of the page, where
                    the layout made that plain. The cost was a left column that
                    ended half way down beside a much taller patient block, and
                    the gap read as a rendering fault. They now end that column
                    instead, which fills it by exactly as much and leaves the
                    practice's own run of facts unbroken.

                    WHAT MAKES THE MOVE SAFE IS THE HEADING, NOT THE POSITION.
                    Inside the practice's column a distinction the layout used to
                    carry has to be carried in words, so the two facts keep a
                    section of their own headed "This agreement" — the same care
                    `db4-provenance` takes two blocks above (hard rule 12). That
                    is also what the 27 September note worried about when it said
                    the foot of this column reads as the practice's: true of two
                    bare rows, and answered by heading them.

                    IT IS A SLOT, NOT A FACT `Db4Document` KNOWS. That component
                    renders the practice's printed record and nothing else; it
                    places this node and never composes it, so nothing of ours
                    can leak into the reproduction.

                    STILL 2A's, and still before 2B's `episodic_details_correct_v1`
                    asks the patient to confirm "the details above".
                  */}
                  <Db4Document
                    form={db4}
                    showParserTemplate={blueprintPanels}
                    page={paged?.page}
                    pageHeadingRef={pageHeadingRef}
                    agreementFacts={
                      <>
                        <Row label={strings.particulars.agreementDate} value={view.agreementDate} />
                        {assignorFacts}
                      </>
                    }
                  />
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
                  {/*
                    WHO SIGNS, IN THE PLACE IT HAS ALWAYS BEEN on the screen
                    with no DB4 — last of the particulars rows, same order, same
                    markup. A session with no print record is not paginated at
                    all (D-2026-09-27-02), so there is no page to gate it on.
                  */}
                  {assignorFacts}
                </>
              )}
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
              {isEnduring && on('legal') ? (
                <div className={styles.grid} data-testid="enduring-coverage">
                  <span className={styles.docRowLabel}>{strings.particulars.enduringCoverageHeading}</span>
                  {strings.particulars.enduringCoverage.map((line) => (
                    <p key={line} className={styles.docRowValue}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
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

            AND ON A PAGINATED FORM EACH ONE IS READ WHERE IT APPLIES (Carl,
            27 Sep 2026), which `rules/db4-pages.ts` decides and this file
            only renders. `pageStatements` is the subset for THIS page;
            `outstanding` above is still every statement on every page, so
            the gate did not move (hard rule 2, REQ-REG-06). 2A shows no
            block because no statement maps to it.
          */}
          {pageStatements.length > 0 && onToggleAffirmation ? (
            <div className={styles.grid} data-testid="affirmations">
              <span className={styles.docRowLabel}>{strings.particulars.statementsHeading}</span>
              {pageStatements.map((statement) => (
                <Checkbox
                  key={statement.key}
                  label={statement.text}
                  checked={affirmed.includes(statement.key)}
                  onToggle={() => onToggleAffirmation(statement.key)}
                  testId={`affirm-${statement.key}`}
                />
              ))}
            </div>
          ) : statements.length === 0 && on('legal') ? (
            <p className={styles.consent}>{strings.particulars.consentText}</p>
          ) : null}
          {/*
            THE TAGS CLOSE THE DOCUMENT, so on a paginated form they close the
            LAST page. Repeating them on every page would put "Amount as the
            practice printed it" under 2A, which shows no amount — and a tag a
            reviewer can catch out is exactly what D-2026-09-27-01 changed the
            third tag to stop being.
          */}
          {on('legal') ? (
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
          ) : null}
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
              WHAT THE TABLET WAS ACTUALLY SENT (Carl, 27 Sep 2026). He asked
              for the DB4 Print Record itself on this screen; the raw record
              carries the UNMASKED Medicare card number, so it stays reachable
              from a workstation only and this is the agreed substitute — the
              MASKED block exactly as it arrived, so somebody checking a
              rendering can see whether the screen drew what it was given
              rather than inferring it from the screen.

              NOTHING IS RE-MASKED HERE AND NOTHING COULD BE. `Db4FormView` has
              no unmasked Medicare field to print (hard rule 1, and the
              reasoning in `packages/contracts/src/db4-form-view.ts`), so this
              renders whatever arrived and there is no second masking rule to
              drift from the server's. It is a test-device panel, on the same
              flag as the parser template version, and it is never logged.
            */}
            {db4 ? (
              <Blueprint>
                <Kicker label={strings.particulars.db4.payloadHeading} />
                <p className={styles.railText}>{strings.particulars.db4.payloadBody}</p>
                <pre className={styles.db4Payload} data-testid="db4-payload">
                  {JSON.stringify(db4, null, 2)}
                </pre>
              </Blueprint>
            ) : null}

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
 *
 * AND SINCE 27 SEPTEMBER 2026 IT CAN BE READ A PAGE AT A TIME. `page` names
 * which third is on screen; `undefined` draws all of it, which is what a
 * caller holding no page state gets and is byte-for-byte the markup this
 * function produced before. The partition is Carl's: the form's header and the
 * patient block, then the providers and the services, then the privacy notice
 * and the assignment.
 */
function Db4Document({
  form,
  showParserTemplate,
  page,
  pageHeadingRef,
  agreementFacts,
}: {
  form: Db4FormView;
  /** The TEST-device flag. A parser version is a developer's note (Carl, 4 Sep 2026). */
  showParserTemplate: boolean;
  /**
   * WHICH PAGE OF THE FORM TO DRAW, or `undefined` for all of it. The screen
   * decides — see `paged` there — and this function only renders.
   */
  page?: Db4Page;
  /**
   * THE PAGE'S OWN HEADING, WHICH IS WHERE FOCUS LANDS ON A PAGE TURN (WCAG
   * 2.2 AA). Exactly one heading carries it per page, so the caller's effect
   * has one element to move to whichever third is on screen.
   */
  pageHeadingRef?: Ref<HTMLHeadingElement>;
  /**
   * THE AGREEMENT'S OWN FACTS, PLACED BUT NEVER COMPOSED HERE (Carl, 28
   * September 2026).
   *
   * A SLOT, BECAUSE THIS FUNCTION REPRODUCES THE PRACTICE'S PRINTED RECORD
   * AND NOTHING ELSE. The date of this agreement and who is signing are ours,
   * not theirs, and the caller owns both; all that happens here is that they
   * are drawn in 2A's left column under the date of service, behind their own
   * heading, so the reproduction cannot acquire a fact the paper never had.
   */
  agreementFacts?: ReactNode;
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

  /**
   * WHETHER A BLOCK BELONGS TO THIS RENDER. `undefined` is the whole form on
   * one page, so every block is drawn and the branch is not taken rather than
   * taken and agreeing — the same shape the DB4 feature itself uses
   * (D-2026-09-27-02).
   */
  const on = (target: Db4Page): boolean => page === undefined || page === target;

  /**
   * ONE h2 PER PAGE, AND IT IS WHAT FOCUS MOVES TO.
   *
   * ON 2A IT IS THE FORM'S OWN TITLE LINE, already an h2 and already the right
   * name for that page — the words the practice printed beat any label this
   * file could invent. 2B and 2C are parts of one form with no printed title
   * of their own, so they take a page heading from the string table: chrome,
   * exactly like the column headings and section names around them, and
   * operative of nothing.
   *
   * `header` IN THE TABLE IS A FALLBACK, for a print record whose heading
   * lines the parser could not read. Without it that page would have no
   * heading and nothing for focus to land on — and a parser that partly
   * defeats a template is the exact case `parserTemplateVersion` exists for.
   */
  const ownTitle = on('header') && headingLines.length > 0;
  const pageHeading =
    page === undefined || ownTitle ? null : copy.pageHeading[page];

  return (
    <section className={styles.db4} aria-label={copy.regionLabel} data-testid="db4-form">
      <div className={styles.db4Heading}>
        {pageHeading ? (
          <h2
            className={styles.db4Title}
            ref={pageHeadingRef}
            tabIndex={-1}
            data-testid="db4-page-heading"
          >
            {pageHeading}
          </h2>
        ) : null}
        {on('header')
          ? headingLines.map((line, index) =>
              index === titleIndex ? (
                <h2
                  key={`db4-heading-${index}`}
                  className={styles.db4Title}
                  ref={page === undefined ? undefined : pageHeadingRef}
                  tabIndex={page === undefined ? undefined : -1}
                  data-testid={page === undefined ? undefined : 'db4-page-heading'}
                >
                  {line}
                </h2>
              ) : (
                <p key={`db4-heading-${index}`} className={styles.db4HeadingLine}>
                  {line}
                </p>
              ),
            )
          : null}
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

      {/*
        2A — THE FORM'S HEADER AND THE PATIENT (Carl, 27 Sep 2026: "Date / time
        and header info to identify the patient"). It is the FORM'S header
        reproduced, never a second identity check: the patient may already have
        proved who they are on K-2 or ticked their details on K-P1, and asking
        twice is exactly what Carl did not want.
      */}
      {/*
        2A's TWO COLUMNS — THE PRACTICE ON THE LEFT, THE PATIENT ON THE RIGHT
        (Carl, 27 Sep 2026: "on Step 2 page 1 or 3 can we put the Practice
        details on the left and the Patients on the right").

        THE DOM ORDER IS THE READING ORDER AND IS NOT REVERSED ANYWHERE.
        Practice first, patient second, in the markup — so when
        `.db4Columns` collapses to one track on a portrait tablet they stack
        in that same order, and the tab order and a screen reader say the
        same thing at both widths. The grid does the placing; no `order`
        property is involved (`kiosk.module.css`).

        THE FORM'S REFERENCE AND ITS DATE OF SERVICE GO LEFT, with the place
        that printed them. They are facts about the form and the visit, not
        about the person, and a lone pair of rows above two columns would be a
        third block on a page Carl asked to have two.
      */}
      {on('header') ? (
        <div className={styles.db4Columns} data-testid="db4-header-columns">
          <div className={styles.db4Column}>
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
            {/*
              OURS, AT THE FOOT OF THE COLUMN AND SAYING SO (Carl, 28
              September 2026: *"put at foot of the left column"*).

              LAST, SO THE PRACTICE'S FACTS STAY CONTIGUOUS. The reference,
              the date of service and the place that printed them are one
              run of the practice's own record; slotting two of ours in the
              middle of it broke that run for no gain, since a column fills
              by the same amount wherever inside it a block is added.

              AND HEADED, which is the part that is not about layout at all.
              Everything above this in the column is the practice's; two
              unlabelled rows under their address would read as theirs. The
              heading is what says otherwise now that the whitespace no
              longer does (hard rule 12).

              AND A HAIRLINE ABOVE IT (Carl, 28 September 2026: *"a little
              lower and put draw a line separator"*) — the one part of the
              old full-width band that was doing real work, kept now that the
              band itself is gone. Second signal, never the only one: the
              heading says the same thing in words (WCAG 2.2, 1.4.1).
            */}
            {agreementFacts ? (
              <div
                className={`${styles.db4Section} ${styles.db4Agreement}`}
                data-testid="db4-agreement-facts"
              >
                <h3 className={styles.db4SectionHeading}>{copy.thisAgreement}</h3>
                {agreementFacts}
              </div>
            ) : null}
          </div>

          {patient ? (
            <div className={styles.db4Column}>
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
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        2B — WHO WAS SEEN AND WHAT WAS DONE (Carl: "Dr seen and items in the
        table"). The amounts are unchanged: the string PracSoft printed, in the
        same table, never parsed (hard rule 4).
      */}
      {on('services') && providers.length > 0 ? (
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

      {on('services') && services.length > 0 ? (
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
                  <td className={styles.db4Benefit}>
                    <AmountAsPrinted value={service.benefitAssigned} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/*
        2C — THE PRIVACY NOTICE AND THE ASSIGNMENT (Carl: "legal blurb and
        tick-boxes for approval. Then continue with sign-off"). The tick boxes
        themselves are the AGREEMENT's affirmations rather than the form's
        words, so they are drawn by the screen above this function; which of
        them lands here is `rules/db4-pages.ts`.
      */}
      {on('legal') && privacyNotice.length > 0 ? (
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
      {on('legal') && statements.length > 0 ? (
        <div className={styles.db4Section} data-testid="db4-assignment">
          <h3 className={styles.db4SectionHeading}>{copy.assignment}</h3>
          {/*
            22px, NOT THE 20 A PARTICULAR'S VALUE GETS (Carl, 27 Sep 2026 —
            "rising to 22px where it is the operative words of the
            agreement"). These sentences ARE the instrument; a date of birth
            is a fact about the patient. They shared `.docRowValue` until the
            scale gave the distinction a size. The words are untouched —
            still `Db4FormView`'s, still reproduced exactly.
          */}
          {statements.map((statement, index) => (
            <p key={statement.key ?? `db4-statement-${index}`} className={styles.db4Statement}>
              {statement.text}
            </p>
          ))}
        </div>
      ) : null}

      {on('legal') && showParserTemplate && form.parserTemplateVersion ? (
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

/**
 * THE AMOUNT THE PRACTICE PRINTED, SPLIT AT ITS DECIMAL POINT SO A COLUMN OF
 * THEM LINES UP (Carl, 28 September 2026: *"we will need to put decimals or at
 * least position the numbers to line up - you think"*).
 *
 * NOT ONE CHARACTER IS ADDED, CHANGED OR REMOVED, and that is the whole of the
 * care here. Padding `45` to `45.00`, or `1234.5` to `1234.50`, would be AoB
 * WRITING A FIGURE THE PRACTICE DID NOT PRINT — hard rule 4 as narrowed by
 * D-2026-09-14-02 permits reproducing the amount the practice's billing
 * software printed and nothing else. `join('')` of the two halves is always
 * identical to the input; a test pins exactly that.
 *
 * SO THE FIX IS POSITION, NOT CONTENT. The whole part is right-aligned against
 * the decimal point and the fraction hangs off it in a slot of its own, which
 * puts the points in one vertical line however many digits follow them:
 *
 *        45
 *       $45.05
 *     1,234.55
 *
 * THE LAST DOT IS THE DECIMAL POINT. In en-AU the comma groups thousands and
 * the dot separates the fraction, so `1,234.55` splits after `1,234`. Anything
 * with no dot at all is whole and takes the empty fraction slot, which is what
 * keeps `45` aligned with the rest.
 *
 * IT READS THE STRING'S SHAPE, NEVER ITS VALUE. Nothing here parses a number,
 * compares one, sums one or decides whether a figure is plausible. `$`, the
 * grouping comma and a one-decimal amount all survive exactly as printed,
 * because the screen's job is to show the patient THEIR form.
 *
 * IN PRACTICE THE COLUMN IS ALREADY TIDY — a real PracSoft DB4 prints two
 * decimals on every row, so this changes nothing on a normal form. It earns
 * its place on the half-read ones, and by making the alignment structural so
 * nobody reaches for padding later.
 */
export function AmountAsPrinted({ value }: { value?: string | null }) {
  const printed = value ?? '';
  const point = printed.lastIndexOf('.');
  const whole = point === -1 ? printed : printed.slice(0, point);
  const fraction = point === -1 ? '' : printed.slice(point);
  return (
    <span className={styles.db4Amount}>
      <span className={styles.db4AmountWhole}>{whole}</span>
      {/*
        ALWAYS DRAWN, EVEN EMPTY. The slot is what reserves the width that puts
        the decimal points in a line; dropping it on a whole amount would pull
        that row right by the width of its neighbours' fractions, which is the
        ragged column this exists to fix.
      */}
      <span className={styles.db4AmountFraction}>{fraction}</span>
    </span>
  );
}

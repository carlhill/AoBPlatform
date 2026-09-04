'use client';

/**
 * K-P1 — "Please check your details", the first screen of the PUSHED ceremony
 * (TODO.md "Two front doors", Carl 4 Sep 2026; redesigned to a tick and a
 * cross per row on his ruling of the same day).
 *
 * IT IS NOT K-2 AND IT MUST NOT LOOK LIKE IT. K-2 asks an unsupported walk-up
 * patient to TYPE three identifiers so the server can find them and prove it is
 * them. This screen asks nothing of the kind: reception has already checked the
 * Medicare card in the PMS, matched the record, and asked date of birth,
 * mobile, email and address across the desk — that IS the three-identifier
 * staff check (REQ-VER-03), and the push refuses to happen without a named
 * staff member's identity on it. So the patient reads what we hold and says
 * whether it is right.
 *
 * WHICH MAKES THIS A DATA-ACCURACY CHECK AND NOT A VERIFICATION, and every
 * word on the screen has to keep that true. A value displayed on a tablet and
 * ticked by whoever is holding the tablet proves nothing about who is holding
 * it; `lede` says so plainly ("Our staff have already confirmed who you are")
 * rather than leaving the ticks to be misread later as an identity check. The
 * endpoint behind it is named `confirm-details`, and the vault event it writes
 * carries `isVerification: false`.
 *
 * A TICK AND A CROSS, TO THE RIGHT OF THE TEXT (Carl, 4 Sep 2026: "Make the big
 * buttons to the right of the text (in case we are using small tablets)").
 * Three things follow from that sentence and all three are load-bearing:
 *
 *  - TWO BUTTONS, NOT ONE TOGGLE. The screen this replaces had a single "This
 *    is correct" per row, so an untouched row meant both "wrong" and "not
 *    looked at yet" and nobody at the desk could tell which. An explicit cross
 *    is what makes a dispute a thing the platform can carry.
 *  - TO THE RIGHT, so the label and the value keep the left edge and the
 *    thumb reaches the controls — and BELOW THE VALUE under ~600px, because a
 *    small tablet in portrait cannot give a 56px pair and a long address the
 *    same line without shrinking one of them.
 *  - NEVER COLOUR ALONE (WCAG 1.4.1). Each control carries a glyph, a text
 *    label under it, a fill when chosen and `aria-pressed`, so the answer is
 *    legible to somebody who cannot tell the green from the red and audible to
 *    somebody hearing the page read out.
 *
 * TYPES GO TO THE SERVER, NEVER VALUES (REQ-VER-04, hard rule 9). This screen
 * never sends what it displays: `answeredTypes` maps the answered rows to the
 * five words in `CONFIRMABLE_DETAIL_TYPES` and the request body carries nothing
 * else. Named test: `details_confirmation_sends_types_not_values`.
 *
 * THERE IS NO FIELD ON THIS SCREEN, for the reason K-3 has none (Carl, 3 Sep
 * 2026 — "the tablet never presents a field that a patient or a passer-by
 * could fill on the practice's behalf"). A detail that is wrong is not fixed
 * here, and a cross carries no suggested replacement: the way out is a person
 * standing a metre away, whose identity is recorded when they fix it on a
 * staff surface. That is also why a cross needs no further tap from the
 * patient — it is sent the moment every row has an answer, so reception sees
 * it without the patient having to explain anything across a waiting room.
 *
 * A ROW WITH NO VALUE IS NOT DRAWN. A practice that holds no email address
 * must not show somebody a blank line and ask whether it is correct — and the
 * answers required are exactly the rows on screen (`detailRowsFor`).
 *
 * NO MEDICARE NUMBER AND NO AMOUNT. There is no field for either in the
 * payload, the row list or the string table (hard rules 1 and 4).
 */

import type { ReactNode } from 'react';
import type { AgreementType } from '@aobplatform/domain';
import { Blueprint, Kicker, Screen } from '../components/Chrome';
import { GuardedButton } from '../components/Buttons';
import type { DetailAnswer, DetailAnswers, DetailRow } from '../rules/pushed-details';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

/**
 * ONE ANSWER BUTTON. The glyph is `aria-hidden` and the WORD beneath it is the
 * accessible name, so a screen reader says "That's right, pressed" rather than
 * reading out a tick character — and an eye that cannot separate the two
 * colours still has a mark and a word to go on.
 */
function AnswerButton({
  glyph,
  label,
  tone,
  chosen,
  onPress,
  testId,
}: {
  glyph: string;
  label: string;
  tone: 'right' | 'wrong';
  chosen: boolean;
  onPress: () => void;
  testId: string;
}): ReactNode {
  return (
    <button
      type="button"
      className={[
        styles.answerButton,
        tone === 'right' ? styles.answerRight : styles.answerWrong,
        chosen ? styles.answerChosen : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={chosen}
      onClick={onPress}
      data-testid={testId}
    >
      <span className={styles.answerGlyph} aria-hidden="true">
        {glyph}
      </span>
      <span className={styles.answerLabel}>{label}</span>
    </button>
  );
}

export function CheckDetailsScreen({
  practiceName,
  locationLine,
  agreementType,
  rows,
  answers,
  disputed,
  saving,
  saveError,
  onAnswer,
  onContinue,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  /** Picks the heading, so reading and signing say the same words as K-3 and K-4. */
  agreementType: AgreementType;
  rows: readonly DetailRow[];
  answers: DetailAnswers;
  /** At least one cross: Continue is dead and the band below says what happens next. */
  disputed: boolean;
  saving: boolean;
  saveError: boolean;
  onAnswer: (type: string, answer: DetailAnswer) => void;
  onContinue: () => void;
  onSeeReception: () => void;
}): ReactNode {
  const outstanding = rows.filter((row) => answers[row.type] === undefined).length;

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.stepOf(1, 3)}
      context={strings.checkDetails.footer}
      onLeave={onSeeReception}
    >
      <div className={styles.twoColumn}>
        <div className={styles.main}>
          <h1 className={styles.h2} data-testid="check-details-heading">
            {strings.particulars.headingByAgreementType[agreementType]}
          </h1>
          <p className={styles.lede} data-testid="check-details-lede">
            {strings.checkDetails.lede}
          </p>

          {rows.map((row) => {
            const answer = answers[row.type];
            return (
              <div key={row.type} className={styles.detailRow} data-testid={`detail-row-${row.type}`}>
                {/* THE TEXT KEEPS THE LEFT EDGE. */}
                <div className={styles.detailText}>
                  <span className={styles.groupLabel}>{row.label}</span>
                  <p className={styles.docRowValue} data-testid={`detail-value-${row.type}`}>
                    {row.value}
                  </p>
                </div>
                {/*
                  THE BUTTONS SIT TO ITS RIGHT, and drop underneath below
                  ~600px (`kiosk.module.css`) — a small tablet in portrait
                  cannot hold a long address and a 56px pair on one line
                  without shrinking one of them, and the one that must not
                  shrink is the touch target.
                */}
                <div className={styles.detailAnswers} role="group" aria-label={row.label}>
                  <AnswerButton
                    glyph="✓"
                    label={strings.checkDetails.right}
                    tone="right"
                    chosen={answer === 'right'}
                    onPress={() => onAnswer(row.type, 'right')}
                    testId={`detail-tick-${row.type}`}
                  />
                  <AnswerButton
                    glyph="✕"
                    label={strings.checkDetails.wrong}
                    tone="wrong"
                    chosen={answer === 'wrong'}
                    onPress={() => onAnswer(row.type, 'wrong')}
                    testId={`detail-cross-${row.type}`}
                  />
                </div>
              </div>
            );
          })}

          {/*
            THE BAND, AND IT REPLACES NOTHING THE PATIENT HAS TO DO. By the
            time it shows, the cross has already been sent — reception can see
            which detail is wrong and is fixing it. So it says what is
            happening, not what the patient must go and arrange, and it says
            the appointment is unaffected (hard rule 8, REQ-REC-04).
          */}
          {disputed ? (
            <p className={styles.disputeBand} role="status" data-testid="check-details-dispute">
              {strings.checkDetails.disputeBand}
            </p>
          ) : null}

          {saveError ? (
            <p className={styles.error} data-testid="check-details-error">
              {strings.checkDetails.saveFailed}
            </p>
          ) : null}

          <div className={styles.actions}>
            <div className={styles.grow}>
              <GuardedButton
                label={strings.checkDetails.continueAction}
                state={
                  outstanding === 0 && !disputed && !saving
                    ? { disabled: false }
                    : {
                        disabled: true,
                        disabledLabel: disputed
                          ? strings.checkDetails.continueDisputed
                          : strings.checkDetails.continueBlocked(Math.max(outstanding, 1)),
                      }
                }
                onPress={onContinue}
                testId="check-details-continue"
              />
            </div>
          </div>
        </div>

        <div className={styles.rail}>
          <Blueprint>
            {/*
              WHERE A WRONG DETAIL GOES, said before the patient has to work it
              out. There is nothing to correct on this device and there never
              will be; the person who can correct it is at the desk, and their
              identity is recorded when they do (REQ-REC-04 — the appointment is
              not affected either way).
            */}
            <Kicker label={strings.chrome.leaveAction} />
            <p className={styles.railText} data-testid="check-details-wrong">
              {strings.checkDetails.somethingWrong}
            </p>
          </Blueprint>
        </div>
      </div>
    </Screen>
  );
}

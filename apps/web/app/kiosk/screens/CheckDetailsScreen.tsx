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
  disabled,
  onPress,
  testId,
}: {
  glyph: string;
  label: string;
  tone: 'right' | 'wrong';
  chosen: boolean;
  /**
   * THE SCREEN IS LOCKED — a dispute has already reached reception (Carl's
   * ruling, 4 Sep 2026). A REAL `button[disabled]`, not a handler that quietly
   * does nothing: `Ceremony.tsx`'s `onAnswer` refuses too, belt and braces,
   * but the control itself must say it cannot be pressed. `chosen` is left
   * alone — the crossed row still shows red and the ticked rows still show
   * green, because the answers themselves have not changed, only whether they
   * can be.
   */
  disabled?: boolean;
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
      disabled={disabled}
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
  disputeSent,
  saving,
  saveError,
  sessionId,
  patientId,
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
  /**
   * THE DISPUTE HAS REACHED RECEPTION — the screen locks (Carl's ruling, 4 Sep
   * 2026). Every answer button disables, Continue stays absent, and the band
   * switches from `disputeBand` (the moment between the cross and the post
   * landing) to `waitBand` ("please wait for reception"). The only way off is
   * a re-send, a recall, See reception, or inactivity — never a changed
   * answer on this screen.
   */
  disputeSent: boolean;
  saving: boolean;
  saveError: boolean;
  /** The pushed session's own id — an audit/testing aid in the footer. See `Chrome.tsx`'s `Screen`. */
  sessionId?: string | null;
  /**
   * The patient's own AoBPlatform id, on a PUSHED session only — the walk-up
   * screens know nobody yet and pass nothing. See `Chrome.tsx`'s `Screen`.
   */
  patientId?: string | null;
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
      /*
       * NO FOOTER CONTEXT ON THIS SCREEN (Carl, 7 Sep 2026). The tagline moved
       * to the right column, where it is read at reading size beside the rows
       * rather than at 13px under them — see `.railNote` below. The string is
       * the same one (`checkDetails.footer`); only where it sits has changed.
       */
      sessionId={sessionId}
      patientId={patientId}
      onLeave={onSeeReception}
    >
      <div className={styles.twoColumn}>
        <div className={`${styles.main} ${styles.detailsMain}`}>
          {/*
            THE HEADING CARRIES THE LEDE WITH IT (7 Sep 2026, review of the
            layout change that moved the lede into the rail).

            MOVING COPY ACROSS A SCREEN MOVES IT IN THE READING ORDER TOO, and
            that is the half the layout work missed: with the lede at the foot
            of the rail, somebody hearing this page read out met five rows and
            ten buttons before "our staff have already confirmed who you are".
            The sentence that says this is a data check and NOT a verification
            is the one sentence on K-P1 that must not arrive late — it is the
            whole reason K-P1 is not K-2.

            `aria-describedby` FIXES IT WITHOUT MOVING THE PIXELS BACK: the
            description is announced with the heading wherever it sits on the
            glass, so the sighted reading order and the announced one agree
            again. The id and the test id deliberately carry the same name,
            because they name the same sentence.
          */}
          <h1
            className={styles.h2}
            data-testid="check-details-heading"
            aria-describedby="check-details-lede"
          >
            {strings.particulars.headingByAgreementType[agreementType]}
          </h1>
          {/*
            THE LEFT COLUMN IS THE TASK AND NOTHING ELSE (Carl, 7 Sep 2026 —
            "write to the right side somewhere"). The lede that used to sit
            here has moved into the rail: five rows, a heading, an explanation
            and a button did not fit a landscape tablet, and of those four the
            explanation is the one that reads better beside the task than above
            it. Same string, same words — `check-details-lede` still names it.
          */}

          {rows.map((row) => {
            const answer = answers[row.type];
            /*
             * ONCE LOCKED, ONLY THE CHOSEN BUTTON REMAINS — NOT DISABLED AND
             * GREYED, NOT RENDERED (Carl, 4 Sep 2026, on seeing the locked
             * K-P1: "so only the chosen answer remains — a green 'That's
             * right' alone on the four confirmed rows, a red 'That's wrong'
             * alone on the disputed row. That makes what the patient selected
             * unmistakable."). Before the lock, both always show.
             */
            const showTick = !disputeSent || answer === 'right';
            const showCross = !disputeSent || answer === 'wrong';
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

                  EACH SLOT KEEPS ITS COLUMN even when its button is not
                  rendered — `.answerPlaceholder` is the same box with nothing
                  in it, so the remaining button never slides into the other
                  one's position.
                */}
                <div className={styles.detailAnswers} role="group" aria-label={row.label}>
                  {showTick ? (
                    <AnswerButton
                      glyph="✓"
                      label={strings.checkDetails.right}
                      tone="right"
                      chosen={answer === 'right'}
                      disabled={disputeSent}
                      onPress={() => onAnswer(row.type, 'right')}
                      testId={`detail-tick-${row.type}`}
                    />
                  ) : (
                    <span className={styles.answerPlaceholder} aria-hidden="true" />
                  )}
                  {showCross ? (
                    <AnswerButton
                      glyph="✕"
                      label={strings.checkDetails.wrong}
                      tone="wrong"
                      chosen={answer === 'wrong'}
                      disabled={disputeSent}
                      onPress={() => onAnswer(row.type, 'wrong')}
                      testId={`detail-cross-${row.type}`}
                    />
                  ) : (
                    <span className={styles.answerPlaceholder} aria-hidden="true" />
                  )}
                </div>
              </div>
            );
          })}

          {/*
            THE BAND. `disputeSent` wins — reception already has the cross,
            and the screen is now locked until they act — and `disputed` alone
            covers only the moment between the cross and that post landing
            (`disputeBand`), which is unlikely to even be visible. Neither
            replaces anything the patient has to do; both say what is
            happening and that the appointment is unaffected (hard rule 8,
            REQ-REC-04).
          */}
          {disputeSent ? (
            <p className={styles.disputeBand} role="status" data-testid="check-details-wait">
              {strings.checkDetails.waitBand}
            </p>
          ) : disputed ? (
            <p className={styles.disputeBand} role="status" data-testid="check-details-dispute">
              {strings.checkDetails.disputeBand}
            </p>
          ) : null}

          {saveError ? (
            <p className={styles.error} data-testid="check-details-error">
              {strings.checkDetails.saveFailed}
            </p>
          ) : null}

          {/*
            NO CONTROL THAT CANNOT DO ANYTHING (Carl, 4 Sep 2026). The band
            above already says reception is fixing it (or is now asked to) and
            the appointment is unaffected; a second, disabled box repeating
            that — and a press that does nothing — has no business on a
            patient screen. Changing a cross back to a tick clears `disputed`
            and this returns — but only before the post lands: once
            `disputeSent`, the only ways off are a re-send, a recall, See
            reception, or inactivity (Carl's ruling, 4 Sep 2026).
          */}
          {disputed || disputeSent ? null : (
            <div className={styles.actions}>
              <div className={styles.grow}>
                <GuardedButton
                  label={strings.checkDetails.continueAction}
                  state={
                    outstanding === 0 && !saving
                      ? { disabled: false }
                      : { disabled: true, disabledLabel: strings.checkDetails.continueBlocked(Math.max(outstanding, 1)) }
                  }
                  onPress={onContinue}
                  testId="check-details-continue"
                />
              </div>
            </div>
          )}
        </div>

        {/*
          THE RIGHT COLUMN, WHICH NOW HAS SOMETHING IN IT (Carl, 7 Sep 2026 —
          "the right column holds only the small See reception card and is
          otherwise empty. Use it."). Below 900px the columns stack and
          `.railLeading` puts this first, so the explanation is read before the
          rows on a portrait tablet rather than after them.
        */}
        <div className={`${styles.rail} ${styles.railLeading}`} data-testid="check-details-rail">
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

          {/*
            WHAT THIS SCREEN IS, in the two sentences that were already written
            for it: the lede that used to sit under the heading, and the
            tagline that used to be set at 13px in the footer. Neither is new
            copy and neither has changed a word — `checkDetails.lede` and
            `checkDetails.footer`, both still the only place those words live.

            AND BOTH SAY THE SAME THING THE SCREEN'S HEADER COMMENT SAYS: staff
            confirmed who you are at the desk, this is a check that what we
            hold is right. That distinction is the whole reason K-P1 is not
            K-2, and it now sits where a patient reads it at rest instead of in
            the footer.
          */}
          <div className={styles.railNote}>
            {/* `id` is what the heading's `aria-describedby` above resolves to. */}
            <p id="check-details-lede" className={styles.railLede} data-testid="check-details-lede">
              {strings.checkDetails.lede}
            </p>
            <p className={styles.railContext} data-testid="check-details-context">
              {strings.checkDetails.footer}
            </p>
          </div>
        </div>
      </div>
    </Screen>
  );
}

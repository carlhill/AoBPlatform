'use client';

/**
 * K-P1 — "Please check your details", the first screen of the PUSHED ceremony
 * (TODO.md "Two front doors", Carl 4 Sep 2026).
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
 * endpoint behind Continue is named `confirm-details`, and the vault event it
 * writes carries `isVerification: false`.
 *
 * TYPES GO TO THE SERVER, NEVER VALUES (REQ-VER-04, hard rule 9). This screen
 * never sends what it displays: `confirmedTypes` maps ticked rows to the five
 * words in `CONFIRMABLE_DETAIL_TYPES` and the request body carries nothing
 * else. Named test: `details_confirmation_sends_types_not_values`.
 *
 * THERE IS NO FIELD ON THIS SCREEN, for the reason K-3 has none (Carl, 3 Sep
 * 2026 — "the tablet never presents a field that a patient or a passer-by
 * could fill on the practice's behalf"). A detail that is wrong is not fixed
 * here: the way out is a person standing a metre away, whose identity is
 * recorded when they fix it on a staff surface.
 *
 * A ROW WITH NO VALUE IS NOT DRAWN. A practice that holds no email address
 * must not show somebody a blank line and ask whether it is correct — and the
 * ticks required are exactly the rows on screen (`detailRowsFor`).
 *
 * NO MEDICARE NUMBER AND NO AMOUNT. There is no field for either in the
 * payload, the row list or the string table (hard rules 1 and 4).
 */

import type { ReactNode } from 'react';
import type { AgreementType } from '@aobplatform/domain';
import { Blueprint, Kicker, Screen } from '../components/Chrome';
import { GuardedButton, SecondaryButton } from '../components/Buttons';
import type { DetailRow } from '../rules/pushed-details';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function CheckDetailsScreen({
  practiceName,
  locationLine,
  agreementType,
  rows,
  ticked,
  saving,
  saveError,
  onToggle,
  onContinue,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  /** Picks the heading, so reading and signing say the same words as K-3 and K-4. */
  agreementType: AgreementType;
  rows: readonly DetailRow[];
  ticked: ReadonlySet<string>;
  saving: boolean;
  saveError: boolean;
  onToggle: (type: string) => void;
  onContinue: () => void;
  onSeeReception: () => void;
}): ReactNode {
  const outstanding = rows.filter((row) => !ticked.has(row.type)).length;

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
            const isTicked = ticked.has(row.type);
            return (
              <div key={row.type} className={styles.group} data-testid={`detail-row-${row.type}`}>
                <span className={styles.groupLabel}>{row.label}</span>
                <p className={styles.docRowValue} data-testid={`detail-value-${row.type}`}>
                  {row.value}
                </p>
                {/*
                  ONE LARGE CONTROL PER ROW, and selection is shown by FILL AND
                  `aria-pressed` rather than by colour alone (WCAG 1.4.1) — the
                  same primitive, and the same reasoning, as K-5's options. The
                  label changes with the state too, so a screen reader hears the
                  answer as well as the question.
                */}
                <SecondaryButton
                  label={isTicked ? strings.checkDetails.ticked : strings.checkDetails.tick}
                  align="left"
                  selected={isTicked}
                  onPress={() => onToggle(row.type)}
                  testId={`detail-tick-${row.type}`}
                />
              </div>
            );
          })}

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
                  outstanding === 0 && !saving
                    ? { disabled: false }
                    : {
                        disabled: true,
                        disabledLabel: strings.checkDetails.continueBlocked(Math.max(outstanding, 1)),
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

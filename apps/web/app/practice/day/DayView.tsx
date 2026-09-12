'use client';

/**
 * `/practice/day` — WHO CAME IN, ON ONE DAY (Carl, 12 September 2026, on
 * `/practice/frontdesk`: *"Add a button here with a link to show all Patients
 * seen at this practice today. You could put a filter on this to search for any
 * day. Default to today."*).
 *
 * A REGISTER, NOT A QUEUE, AND THAT DECIDES EVERYTHING ABOUT IT. The front desk
 * rail and the practitioner's waiting list are both lists of work outstanding,
 * so a person leaves them the moment their paperwork is done. This one keeps
 * everybody, because the question it answers — "who did we see, and what
 * happened about their agreement" — is asked about a day that is already over
 * at least as often as about one in progress.
 *
 * NOTHING ON IT ACTS. There is no control here that sends a tablet, corrects a
 * detail, marks a state or opens a session, and there is no row that links to
 * one. The same reasoning the practitioner's queue applies (§3): *"a control
 * they will never legitimately use is a control that will one day be pressed by
 * mistake"*. Reception works a patient from the front desk page; this page is
 * for looking.
 *
 * WHICH IS ALSO WHY IT DOES NOT POLL. The front desk polls every three seconds
 * because a receptionist is watching a patient tick boxes. A register of a day —
 * usually a past one — that redrew itself under somebody reading it would be a
 * distraction with nothing to offer in return. The top bar's refresh is
 * registered instead (`useRefreshable`), which is how every other read-only page
 * here says "ask again".
 *
 * THE DAY IS THE SERVER'S ANSWER AND NEVER THE BROWSER'S GUESS. The first read
 * sends no date at all, and the response says which day it answered for and in
 * which clock; the date control is seeded FROM that. A page that filled the
 * field in from `new Date()` would head the register with whatever day the
 * machine at the desk was having — which in this product is the exact defect
 * being designed around (`practiceDayWindow`, hard-won on the server).
 *
 * THE TABLE IS THE PRACTITIONER QUEUE'S, DELIBERATELY. `practitioner.module.css`
 * already styles this table — the wrapper that scrolls inside itself (WCAG 2.2
 * AA 1.4.10), the header, the quiet second line under a name — and the two
 * screens should look like the same product. A second stylesheet would be a
 * second set of table rules to drift (wow.md §10).
 *
 * EVERY STRING IS IN THE TABLE (REQ-LANG-01) and every unmapped code shows its
 * own code rather than a generic line (CLAUDE.md §7).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { DayRegister, DayRegisterRow } from '@aobplatform/contracts';
import { Button, Field, Notice, Shell, TextInput, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { strings } from '../../strings';
import { useRefreshable } from '../../refresh';
import { apiHeaders } from '../../auth';
import { arrivedAtLabel, visitStateLabel } from '../practitioner/waiting/WaitingView';
import table from '../practitioner/practitioner.module.css';
import page from '../practice.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * THE WORD FOR AN AGREEMENT'S STATE, AND THE CODE ITSELF WHERE THERE IS NO
 * WORD.
 *
 * The same rule `paperworkLabel` and `visitStateLabel` follow next door, and
 * the same reason: a status can be added to the domain before the string table
 * hears about it, and a blank cell in this column would read as "there is no
 * agreement" — a claim, and the most dangerous one this page could make by
 * accident. Exported for its own test.
 */
export function agreementStatusLabel(status: string): string {
  return strings.dayRegister.statuses[status] ?? status;
}

/**
 * WHETHER IT IS SIGNED, IN THREE ANSWERS RATHER THAN TWO.
 *
 * "Not yet" ABOUT A VISIT THAT NEEDS NO AGREEMENT WOULD BE A FALSE ALARM, and
 * it would be a permanent one — a patient who came only for a blood test is
 * never going to sign anything, and a column reading "Not yet" against them
 * every day is a column people learn to ignore. The same reasoning that gave
 * `nothing_to_sign` its own word on the practitioner's queue.
 */
export function signedLabel(row: Pick<DayRegisterRow, 'agreementId' | 'agreementSigned'>): string {
  if (!row.agreementId) return strings.dayRegister.signedNotApplicable;
  return row.agreementSigned ? strings.dayRegister.signedYes : strings.dayRegister.signedNo;
}

export function DayView({ practiceId }: { practiceId: string }) {
  /*
   * `null` MEANS "WHATEVER THE SERVER CALLS TODAY", and it is not the same as
   * an empty string a user cleared. The first read sends no date; from then on
   * the control holds whatever was last answered, so the field and the table
   * can never disagree about which day is on screen.
   */
  const [asked, setAsked] = useState<string | null>(null);
  const [register, setRegister] = useState<DayRegister | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (date: string | null) => {
      setBusy(true);
      try {
        const query = date ? `?date=${encodeURIComponent(date)}` : '';
        const res = await fetch(`${CORE_URL}/arrivals/day${query}`, { headers: apiHeaders(practiceId) });
        const body = (await res.json().catch(() => ({}))) as DayRegister & { message?: string };
        if (!res.ok) throw new Error(body.message ?? String(res.status));
        setRegister(body);
        /*
         * SEEDED FROM THE ANSWER. On the first read this is how the control
         * learns today's date without the browser ever guessing it.
         */
        setAsked(body.date);
        setError(null);
      } catch (err) {
        setError(err instanceof TypeError ? strings.status.unreachable : (err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [practiceId],
  );

  // The top bar's refresh re-reads the day on screen, not today.
  useRefreshable(useCallback(() => load(asked), [load, asked]));

  /*
   * ONE READ ON ARRIVAL, AND ANOTHER ONLY IF THE PRACTICE CHANGES. `load` is
   * memoised on `practiceId` alone, so depending on it is the same statement
   * said honestly: the date control drives every later read itself, and an
   * effect that also watched `asked` would immediately re-read the day it had
   * just been handed.
   */
  useEffect(() => {
    void load(null);
  }, [load]);

  const rows = register?.rows ?? [];

  return (
    <Shell
      right={<SessionControl audience={strings.dayRegister.audience} />}
      title={strings.dayRegister.title}
      lead={strings.dayRegister.lead}
    >
      {/* Hard rule 8, said out loud rather than left to be inferred. */}
      <Notice tone="ok" data-testid="day-never-blocks">
        {strings.dayRegister.neverBlocks}
      </Notice>

      <div className={page.controls}>
        <div className={page.searchField}>
          <Field label={strings.dayRegister.dateLabel} hint={strings.dayRegister.dateHint}>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                describedBy={describedBy}
                type="date"
                data-testid="day-date"
                value={asked ?? ''}
                disabled={busy && register === null}
                onChange={(event) => {
                  const chosen = event.target.value;
                  setAsked(chosen);
                  /*
                   * A CLEARED FIELD MEANS TODAY, not an empty register. Some
                   * browsers let a date input be emptied, and asking the server
                   * for "" is asking it for today — which is the honest reading
                   * of a person wiping the box.
                   */
                  void load(chosen === '' ? null : chosen);
                }}
              />
            )}
          </Field>
        </div>

        <p className={table.key} data-testid="day-timezone">
          {strings.dayRegister.timezoneNote(register?.timezone ?? '')}
        </p>

        <Button
          type="button"
          data-testid="day-today"
          disabled={busy}
          onClick={() => void load(null)}
        >
          {strings.dayRegister.today}
        </Button>
      </div>

      {error && (
        <Notice tone="stop" title={strings.dayRegister.notLoaded} data-testid="day-error">
          {error}
        </Notice>
      )}

      {register && rows.length === 0 && (
        <p className={table.empty} data-testid="day-nobody">
          {strings.dayRegister.nobody}
        </p>
      )}

      {register && rows.length > 0 && (
        <>
          <p className={table.key} data-testid="day-count">
            {strings.dayRegister.count(rows.length)}
          </p>

          {/* The table scrolls inside itself rather than pushing the page sideways. */}
          <div className={table.tableWrap}>
            <table className={table.table} data-testid="day-table">
              <caption className={table.visuallyHidden}>
                {strings.dayRegister.tableCaption(register.date)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{strings.dayRegister.columnName}</th>
                  <th scope="col">{strings.dayRegister.columnArrived}</th>
                  <th scope="col">{strings.dayRegister.columnSeenBy}</th>
                  <th scope="col">{strings.dayRegister.columnAgreement}</th>
                  <th scope="col">{strings.dayRegister.columnSigned}</th>
                  <th scope="col">{strings.dayRegister.columnVisit}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.arrivalId} data-testid={`day-row-${row.arrivalId}`}>
                    <td>
                      <span className={table.name}>
                        {/*
                          NAMED WHERE WE CAN, AND SAID PLAINLY WHERE WE CANNOT.
                          An arrival that never resolved to a record is still a
                          person who walked in, so it is listed — with the
                          practice's own number below, which is the handle
                          reception has in front of them.
                        */}
                        {row.patientName ?? strings.dayRegister.noPatientRecord}
                      </span>
                      {/*
                        THE PRACTICE'S OWN NUMBER, LABELLED. An APPROVED
                        identifier (hard rule 1, REQ-VER-02): the s 65C set is
                        name, date of birth, gender, address, patient record
                        number and IHI. The Medicare card number is not in it,
                        is not on the row, and there is no field for it.
                      */}
                      {row.patientRecordNumber && (
                        <span className={table.under} data-testid={`day-record-${row.arrivalId}`}>
                          {strings.dayRegister.patientRecordNumber(row.patientRecordNumber)}
                        </span>
                      )}
                    </td>
                    <td className={table.time}>{arrivedAtLabel(row.arrivedAt)}</td>
                    <td>
                      {row.seenByName ?? strings.dayRegister.seenByUnknown}
                      {/*
                        WHOSE AGREEMENT IT IS, WHERE THAT IS SOMEBODY ELSE
                        (ARRIVAL-WHO-IS-SEEN.md §6a). The server sends this only
                        when the two differ, so a name here always marks a real
                        difference — "Dr Chen's agreement" is honest where
                        "their agreement" would not be.
                      */}
                      {row.agreementProviderName && (
                        <span className={table.under} data-testid={`day-under-${row.arrivalId}`}>
                          {strings.dayRegister.agreementUnder(row.agreementProviderName)}
                        </span>
                      )}
                    </td>
                    <td className={table.paperwork} data-testid={`day-agreement-${row.arrivalId}`}>
                      {row.agreementStatus
                        ? agreementStatusLabel(row.agreementStatus)
                        : strings.dayRegister.noAgreement}
                    </td>
                    <td className={table.paperwork} data-testid={`day-signed-${row.arrivalId}`}>
                      {signedLabel(row)}
                    </td>
                    <td data-testid={`day-visit-${row.arrivalId}`}>
                      {row.visitState ? visitStateLabel(row.visitState) : strings.dayRegister.visitNotSaid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/*
        THE WAY BACK TO THE DESK, IN THE BODY AS WELL AS IN THE HEADER. The
        header's `BackLink` is derived from the path and is the one every page
        has; this one is where somebody who has just read a table is looking,
        and the two point at the same place.
      */}
      <p className={table.key}>
        <Link href="/practice/frontdesk" className={ui.buttonLink} data-testid="day-to-frontdesk">
          <ArrowLeft size={15} aria-hidden="true" />
          {strings.frontdesk.title}
        </Link>
      </p>
    </Shell>
  );
}

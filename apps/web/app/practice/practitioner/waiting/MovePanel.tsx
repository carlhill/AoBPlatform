'use client';

/**
 * MOVE THE SELECTED PATIENTS TO ANOTHER PRACTITIONER — the sick-practitioner
 * morning (Carl, 12 September 2026: *"the assigned practioner has called in
 * sick... select the patients and then select a practioner to move them to"*).
 *
 * RECEPTION ONLY, AND THE SERVER AGREES. The waiting page renders this solely
 * in its practice-wide mode, which the SERVER decides from the token
 * (`WaitingList.scope`), and the endpoint behind it is practice-scoped — a
 * practitioner's token carries no practice claim and cannot reach it. §3 of
 * PRACTITIONER-QUEUE-PAGE.md forbids the practitioner's own view growing a
 * control that acts on an agreement, and this one does exactly that: it
 * supersedes. Deciding who sees a patient instead is the front desk's act
 * (§3a rule 4).
 *
 * IT SAYS WHAT IT DOES BEFORE IT IS PRESSED, twice over. That moving somebody
 * REPLACES their agreement, because the agreement names the practitioner (D4,
 * s 65C(5)(a)) — and that THE PATIENT HAS NOT BEEN ASKED (D-2026-09-12-03: a
 * substitution is two questions asked in order, and this action asks neither).
 * The second sentence is the important one: a desk that assumes the platform
 * did the asking is a desk that will not ask.
 *
 * IT HOLDS NOBODY UP (hard rule 8). A patient who cannot be moved is seen
 * exactly as they would have been, and the page says so rather than leaving it
 * to be inferred.
 *
 * IT CARRIES NO LIST OF ITS OWN. The practitioners come from
 * `GET /arrivals/servicing-providers` — the same read reception's other
 * pickers use, filtered by the same predicate that decides who may be named on
 * an agreement — so this component cannot offer somebody the server would then
 * refuse, and a new practitioner needs no code change here.
 */

import { useState } from 'react';
import type { ArrivalProviderChoice } from '@aobplatform/contracts';
import { Button, Field, Notice, SelectInput } from '../../../ui';
import { strings } from '../../../strings';
import styles from '../practitioner.module.css';

export interface MoveSummary {
  readonly moved: number;
  readonly refused: number;
  readonly signAgain: number;
}

export function MovePanel({
  selectedCount,
  choices,
  busy,
  summary,
  error,
  onMove,
}: {
  selectedCount: number;
  /** Null while the list is still being read. */
  choices: readonly ArrivalProviderChoice[] | null;
  busy: boolean;
  /** What the last press came to, in counts. Each row says its own answer. */
  summary: MoveSummary | null;
  /** The whole press failed — unreachable, or refused outright. */
  error: string | null;
  onMove: (toAffiliationId: string) => void;
}) {
  const [to, setTo] = useState('');
  const ready = selectedCount > 0 && to !== '' && !busy;

  return (
    <section className={styles.movePanel} data-testid="waiting-move">
      <h3 className={styles.groupTitle}>{strings.practitionerQueue.waiting.move.title}</h3>
      <p className={styles.key}>{strings.practitionerQueue.waiting.move.whatItDoes}</p>
      {/*
        THE PATIENT HAS NOT BEEN ASKED. A warning rather than a hint, because
        it is the one thing on this panel that somebody must act on themselves.
      */}
      <Notice tone="warn" data-testid="waiting-move-not-asked">
        {strings.practitionerQueue.waiting.move.notAsked}
      </Notice>

      <Field label={strings.practitionerQueue.waiting.move.chooseLabel}>
        {({ id, describedBy }) => (
          <SelectInput
            id={id}
            describedBy={describedBy}
            data-testid="waiting-move-target"
            value={to}
            disabled={busy}
            onChange={(event) => setTo(event.target.value)}
          >
            <option value="">{strings.practitionerQueue.waiting.move.choosePlaceholder}</option>
            {(choices ?? []).map((choice) => (
              <option key={choice.affiliationId} value={choice.affiliationId}>
                {choice.locationLabel
                  ? strings.practitionerQueue.waiting.move.choiceAt(choice.name, choice.locationLabel)
                  : choice.name}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>

      <Button data-testid="waiting-move-go" disabled={!ready} onClick={() => onMove(to)}>
        {busy
          ? strings.practitionerQueue.waiting.move.moving
          : strings.practitionerQueue.waiting.move.button(selectedCount)}
      </Button>
      {!ready && !busy && <p className={styles.key}>{strings.practitionerQueue.waiting.move.nothingChosen}</p>}

      {error && (
        <Notice tone="stop" data-testid="waiting-move-failed">
          {strings.practitionerQueue.waiting.move.failed(error)}
        </Notice>
      )}

      {/*
        PARTIAL FAILURE IS NEVER SILENT. The counts are here and every refusal
        says why on the row it was about — `role="status"` so a screen reader
        hears the answer without losing the caret (WCAG 2.2 AA, 4.1.3).
      */}
      {summary && (
        <p className={styles.key} role="status" data-testid="waiting-move-summary">
          {strings.practitionerQueue.waiting.move.summaryMoved(summary.moved)}
          {summary.signAgain > 0
            ? ` ${strings.practitionerQueue.waiting.move.summarySignAgain(summary.signAgain)}`
            : ''}
          {summary.refused > 0
            ? ` ${strings.practitionerQueue.waiting.move.summaryRefused(summary.refused)}`
            : ''}
        </p>
      )}

      <p className={styles.key} data-testid="waiting-move-never-blocks">
        {strings.practitionerQueue.waiting.move.neverBlocks}
      </p>
    </section>
  );
}

/**
 * WHAT ONE ROW'S MOVE CAME TO, IN WORDS — beside the patient it was about.
 *
 * AN UNMAPPED REASON SHOWS ITS CODE (CLAUDE.md §7). A generic fallback would
 * tell the person nothing and hide the diagnosis, and on this page it would be
 * a row that quietly looks fine.
 */
export function moveOutcomeWords(outcome: {
  moved: boolean;
  refusedReason: string | null;
  needsANewSignature: boolean;
}): string {
  if (outcome.moved) {
    return outcome.needsANewSignature
      ? strings.practitionerQueue.waiting.move.outcomeSignAgain
      : strings.practitionerQueue.waiting.move.outcomeMoved;
  }
  const code = outcome.refusedReason ?? '';
  return (
    strings.practitionerQueue.waiting.move.refusal[code] ??
    strings.practitionerQueue.waiting.move.refusalUnknown(code)
  );
}

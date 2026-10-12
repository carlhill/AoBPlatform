/**
 * A STATUS PER PATIENT, SET FROM THE PRACTITIONER'S WAITING LIST
 * (PRACTITIONER-QUEUE-PAGE.md §3a; Carl, 12 September 2026).
 *
 * Carl, annotating the grouped view: *"Need buttons or drop down to say 1. With
 * patient now 2. Pending (patient in queue) 3. Completed (consultation
 * completed) 4. Reassign (to a different Doctor) — Reception will have a task
 * on the frontdesk/patient page to reassign the patient to a different doctor
 * and do the necessary checks and so on."*
 *
 * THE LIST IS CONTENT AND NOT A TYPESCRIPT UNION (CLAUDE.md §7, whose first
 * instance was `assignor-relationships.json`): *"Any list a user picks from —
 * relationships, reasons, categories, STATES — lives in a versioned content
 * file under `packages/domain/content/`, schema-validated at load, with display
 * labels in the string table keyed by option key. A screen renders the file in
 * file order and never carries the list itself, so the list changes without a
 * code change and the version travels with the record it produced."* That last
 * clause is hard rule 14 in miniature and it is why `VisitStateRecord` carries
 * `statesVersion`: a state set in September must still say what it was chosen
 * from after the list is edited in November.
 *
 * IT IS ATTENDANCE, NOT CLINICAL DOCUMENTATION (§3a rule 1; VISIT-CHECKLIST.md
 * §5). Who, what state, when — from the token, never a typed name. There is no
 * free-text field on the record and there is deliberately nowhere to put one:
 * *"a note box here becomes a clinical record within a week."* No reason, no
 * triage, no duration, no result, no amount (hard rule 4), no identifier value
 * (hard rules 1 and 9).
 *
 * NOTHING HERE GATES ANYTHING (§3a rule 5, hard rule 8, REQ-REC-04). An unset
 * state changes nothing about whether the patient is seen or billed, and
 * neither does a set one. Every value is a report of what happened in the room.
 *
 * REVERSIBLE, AND THE CORRECTION IS KEPT BESIDE THE ORIGINAL (§3a rule 6). A
 * wrong state is corrected by writing a NEW record; nothing is ever updated or
 * deleted. `latestVisitState` reads the newest, and the older ones remain the
 * history of what somebody thought at the time.
 */
import content from '../content/visit-states.json';

export interface VisitStateOption {
  /** Stable identifier. The string table is keyed by this; it is never shown. */
  readonly key: string;
  /**
   * MAY A PERSON CHOOSE THIS FROM THE CONTROL?
   *
   * FALSE FOR `pending` ALONE, and that is §3a's table: *"Pending — in the
   * queue, not yet seen. The default on arrival. Who sets it: **Nobody** — it
   * is the starting state."* It is shown as the current answer, so a row that
   * has not been touched reads honestly, and it is never offered as a choice.
   */
  readonly settableByHand: boolean;
  /** Where every visit starts, before anybody has said anything about it. */
  readonly isTheStartingState: boolean;
  /**
   * IS SETTING THIS THE SERVICE-RENDERED SIGNAL (§3a rule 3;
   * VISIT-CHECKLIST.md §6)?
   *
   * *"Completed is the service-rendered signal. It is what raises the
   * post-service agreement automatically. Nothing else about the agreement is
   * touched from here."* Exactly one option may carry it — two would mean the
   * platform had two different answers to "did a service happen".
   */
  readonly isTheServiceRenderedSignal: boolean;
  /**
   * DOES SETTING THIS ASK RECEPTION TO DO SOMETHING (§3a rule 4)?
   *
   * *"Reassign never reassigns. A practitioner pressing it says 'not me'. Who
   * the patient DOES see is reception's decision on the front desk page, where
   * the covering-doctor check (an enduring agreement is per practitioner) runs
   * before anything is re-papered."* So this flag raises a task and changes
   * nothing whatever about who the patient is here to see.
   */
  readonly raisesAFrontDeskTask: boolean;
}

export interface VisitStateContent {
  /** Recorded on every state written. Bump it on every edit (hard rule 14). */
  readonly version: string;
  /** ORDER IS THE ORDER ON SCREEN. */
  readonly options: readonly VisitStateOption[];
}

/**
 * Exhaustive, and it throws rather than repairing.
 *
 * Hand-written rather than Zod because `@aobplatform/domain` has zero runtime
 * dependencies by charter (CONVENTIONS.md §1) and is bundled into the browser
 * as well as into three Nest services. It runs at module load, so a malformed
 * edit fails the build at the bench rather than a practice at nine in the
 * morning.
 */
export function parseVisitStateContent(raw: unknown): VisitStateContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/visit-states.json is not usable: ${why}. This file is versioned content (hard rule 14) ` +
        'and is validated at load so a bad edit fails the build rather than a practice.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.options) || doc.options.length === 0) {
    return fail('`options` must be a non-empty array');
  }

  const seen = new Set<string>();
  const options = doc.options.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`options[${index}] is not an object`);
    const option = entry as Record<string, unknown>;

    if (typeof option.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(option.key)) {
      return fail(`options[${index}].key must be a lower_snake_case identifier`);
    }
    if (seen.has(option.key)) return fail(`options[${index}].key "${option.key}" appears twice`);
    seen.add(option.key);

    for (const flag of [
      'settableByHand',
      'isTheStartingState',
      'isTheServiceRenderedSignal',
      'raisesAFrontDeskTask',
    ] as const) {
      if (typeof option[flag] !== 'boolean') return fail(`options[${index}].${flag} must be a boolean`);
    }

    /*
     * ONE OPTION CANNOT BOTH END THE VISIT AND HAND IT ON. Completed says the
     * consultation happened; Reassign says it should not happen with this
     * practitioner. A single option asserting both would raise a post-service
     * agreement for a service nobody performed.
     */
    if (option.isTheServiceRenderedSignal === true && option.raisesAFrontDeskTask === true) {
      return fail(
        `options[${index}] ("${String(option.key)}") is both the service-rendered signal and a front-desk ` +
          'task — a state cannot say a service happened and ask for it to be handed on',
      );
    }

    return {
      key: option.key,
      settableByHand: option.settableByHand as boolean,
      isTheStartingState: option.isTheStartingState as boolean,
      isTheServiceRenderedSignal: option.isTheServiceRenderedSignal as boolean,
      raisesAFrontDeskTask: option.raisesAFrontDeskTask as boolean,
    } satisfies VisitStateOption;
  });

  /*
   * EXACTLY ONE STARTING STATE, AND NOBODY MAY SET IT BY HAND. §3a's table
   * gives Pending no setter at all. A file with two starting states would leave
   * "what does an untouched row say" unanswerable; a file where the starting
   * state was settable would let a practitioner move a patient BACKWARDS into
   * "not yet seen" after the service-rendered signal had already gone.
   */
  const starting = options.filter((o) => o.isTheStartingState);
  if (starting.length !== 1) {
    return fail(`exactly one option must be the starting state; found ${starting.length}`);
  }
  if (starting[0]!.settableByHand) {
    return fail(`the starting state "${starting[0]!.key}" must not be settable by hand (§3a: nobody sets it)`);
  }

  /*
   * AT MOST ONE SERVICE-RENDERED SIGNAL. Zero is permitted — an edit may
   * deliberately unwire it while the item-number question is open (see
   * TODO.md) — but two would mean two answers to "did a service happen".
   */
  if (options.filter((o) => o.isTheServiceRenderedSignal).length > 1) {
    return fail('at most one option may be the service-rendered signal');
  }

  /*
   * AND SOMEBODY MUST BE ABLE TO SET SOMETHING. A file where every option is
   * `settableByHand: false` is a control that does nothing, silently.
   */
  if (!options.some((o) => o.settableByHand)) {
    return fail('at least one option must be settable by hand, or the control does nothing');
  }

  return { version: doc.version, options };
}

export const VISIT_STATE_CONTENT: VisitStateContent = parseVisitStateContent(content);

/** ORDER IS THE ORDER ON SCREEN. A screen renders this and never its own list. */
export const VISIT_STATE_OPTIONS: readonly VisitStateOption[] = VISIT_STATE_CONTENT.options;
export const VISIT_STATE_KEYS: readonly string[] = VISIT_STATE_OPTIONS.map((o) => o.key);
export const VISIT_STATES_VERSION = VISIT_STATE_CONTENT.version;

export function visitStateOption(key: string): VisitStateOption | undefined {
  return VISIT_STATE_OPTIONS.find((o) => o.key === key);
}

/** Where a visit sits before anybody has said anything about it. */
export const DEFAULT_VISIT_STATE: string = VISIT_STATE_OPTIONS.find((o) => o.isTheStartingState)!.key;

/**
 * MAY THIS STATE BE CHOSEN BY A PERSON? The starting state may not, and neither
 * may a key that is not in the file at all — an unknown key is a caller
 * inventing a state, and the platform refuses rather than storing it.
 */
export function mayBeSetByHand(key: string): boolean {
  return visitStateOption(key)?.settableByHand === true;
}

/** Setting this is the service-rendered signal (§3a rule 3). */
export function isTheServiceRenderedSignal(key: string): boolean {
  return visitStateOption(key)?.isTheServiceRenderedSignal === true;
}

/** Setting this asks reception to look, and moves nobody (§3a rule 4). */
export function raisesAFrontDeskTask(key: string): boolean {
  return visitStateOption(key)?.raisesAFrontDeskTask === true;
}

/**
 * ONE RECORD OF SOMEBODY SAYING WHERE A VISIT HAD GOT TO.
 *
 * APPEND-ONLY BY CONSTRUCTION, and there is no shape here for an amendment: a
 * correction is a NEW record with a later `setAt`, and the one it corrects
 * stays exactly where it was (§3a rule 6, and the same instinct as hard rule
 * 11 — the vault has no update and no delete either).
 *
 * NO NAME ON IT. `setByPrincipalId` is the principal from the token, never a
 * typed name (§3a rule 1, VISIT-CHECKLIST.md §7 rule 4). A screen that wants to
 * say who set it joins on the principal; a record that carried the name would
 * be a name somebody could type.
 */
export interface VisitStateRecord {
  readonly state: string;
  /** Which version of `visit-states.json` this was chosen from (hard rule 14). */
  readonly statesVersion: string;
  readonly setByPrincipalId: string;
  readonly setByPrincipalType: string;
  /** ISO 8601. */
  readonly setAt: string;
}

/**
 * WHERE A VISIT HAS GOT TO — the newest record, or the starting state.
 *
 * THE NEWEST WINS AND THE OLDER ONES SURVIVE. That is the whole of §3a rule 6:
 * *"A wrong state is corrected, and the correction is kept beside the original
 * rather than over it."* A caller asking "what is it now" gets one answer; a
 * caller asking "what has been said about this visit" gets all of them.
 *
 * TIES GO TO THE LAST ONE GIVEN. Two records in the same millisecond is a race
 * between two people at two screens; the reader's own order is as good an
 * answer as any, and there is no third fact to break it with.
 */
export function latestVisitState(
  /*
   * ONLY THE TWO FACTS IT READS. A reader asking "where has this got to" has
   * no business being handed the principal who said so, and a signature that
   * demanded one would push callers into fetching it — which is how a
   * principal id ends up on a screen that never needed it.
   */
  records: readonly Pick<VisitStateRecord, 'state' | 'setAt'>[],
): string {
  let latest: Pick<VisitStateRecord, 'state' | 'setAt'> | undefined;
  for (const record of records) {
    if (!latest || Date.parse(record.setAt) >= Date.parse(latest.setAt)) latest = record;
  }
  return latest?.state ?? DEFAULT_VISIT_STATE;
}

/**
 * MAY THIS PERSON SET A STATE ON THIS VISIT (§3a rule 2)?
 *
 * *"A practitioner may set a state only on their own patients. Reception may
 * set any. Cross-practitioner and cross-practice writes fail closed."*
 *
 * "THEIR OWN" MEANS THE PATIENT CAME TO SEE THEM, not that the claim goes under
 * them (ARRIVAL-WHO-IS-SEEN.md §2). A nurse marks the patient who came to see
 * the nurse, even though the agreement is anchored on the supervising provider;
 * the GP does not, because that patient is not in front of them. `seeing` is
 * therefore `Arrival.seeingAffiliationId`, the same field the list is grouped
 * by, so what a practitioner can SEE and what they can SET are one answer and
 * cannot drift apart.
 *
 * CROSS-PRACTICE IS NOT THIS FUNCTION'S JOB AND MUST NOT BE. Practice scoping
 * is RLS at the database (ADR: practice scoping at the DB layer), and a
 * predicate here that also "checked the practice" would be a second, weaker
 * copy of it that somebody would one day trust instead. This is given only
 * affiliations the caller's own practice scope already returned.
 *
 * IT FAILS CLOSED. A practitioner with no affiliations, an arrival naming
 * nobody, an unrecognised scope — every one of them is `false`. The only path
 * to `true` is a positive match or a practice-scoped caller.
 */
export function maySetVisitState(input: {
  /** `mine` (a practitioner) or `practice` (reception, a manager, an administrator). */
  readonly scope: string;
  /** The affiliations this practitioner holds at this practice. Empty for practice staff. */
  readonly ownAffiliationIds: readonly string[];
  /** `Arrival.seeingAffiliationId` — who the patient came to see. */
  readonly seeingAffiliationId: string | null;
}): boolean {
  if (input.scope === 'practice') return true;
  if (input.scope !== 'mine') return false;
  if (!input.seeingAffiliationId) return false;
  return input.ownAffiliationIds.includes(input.seeingAffiliationId);
}

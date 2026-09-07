'use client';

/**
 * MY DETAILS — what each practice holds, and how to get it corrected.
 *
 * PER PRACTICE, AND THEY CAN DISAGREE. The PMS is the master of a patient's
 * details, so two practices genuinely hold two addresses for the same person
 * and neither is "wrong" from where it sits. The card says so in its lead
 * rather than quietly showing the first one it was given.
 *
 * AND FROM 5 SEPTEMBER 2026 IT SAYS WHERE THEY DISAGREE (Carl). Two blocks of
 * five fields, one of which differs, is a spot-the-difference puzzle set to
 * somebody who may be unwell and reading on a phone. The notice above the
 * blocks names the detail and the practices; the tag beside the value says
 * which block is the odd one, next to the link that fixes it. Neither prints a
 * value: both copies are already on screen a few centimetres below.
 *
 * THE COMPARISON IS NORMALISED, so "2 Example St" and "2 Example Street" are
 * one address (see `NORMALISE`). A reconciliation notice that fired on
 * punctuation would be a notice patients learn to ignore, and it would send
 * them to reception about a difference that does not exist.
 *
 * A REQUEST, NEVER AN EDIT. There is no input on this card. The patient says
 * "this one is wrong"; the practice that owns the record confirms the right
 * value with them and changes it, which is the APP 13 shape — correction routed
 * to the record owner — and also the only shape that keeps the PMS the master.
 * Nothing is sent but the practice, the field, and the fact.
 *
 * IT CAN ONLY RENDER SIX NAMED FIELDS (hard rule 1, REQ-VER-02). `FIELDS` below
 * is the whole of what this card knows how to draw; a payload that grew a
 * Medicare number — or anything else — would find nothing here that reads it.
 * That is structural, not a filter, and `portal_details_never_show_medicare`
 * holds it there. The reconciliation reads `FIELDS` too, so it can no more
 * compare a Medicare number than the card can draw one.
 */

import { useState } from 'react';
import type { ConfirmableDetailType } from '@aobplatform/domain';
import type { PortalDetails } from '../api';
import { strings } from '../../../strings';
import { calendarDate } from '../format';
import { Card, CardState, ConfirmDialog, PortalButton, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

/**
 * THE FIVE CORRECTABLE DETAILS, in the order a person recognises themselves in.
 *
 * Three of them (name, date of birth, address) are also approved identity
 * identifiers; two (mobile, email) are contact details and are NOT identifiers,
 * however tempting the symmetry (REQ-VER-02). This card treats all five the
 * same because it is a data-accuracy surface, not a verification one — nothing
 * here proves anything about who is reading.
 */
const FIELDS: ReadonlyArray<{
  readonly type: ConfirmableDetailType;
  readonly label: string;
  readonly read: (d: PortalDetails) => string;
}> = [
  { type: 'name', label: strings.portal.details.name, read: (d) => `${d.givenNames} ${d.familyName}`.trim() },
  { type: 'date_of_birth', label: strings.portal.details.dateOfBirth, read: (d) => calendarDate(d.dateOfBirth) },
  { type: 'address', label: strings.portal.details.address, read: (d) => d.address },
  { type: 'mobile', label: strings.portal.details.mobile, read: (d) => d.mobile },
  { type: 'email', label: strings.portal.details.email, read: (d) => d.email },
];

// ---------------------------------------------------------------------------
// Normalising, so a cosmetic difference is not reported as a real one
// ---------------------------------------------------------------------------

/**
 * THE AUSTRALIAN STREET-TYPE ABBREVIATIONS, copied deliberately rather than
 * imported.
 *
 * `apps/core/src/verification/identifier-matching.ts` holds the authoritative
 * copy and the same map, but that module is server code: it imports node's
 * `crypto` for the constant-time comparison an identity check needs, so pulling
 * it in here would pull a verification routine — and its timing discipline —
 * into a browser bundle that has no business with either.
 *
 * THE RULES ARE THE SAME AND MUST STAY THE SAME: case-folded, punctuation to
 * spaces, these abbreviations expanded. State abbreviations are deliberately
 * absent from the map on both sides ("nsw" stays "nsw"), because expanding them
 * would only add a second spelling to get wrong.
 *
 * THIS COMPARISON IS NOT A VERIFICATION. Nothing here proves anything about who
 * is reading; it decides whether to draw a sentence. So it is whole-token
 * equality rather than the server's containment rule, and there is no timing
 * property to preserve — neither value was typed by whoever is holding the
 * phone.
 */
const ADDRESS_ABBREVIATIONS: Readonly<Record<string, string>> = {
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  cres: 'crescent',
  pl: 'place',
  dr: 'drive',
  ct: 'court',
  hwy: 'highway',
  tce: 'terrace',
  pde: 'parade',
  bvd: 'boulevard',
  blvd: 'boulevard',
  ln: 'lane',
  cl: 'close',
  unit: 'unit',
  u: 'unit',
};

/** Trim, case-fold, collapse runs of whitespace. The floor under every field. */
function plain(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Address: punctuation to spaces, then the abbreviations expanded token by token. */
function addressKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((token) => ADDRESS_ABBREVIATIONS[token] ?? token)
    .join(' ');
}

/**
 * Mobile: the spaces and punctuation people put in phone numbers come out, so
 * "0400 000 001" and "0400000001" are one number.
 *
 * A `+61` FORM AND A LEADING-ZERO FORM ARE NOT RECONCILED, and that is on
 * purpose: guessing a dialling plan is inventing a fact about somebody's own
 * number, and the two practices really may hold two different things. This
 * notice is a prompt to look, never an assertion that one copy is wrong.
 */
function mobileKey(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

const NORMALISE: Readonly<Record<ConfirmableDetailType, (value: string) => string>> = {
  name: plain,
  date_of_birth: plain,
  address: addressKey,
  mobile: mobileKey,
  email: plain,
};

// ---------------------------------------------------------------------------
// What differs, and between whom
// ---------------------------------------------------------------------------

/** One practice's block, keyed as the card keys it. */
type Block = { readonly key: string; readonly practice: PortalDetails };

/**
 * FOR ONE FIELD: every block that holds a value, with its normalised form.
 *
 * A BLANK IS NOT A DIFFERENCE. One practice holding an email and another
 * holding none is a gap, not a disagreement — "one has one email, the other has
 * another" would be false, and there is nothing here for the patient to
 * reconcile. Only blocks that hold something are compared.
 */
function comparable(blocks: readonly Block[], field: (typeof FIELDS)[number]) {
  return blocks
    .map((block) => ({ block, raw: field.read(block.practice) }))
    .filter((entry) => entry.raw.trim().length > 0)
    .map((entry) => ({ ...entry, normalised: NORMALISE[field.type](entry.raw) }));
}

type Asking = {
  readonly practiceId: string;
  readonly practiceName: string;
  readonly type: ConfirmableDetailType;
  readonly label: string;
};

export function DetailsCard({
  state,
  onRequestCorrection,
}: {
  state: Loadable<readonly PortalDetails[]>;
  onRequestCorrection: (practiceId: string, fieldType: ConfirmableDetailType) => Promise<void>;
}) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState(false);
  /** `${practiceId}:${type}` for every field already asked about, this session. */
  const [asked, setAsked] = useState<readonly string[]>([]);

  const confirm = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await onRequestCorrection(asking.practiceId, asking.type);
      setAsked((prev) => [...prev, `${asking.practiceId}:${asking.type}`]);
    } finally {
      setBusy(false);
      setAsking(null);
    }
  };

  // ONE ACCOUNT CAN HOLD TWO RECORDS AT THE SAME PRACTICE (a test account did,
  // 4 Sep 2026), so the practice id alone is not a key.
  const blocks: readonly Block[] =
    state.status === 'ready'
      ? state.data.map((practice) => ({
          key: `${practice.practiceId}:${practice.patientRecordNumber}`,
          practice,
        }))
      : [];

  /**
   * THE WHOLE COMPARISON, ONCE. One entry per field two practices disagree
   * about, carrying the sentence for the notice and, per block, who that block
   * differs from. With fewer than two blocks there is nothing to compare and
   * this is empty — which is `portal_single_practice_shows_no_reconciliation`,
   * and is also what the practice filter leaves behind when it narrows the
   * page to one practice.
   */
  const differences =
    blocks.length < 2
      ? []
      : FIELDS.flatMap((field) => {
          const entries = comparable(blocks, field);
          const distinct = new Set(entries.map((entry) => entry.normalised));
          if (distinct.size < 2) return [];

          const names = entries.map((entry) => entry.block.practice.practiceName);
          return [
            {
              field,
              /*
               * TWO PRACTICES GET THE SENTENCE THE PATIENT NEEDS; three or more
               * get a weaker one, because "each holds a different address" is
               * untrue when two of the three agree, and spelling out which two
               * agree is not a sentence anybody wants to read on a phone.
               */
              line:
                names.length === 2
                  ? strings.portal.details.differPair(field.label, names[0], names[1])
                  : strings.portal.details.differMany(
                      field.label,
                      `${names.slice(0, -1).join(', ')} ${strings.portal.details.differAnd} ${names[names.length - 1]}`,
                    ),
              /** Block key → the practices holding a different value from this one. */
              othersByBlock: new Map(
                entries.map((entry) => [
                  entry.block.key,
                  entries
                    .filter(
                      (other) => other.block.key !== entry.block.key && other.normalised !== entry.normalised,
                    )
                    .map((other) => other.block.practice.practiceName),
                ]),
              ),
            },
          ];
        });

  return (
    <Card id="portal-details" title={strings.portal.details.heading} lead={strings.portal.details.lead}>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.details.empty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.details.empty} />
      ) : (
        <>
          {differences.length > 0 && (
            /*
             * ABOVE THE BLOCKS, because it is the reason they disagree. No
             * `role="status"`: it is part of the card's content and is read in
             * order, and a live region would announce it over whatever a screen
             * reader was already saying about the eight other cards arriving at
             * the same moment.
             */
            <div className={styles.reconcile} data-testid="portal-details-reconciliation">
              <p className={styles.reconcileTitle}>{strings.portal.details.differHeading}</p>
              <ul className={styles.reconcileList}>
                {differences.map((difference) => (
                  <li key={difference.field.type}>{difference.line}</li>
                ))}
              </ul>
            </div>
          )}
          {blocks.map((block) => (
            <div key={block.key}>
              <h3 className={styles.groupTitle}>{block.practice.practiceName}</h3>
              <ul className={styles.rows}>
                {FIELDS.map((field) => {
                  const value = field.read(block.practice);
                  const key = `${block.practice.practiceId}:${field.type}`;
                  const others =
                    differences.find((difference) => difference.field.type === field.type)?.othersByBlock.get(
                      block.key,
                    ) ?? [];
                  return (
                    <li className={styles.row} key={field.type}>
                      <span className={styles.rowMain}>
                        <span className={styles.rowLabel}>{field.label}</span>
                        <span
                          className={styles.rowValue}
                          data-testid={`detail-${block.practice.practiceId}-${field.type}`}
                        >
                          {value || strings.portal.details.notHeld}
                        </span>
                        {others.length > 0 && (
                          /*
                           * THE TAG SITS WITH THE VALUE AND THE LINK, so the
                           * patient asks the practice holding the stale copy
                           * without going looking for where to say so (Carl,
                           * 4 Sep 2026: "shortcuts to the answer"). It says
                           * who, never what — the other copy is one glance
                           * away.
                           */
                          <span
                            className={styles.differsTag}
                            data-testid={`detail-${block.practice.practiceId}-${field.type}-differs`}
                          >
                            {others.length === 1
                              ? strings.portal.details.differsFrom(others[0])
                              : strings.portal.details.differsFromSeveral(others.length)}
                          </span>
                        )}
                      </span>
                      {asked.includes(key) ? (
                        // Said once, and it stays said: the reassurance is the
                        // answer to "did that go anywhere", so replacing the
                        // button with it is the whole of the feedback.
                        <span className={styles.rowMeta} role="status">
                          {strings.portal.details.asked}
                        </span>
                      ) : (
                        <PortalButton
                          variant="quiet"
                          onClick={() =>
                            setAsking({
                              practiceId: block.practice.practiceId,
                              practiceName: block.practice.practiceName,
                              type: field.type,
                              label: field.label,
                            })
                          }
                        >
                          {strings.portal.details.correctAction}
                        </PortalButton>
                      )}
                    </li>
                  );
                })}
                {/*
                  THE PRACTICE'S OWN RECORD NUMBER, shown and not correctable: it
                  is the practice's identifier for the record, not a fact about
                  the person, and a patient asking to change it would be asking
                  for something nobody can give them. It is never reconciled
                  either — two practices holding two different record numbers for
                  the same person is how record numbers work.
                */}
                <li className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowLabel}>{strings.portal.details.recordNumber}</span>
                    <span className={styles.rowValue}>
                      {block.practice.patientRecordNumber || strings.portal.details.notHeld}
                    </span>
                  </span>
                </li>
              </ul>
            </div>
          ))}
        </>
      )}

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={strings.portal.details.confirmTitle}
        confirmLabel={strings.portal.details.confirmAction}
        onConfirm={confirm}
        busy={busy}
      >
        <p>{asking ? strings.portal.details.confirmBody(asking.label, asking.practiceName) : ''}</p>
        <p>{strings.portal.details.confirmNote}</p>
      </ConfirmDialog>
    </Card>
  );
}

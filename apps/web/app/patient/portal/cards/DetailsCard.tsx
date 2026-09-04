'use client';

/**
 * MY DETAILS — what each practice holds, and how to get it corrected.
 *
 * PER PRACTICE, AND THEY CAN DISAGREE. The PMS is the master of a patient's
 * details, so two practices genuinely hold two addresses for the same person
 * and neither is "wrong" from where it sits. The card says so in its lead
 * rather than quietly showing the first one it was given.
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
 * holds it there.
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

type Asking = { readonly practiceId: string; readonly practiceName: string; readonly type: ConfirmableDetailType; readonly label: string };

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

  return (
    <Card id="portal-details" title={strings.portal.details.heading} lead={strings.portal.details.lead}>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.details.empty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.details.empty} />
      ) : (
        state.data.map((practice) => (
          <div key={practice.practiceId}>
            <h3 className={styles.groupTitle}>{practice.practiceName}</h3>
            <ul className={styles.rows}>
              {FIELDS.map((field) => {
                const value = field.read(practice);
                const key = `${practice.practiceId}:${field.type}`;
                return (
                  <li className={styles.row} key={field.type}>
                    <span className={styles.rowMain}>
                      <span className={styles.rowLabel}>{field.label}</span>
                      <span className={styles.rowValue} data-testid={`detail-${practice.practiceId}-${field.type}`}>
                        {value || strings.portal.details.notHeld}
                      </span>
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
                            practiceId: practice.practiceId,
                            practiceName: practice.practiceName,
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
                for something nobody can give them.
              */}
              <li className={styles.row}>
                <span className={styles.rowMain}>
                  <span className={styles.rowLabel}>{strings.portal.details.recordNumber}</span>
                  <span className={styles.rowValue}>{practice.patientRecordNumber || strings.portal.details.notHeld}</span>
                </span>
              </li>
            </ul>
          </div>
        ))
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

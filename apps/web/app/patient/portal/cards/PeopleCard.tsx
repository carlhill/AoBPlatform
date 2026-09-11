'use client';

/**
 * PEOPLE WHO ACT FOR ME, AND PEOPLE I ACT FOR (REQ-PORT-07, FR-1.19/-1.23).
 *
 * BOTH DIRECTIONS ON ONE CARD because they are one question — "who else is
 * involved in my bulk-billing record" — and separating them would hide from a
 * carer that they appear in somebody else's list too.
 *
 * REMOVE ASKS FOR NO REASON, AND SAYS SO. Withdrawing somebody's authority to
 * act is the patient's to do at any time, with no justification; a "why?" field
 * would be the platform asking a person to account for a decision that is
 * entirely theirs, and in the cases that matter most — a relationship that has
 * gone wrong — it would be actively unsafe.
 *
 * THE OTHER LIST HAS NO CONTROLS. A person cannot remove themselves from acting
 * for somebody else here: that authority was recorded with the practice that
 * holds the patient's record, and unpicking it is that practice's act, not a
 * button on a page belonging to a different person.
 *
 * THE RELATIONSHIP WORD COMES FROM THE VERSIONED LIST. The wire carries a key
 * from `packages/domain/content/assignor-relationships.json`; the words live in
 * the string table, and a key with no word shows as itself (hard rule 14).
 */

import { useState } from 'react';
import type { PortalAssignors } from '../api';
import { strings } from '../../../strings';
import { calendarDate } from '../format';
import { Card, CardState, ConfirmDialog, PortalButton, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

export function PeopleCard({
  state,
  onRevoke,
}: {
  state: Loadable<PortalAssignors>;
  onRevoke: (assignorId: string) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<{ assignorId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<readonly string[]>([]);

  const confirm = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await onRevoke(removing.assignorId);
      setRemoved((prev) => [...prev, removing.assignorId]);
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <Card id="portal-people" title={strings.portal.people.heading} lead={strings.portal.people.lead}>
      <h3 className={styles.groupTitle}>{strings.portal.people.actsForMeHeading}</h3>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.people.actsForMeEmpty} />
      ) : state.data.actsForMe.length === 0 ? (
        <CardState state="empty" empty={strings.portal.people.actsForMeEmpty} />
      ) : (
        <ul className={styles.rows}>
          {state.data.actsForMe.map((person) => (
            <li className={styles.row} key={person.assignorId}>
              <span className={styles.rowMain}>
                <span className={styles.rowValue}>{person.name}</span>
                <span className={styles.rowMeta}>
                  {strings.portal.people.relationshipNames[person.relationshipKey] ?? (
                    <code className={styles.unmappedKey}>{person.relationshipKey}</code>
                  )}{' '}
                  · {strings.portal.people.since(calendarDate(person.since))}
                </span>
              </span>
              {removed.includes(person.assignorId) || !person.active ? (
                <span className={styles.rowMeta} role="status">
                  {strings.portal.people.removed}
                </span>
              ) : (
                <PortalButton onClick={() => setRemoving({ assignorId: person.assignorId, name: person.name })}>
                  {strings.portal.people.removeAction}
                </PortalButton>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.groupTitle}>{strings.portal.people.iActForHeading}</h3>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.people.iActForEmpty} />
      ) : state.data.iActFor.length === 0 ? (
        <CardState state="empty" empty={strings.portal.people.iActForEmpty} />
      ) : (
        <ul className={styles.rows}>
          {state.data.iActFor.map((patient) => (
            <li className={styles.row} key={patient.patientId}>
              <span className={styles.rowMain}>
                <span className={styles.rowValue}>{patient.givenNames}</span>
                <span className={styles.rowMeta}>
                  {patient.practiceName} · {strings.portal.people.since(calendarDate(patient.since))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={strings.portal.people.confirmTitle}
        confirmLabel={strings.portal.people.confirmAction}
        onConfirm={confirm}
        busy={busy}
      >
        <p>{removing ? strings.portal.people.confirmBody(removing.name) : ''}</p>
        <p>{strings.portal.people.confirmNoReason}</p>
      </ConfirmDialog>
    </Card>
  );
}

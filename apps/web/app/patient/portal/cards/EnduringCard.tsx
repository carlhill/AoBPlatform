'use client';

/**
 * ONGOING BULK-BILLING AGREEMENTS, and the one control on this page the
 * statute puts here (REQ-PORT-03/-05, REQ-END-06, FR-5.3).
 *
 * PER PROVIDER, NEVER PER PRACTICE (hard rule 6, REQ-END-01). An enduring
 * agreement is practitioner × patient; a patient at a ten-doctor practice may
 * hold one with one of them and none with the other nine, and a card that said
 * "your agreement with Wattle Street Medical" would be telling them something
 * untrue about nine doctors.
 *
 * THE PATIENT MAY END IT EVEN WHERE SOMEBODY ELSE ENTERED IT FOR THEM
 * (65CA(7)(b), REQ-END-06). So this control is not conditional on being the
 * assignor, and there is deliberately no field asking why.
 *
 * TWO BUSINESS DAYS, AND A WRITTEN NOTICE. Both come from the regulation, not
 * from a designer: the agreement ends two business days after written notice,
 * and the notice is generated and delivered by the server. The dialog says both
 * before anything happens, and the row then shows the date the server returned
 * rather than claiming the agreement is already over — because for two more
 * days it is not.
 *
 * IT IS OFFERED FOR NOTHING ELSE. This card is handed enduring agreements and
 * only enduring agreements; the agreements card has no termination control at
 * all. Ending a signed episodic agreement is not a thing that exists.
 */

import { useState } from 'react';
import type { PortalEnduring, PortalTermination } from '../api';
import { strings } from '../../../strings';
import { calendarDate, instant } from '../format';
import { Card, CardState, ConfirmDialog, PortalButton, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

export function EnduringCard({
  state,
  onTerminate,
}: {
  state: Loadable<readonly PortalEnduring[]>;
  onTerminate: (agreementId: string) => Promise<PortalTermination>;
}) {
  const [ending, setEnding] = useState<PortalEnduring | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** agreementId → when it stops, as the server answered it. */
  const [ended, setEnded] = useState<Readonly<Record<string, string>>>({});

  const confirm = async () => {
    if (!ending) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await onTerminate(ending.agreementId);
      setEnded((prev) => ({ ...prev, [ending.agreementId]: result.effectiveAt }));
      setEnding(null);
    } catch {
      // The dialog stays open and says so: closing it would leave the patient
      // unsure whether the most consequential control on the page had fired.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="portal-enduring" title={strings.portal.enduring.heading} lead={strings.portal.enduring.lead}>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.enduring.empty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.enduring.empty} />
      ) : (
        <ul className={styles.rows}>
          {state.data.map((agreement) => {
            const stops = ended[agreement.agreementId];
            return (
              <li className={styles.row} key={agreement.agreementId}>
                <span className={styles.rowMain}>
                  <span className={styles.rowValue}>
                    {agreement.providerName} — {agreement.practiceName}
                  </span>
                  <span className={styles.rowMeta}>
                    {strings.portal.enduring.activeSince(calendarDate(agreement.activeSince))}
                  </span>
                  {/* The plain-language explanation REQ-PORT-03 asks for, said
                      in the words of the obligation itself (REQ-END-06a). */}
                  <span className={styles.rowMeta}>{strings.portal.enduring.coverage(agreement.providerName)}</span>
                </span>
                {stops ? (
                  <span className={styles.rowMeta} role="status">
                    {strings.portal.enduring.endsOn(instant(stops))}
                  </span>
                ) : (
                  <PortalButton onClick={() => setEnding(agreement)}>{strings.portal.enduring.endAction}</PortalButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEnding(null);
            setFailed(false);
          }
        }}
        title={strings.portal.enduring.confirmTitle}
        confirmLabel={strings.portal.enduring.confirmAction}
        onConfirm={confirm}
        busy={busy}
      >
        <p>{ending ? strings.portal.enduring.confirmBody(ending.providerName) : ''}</p>
        <p>{strings.portal.enduring.confirmTiming}</p>
        <p>{strings.portal.enduring.confirmNotice}</p>
        {/* Care is never blocked by anything on this page (hard rule 8). */}
        <p>{strings.portal.enduring.confirmCare}</p>
        {failed && (
          <p className={styles.cardError} role="alert">
            {strings.portal.enduring.confirmFailed}
          </p>
        )}
      </ConfirmDialog>
    </Card>
  );
}

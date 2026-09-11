'use client';

/**
 * MY AGREEMENTS — every bulk-billing agreement this person is party to
 * (REQ-PORT-01/-02).
 *
 * NO AMOUNT. NOT ANYWHERE ON THIS CARD (hard rule 4, REQ-REG-04). A benefit
 * amount is not in the s 65C data set and putting one on an agreement artefact
 * is the risk this product exists to remove; the reg 89AA notices card is the
 * one place in the product where money appears, and it is deliberately a
 * different card so the two can never bleed into one another. This card renders
 * from a fixed list of fields, so a payload that grew an amount would find
 * nothing here that reads it — `portal_agreements_show_no_amount` holds it.
 *
 * "VIEW AS SIGNED" IS A LINK TO THE SERVER, not a render in the browser. The
 * agreement was rendered once, server-side, and hashed at render; the server
 * re-verifies that hash on the way out (hard rule 13). A second render path in
 * a browser would be a second answer to "what did they sign", which is the one
 * question this product must never have two answers to.
 */

import type { PortalAgreement } from '../api';
import { artefactUrl } from '../api';
import { strings } from '../../../strings';
import { calendarDate, instant } from '../format';
import { Card, CardState, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

/** A key with no copy shows as itself rather than as nothing (Carl, 4 Sep 2026). */
function label(map: Readonly<Record<string, string>>, key: string): React.ReactNode {
  return map[key] ?? <code className={styles.unmappedKey}>{key}</code>;
}

export function AgreementsCard({ state }: { state: Loadable<readonly PortalAgreement[]> }) {
  return (
    <Card id="portal-agreements" title={strings.portal.agreements.heading} lead={strings.portal.agreements.lead}>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.agreements.empty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.agreements.empty} />
      ) : (
        <ul className={styles.rows}>
          {state.data.map((agreement) => (
            <li className={styles.row} key={agreement.id}>
              <span className={styles.rowMain}>
                <span className={styles.rowValue}>
                  {agreement.providerName} — {agreement.practiceName}
                </span>
                <span className={styles.rowMeta}>
                  {/*
                    WHEN IT WAS SIGNED where we know, and the service date where
                    the agreement is for one visit. An unsigned agreement says
                    neither — it says it is still waiting, which is the honest
                    answer and the one that matches the messages card.
                  */}
                  {agreement.signedAt
                    ? strings.portal.agreements.signedOn(instant(agreement.signedAt))
                    : strings.portal.agreements.notSignedYet}
                  {agreement.serviceDate
                    ? ` · ${strings.portal.agreements.serviceOn(calendarDate(agreement.serviceDate))}`
                    : ''}
                </span>
                <span className={styles.rowMeta}>
                  {label(strings.portal.agreements.types, agreement.type)}
                  {' · '}
                  {agreement.serviceDescription || strings.portal.agreements.noServiceDescription}
                  {' · '}
                  {label(strings.portal.agreements.channels, agreement.channel)}
                  {' · '}
                  {label(strings.portal.agreements.statuses, agreement.status)}
                </span>
              </span>
              {agreement.artefactAvailable && (
                // A new tab, so the page they are reading is not replaced by a
                // PDF viewer they then have to find their way back out of.
                <a
                  className={styles.detailLink}
                  href={artefactUrl(agreement.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {strings.portal.agreements.viewAction}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

'use client';

/**
 * MESSAGES SENT TO ME — and the structural answer to phishing (REQ-PORT-06).
 *
 * THE STRIP AT THE TOP IS THE POINT OF THE CARD. Somebody has just had a text
 * saying a practice wants them to sign something, and every instinct they have
 * been taught says do not tap that. The answer is not a reassuring sentence in
 * the text message — a forger writes those too — it is a place they reach
 * THEMSELVES, by their own route, where the genuine request is listed. So the
 * things still waiting for them come first, in their own highlighted region,
 * with the sentence that makes the check usable: if it is listed here, it came
 * from your practice through us.
 *
 * NO MESSAGE BODIES, EVER. That a message was sent, on which channel, when, and
 * what it was for. The body is a copy of something the patient already has and
 * putting one here would make this page worth phishing in its own right.
 *
 * A PURPOSE OR CHANNEL WITH NO COPY SHOWS AS ITS OWN KEY rather than as a blank
 * — an unmapped code you can read out to support beats a row that says nothing
 * (Carl, 4 Sep 2026).
 */

import type { PortalMessage } from '../api';
import { strings } from '../../../strings';
import { instant } from '../format';
import { Card, CardState, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

function label(map: Readonly<Record<string, string>>, key: string): React.ReactNode {
  return map[key] ?? <code className={styles.unmappedKey}>{key}</code>;
}

function Row({ message }: { message: PortalMessage }) {
  return (
    <li className={styles.row}>
      <span className={styles.rowMain}>
        <span className={styles.rowValue}>
          {label(strings.portal.messages.purposes, message.purposeKey)} — {message.practiceName}
        </span>
        <span className={styles.rowMeta}>
          {label(strings.portal.messages.channels, message.channel)} · {instant(message.sentAt)} ·{' '}
          {label(strings.portal.messages.states, message.state)}
        </span>
      </span>
    </li>
  );
}

export function MessagesCard({ state }: { state: Loadable<readonly PortalMessage[]> }) {
  const pending = state.status === 'ready' ? state.data.filter((m) => m.pending) : [];
  const rest = state.status === 'ready' ? state.data.filter((m) => !m.pending) : [];

  return (
    <Card id="portal-messages" title={strings.portal.messages.heading} lead={strings.portal.messages.lead}>
      {pending.length > 0 && (
        // A region with its own accessible name, so a screen reader can be
        // taken straight to it — this is the part somebody navigated here for.
        <div className={styles.waiting} role="region" aria-labelledby="portal-messages-waiting">
          <p className={styles.waitingTitle} id="portal-messages-waiting">
            {strings.portal.messages.waitingHeading}
          </p>
          <ul className={styles.rows}>
            {pending.map((message) => (
              <Row key={message.id} message={message} />
            ))}
          </ul>
          <p className={styles.waitingNote}>{strings.portal.messages.genuineQuestion}</p>
          <p className={styles.waitingNote}>{strings.portal.messages.genuineAnswer}</p>
        </div>
      )}

      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.messages.empty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.messages.empty} />
      ) : rest.length === 0 ? null : (
        <ul className={styles.rows}>
          {rest.map((message) => (
            <Row key={message.id} message={message} />
          ))}
        </ul>
      )}
    </Card>
  );
}

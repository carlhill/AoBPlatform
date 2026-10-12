'use client';

/**
 * SIGN-IN AND SECURITY — FR-8.2's passkey half, on the patient's own page
 * (Carl, 4 September 2026: "Implement"; D-2026-09-04-02).
 *
 * THE CARD IS AN OFFER, NOT A SETUP STEP, and every line of it has to read that
 * way. Portal access is never a precondition of anything (REQ-PORT-08): a
 * patient who ignores this card forever loses nothing, and one who came here
 * worried about a text message must not conclude that they now have an account
 * to look after. So the offer says "optional" before it says "add", and the
 * removal warning explains what happens next rather than trying to talk anybody
 * out of it.
 *
 * "PASSKEY" IS THE ONLY JARGON, and it is unavoidable — it is the word the
 * patient's own phone puts in the prompt, so calling it something friendlier
 * here would teach a term that appears nowhere else in the ceremony. Around it:
 * face, fingerprint, PIN, phone.
 *
 * IT DISAPPEARS ON A BROWSER THAT CANNOT DO IT, rather than offering a button
 * that explains itself only after being pressed. Older browsers are
 * over-represented among the people this page is for, and a dead control on a
 * page somebody came to for reassurance is worse than no control.
 *
 * NOTHING IS PERSISTED IN THE BROWSER. No storage API is touched, no response
 * is logged, and the credential itself lives in the phone's own secure store —
 * the platform's, not ours.
 */

import { useState } from 'react';
import type { PortalPasskey } from '../api';
import { strings } from '../../../strings';
import { instant } from '../format';
import { Card, CardState, ConfirmDialog, PortalButton, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

export function PasskeysCard({
  state,
  supported,
  onAdd,
  onRemove,
}: {
  state: Loadable<readonly PortalPasskey[]>;
  /** Whether this browser can do WebAuthn at all. Decided by the page, not here. */
  supported: boolean;
  onAdd: (label: string) => Promise<void>;
  onRemove: (passkeyId: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const [removing, setRemoving] = useState<PortalPasskey | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);

  const copy = strings.portal.passkeys;
  const passkeys = state.status === 'ready' ? state.data : [];

  const add = async () => {
    setAddFailed(false);
    setAdding(true);
    try {
      await onAdd(label);
      setLabel('');
    } catch {
      /*
       * THE SERVER'S SENTENCE IS NEVER SHOWN AND NEVER LOGGED — the same rule
       * every card on this page follows. A cancelled prompt and a refused
       * verification look identical to the patient, which is right: both mean
       * "nothing changed, try again".
       */
      setAddFailed(true);
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveFailed(false);
    setRemoveBusy(true);
    try {
      await onRemove(removing.id);
      setRemoving(null);
    } catch {
      setRemoveFailed(true);
      setRemoving(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <Card id="portal-passkeys" title={copy.heading} lead={copy.lead}>
      <div className={styles.prose}>
        <p>{copy.whatItIs}</p>
        <p>{copy.whereItLives}</p>
        <p>
          <strong>{copy.optional}</strong>
        </p>
      </div>

      {!supported ? (
        <p className={styles.cardQuiet}>{copy.unsupported}</p>
      ) : (
        <>
          {state.status !== 'ready' ? (
            <CardState state={state.status} empty={copy.empty} />
          ) : passkeys.length === 0 ? (
            <CardState state="empty" empty={copy.empty} />
          ) : (
            <ul className={styles.rows}>
              {passkeys.map((passkey) => (
                <li className={styles.row} key={passkey.id}>
                  <span className={styles.rowMain}>
                    {/* A device the patient did not name gets a neutral word, never
                        one invented from a user agent string. */}
                    <span className={styles.rowValue}>{passkey.label ?? copy.unnamed}</span>
                    <span className={styles.rowMeta}>
                      {copy.added(instant(passkey.createdAt))} ·{' '}
                      {passkey.lastUsedAt ? copy.lastUsed(instant(passkey.lastUsedAt)) : copy.neverUsed}
                    </span>
                  </span>
                  <PortalButton onClick={() => setRemoving(passkey)}>{copy.removeAction}</PortalButton>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.addPasskey}>
            <label className={styles.fieldLabel} htmlFor="portal-passkey-label">
              {copy.labelLabel}
            </label>
            <input
              id="portal-passkey-label"
              className={styles.field}
              value={label}
              placeholder={copy.labelPlaceholder}
              maxLength={60}
              onChange={(event) => setLabel(event.target.value)}
            />
            <PortalButton variant="primary" onClick={add} disabled={adding}>
              {adding ? copy.addBusy : copy.addAction}
            </PortalButton>
          </div>

          {addFailed && (
            <p className={styles.cardError} role="alert">
              {copy.addFailed}
            </p>
          )}
          {removeFailed && (
            <p className={styles.cardError} role="alert">
              {copy.removeFailed}
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={copy.confirmTitle}
        confirmLabel={copy.confirmAction}
        onConfirm={confirmRemove}
        busy={removeBusy}
      >
        <p>{removing ? copy.confirmBody(removing.label ?? copy.unnamed) : ''}</p>
        {/*
         * THE LAST-ONE WARNING IS INFORMATION, NOT A REFUSAL. Removing every
         * passkey is allowed (REQ-PORT-08) and the route back is a fresh
         * invitation from the practice — which the sentence says, so nobody has
         * to guess or ring us to find out.
         */}
        {passkeys.length === 1 && <p>{copy.lastOne}</p>}
      </ConfirmDialog>
    </Card>
  );
}

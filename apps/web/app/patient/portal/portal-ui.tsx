'use client';

/**
 * The portal's own small vocabulary: a card, a confirm dialog, and the three
 * things a card can be while it waits for the server.
 *
 * WHY A CARD RATHER THAN `Section` FROM `app/ui`. `Section` is numbered — it is
 * a step in a console workflow. These are not steps; they are nine independent
 * answers to "what do you hold about me", each of which loads, fails and
 * refreshes on its own. A failed card says so INSIDE ITSELF and the other eight
 * still answer; one shared error state would blank the page, and the page is
 * the point.
 *
 * THE DIALOG IS RADIX'S. Focus trap, Escape, `aria-modal` and the labelled
 * title come with it (CLAUDE.md §4 — WCAG 2.2 AA is a requirement and a
 * hand-rolled dialog is where that quietly fails). `BlockingRefusal` in
 * `app/ui` is the same primitive, but its grammar is *stop, you cannot* — these
 * dialogs ask *are you sure*, which is a different thing and must not borrow
 * the refusal's voice.
 */

import * as RadixDialog from '@radix-ui/react-dialog';
import { ui } from '../../ui';
import { strings } from '../../strings';
import styles from './portal.module.css';

/**
 * A BUTTON WITH A 44px TARGET, which is why this is not `Button` from `app/ui`.
 *
 * The console's button is sized for a mouse at a desk; this page is read on a
 * phone by somebody who may be older, shaky, or holding a child. 44px is the
 * size named for patient surfaces (CLAUDE.md §6, WCAG 2.2), and the console's
 * `Button` overwrites any `className` passed to it, so it cannot be widened
 * from here without changing a component eight other surfaces use.
 */
export function PortalButton({
  variant = 'default',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'quiet' }) {
  const tone =
    variant === 'primary' ? styles.actionPrimary : variant === 'quiet' ? styles.actionQuiet : '';
  return <button {...rest} type={rest.type ?? 'button'} className={`${styles.action} ${tone}`} />;
}

/** What a card has been handed. `error` never carries a server message — see below. */
export type Loadable<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly data: T };

export function Card({
  id,
  title,
  lead,
  children,
}: {
  /** Anchors the heading so a "fix it here" link can land on the card itself. */
  id: string;
  title: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // `aria-labelledby` rather than `aria-label`, so the accessible name and the
    // visible heading cannot drift apart.
    <section className={styles.card} id={id} aria-labelledby={`${id}-heading`}>
      <h2 className={styles.cardTitle} id={`${id}-heading`}>
        {title}
      </h2>
      {lead && <p className={styles.cardLead}>{lead}</p>}
      {children}
    </section>
  );
}

/**
 * Loading, failed, or empty — the three answers that are not data.
 *
 * THE FAILURE MESSAGE IS OURS, NOT THE SERVER'S. A response body can carry a
 * rule name or a status line; neither helps the person reading, and a body
 * rendered into a patient-facing page is how a detail value eventually ends up
 * on screen. The sentence says what failed and that nothing else did.
 */
export function CardState({ state, empty }: { state: 'loading' | 'error' | 'empty'; empty: string }) {
  if (state === 'loading') {
    return (
      <p className={styles.cardQuiet} role="status">
        {strings.portal.loading}
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p className={styles.cardError} role="alert">
        {strings.portal.cardError}
      </p>
    );
  }
  return <p className={styles.cardQuiet}>{empty}</p>;
}

/**
 * ARE YOU SURE — for the three acts on this page that reach the server and
 * change something: asking for a correction, ending an enduring agreement, and
 * withdrawing somebody's authority.
 *
 * `confirmTone` is the only variation: ending an agreement and revoking an
 * authority deserve the primary weight; asking a practice to check a typo does
 * not. The words carry the meaning either way.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={ui.overlay} />
        <RadixDialog.Content className={ui.dialog}>
          <RadixDialog.Title className={ui.dialogTitle}>{title}</RadixDialog.Title>
          <RadixDialog.Description asChild>
            <div className={styles.dialogBody}>{children}</div>
          </RadixDialog.Description>
          <div className={ui.dialogActions}>
            <RadixDialog.Close asChild>
              <PortalButton>{strings.portal.common.cancel}</PortalButton>
            </RadixDialog.Close>
            <PortalButton variant="primary" onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </PortalButton>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

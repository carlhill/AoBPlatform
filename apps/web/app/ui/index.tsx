'use client';

/**
 * The shared UI vocabulary.
 *
 * Radix supplies BEHAVIOUR — focus trapping, keyboard navigation, aria wiring —
 * and this file supplies appearance. That division is the reason Radix is in
 * CLAUDE.md §4: WCAG 2.2 AA is a requirement, and a hand-rolled dialog is where
 * that requirement quietly fails.
 *
 * Two rules hold across everything here:
 *
 *   1. STATUS IS NEVER COLOUR ALONE. Every chip and every field error carries a
 *      word. "The red one" is not a specification, and roughly one man in
 *      twelve cannot use it.
 *   2. DEAD UNTIL VALID. A primary action is disabled until its payload is
 *      valid, rather than live-and-then-complaining. This mirrors the signature
 *      control, which cannot enable until the agreement passes the rules
 *      engine — signing a draft is the criminal offence in this regime
 *      (REQ-REG-06).
 */

import * as RadixLabel from '@radix-ui/react-label';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useId } from 'react';
import styles from './ui.module.css';

export { styles as ui };

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function Shell({
  nav,
  right,
  children,
}: {
  nav?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <span className={styles.wordmark}>AoBPlatform</span>
          {nav && <nav className={styles.nav}>{nav}</nav>}
          {right && <span className={styles.topbarRight}>{right}</span>}
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export function Section({
  number,
  title,
  aside,
  children,
}: {
  number: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        {/* Decorative: the heading already carries the name. */}
        <span className={styles.sectionNumber} aria-hidden="true">
          {number}
        </span>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // Both are announced, in that order: what went wrong, then what was asked for.
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <RadixLabel.Root className={`${styles.label} ${required ? styles.required : ''}`} htmlFor={id}>
        {label}
      </RadixLabel.Root>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error && (
        <p className={styles.fieldError} id={errorId}>
          {error}
        </p>
      )}
      {hint && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  id,
  describedBy,
  invalid,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { describedBy?: string; invalid?: boolean }) {
  return (
    <input
      {...rest}
      id={id}
      className={`${styles.input} ${invalid ? styles.inputInvalid : ''}`}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
    />
  );
}

export function SelectInput({
  id,
  describedBy,
  invalid,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { describedBy?: string; invalid?: boolean }) {
  // A native select, deliberately. Radix's Select is for when a native one
  // cannot do the job (rich options, grouping); for a short list of values the
  // native control is better on every axis that matters here — keyboard, screen
  // reader, mobile, and zero JavaScript.
  return (
    <select
      {...rest}
      id={id}
      className={`${styles.select} ${invalid ? styles.inputInvalid : ''}`}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
    >
      {children}
    </select>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  hint,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className={styles.checkboxRow}>
      <RadixCheckbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className={styles.checkbox}
      >
        <RadixCheckbox.Indicator>
          <svg className={styles.checkboxMark} viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 6.5L4.8 9.2L10 3.4" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div>
        <RadixLabel.Root className={styles.label} htmlFor={id}>
          {label}
        </RadixLabel.Root>
        {hint && <p className={styles.hint}>{hint}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = 'ok' | 'warn' | 'stop' | 'neutral';

const chipTone: Record<Tone, string> = {
  ok: styles.chipOk,
  warn: styles.chipWarn,
  stop: styles.chipStop,
  neutral: styles.chipNeutral,
};

/** The text IS the status. Colour only reinforces it. */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`${styles.chip} ${chipTone[tone]}`}>{children}</span>;
}

const noticeTone: Record<Exclude<Tone, 'neutral'>, string> = {
  ok: styles.noticeInfo,
  warn: styles.noticeWarn,
  stop: styles.noticeStop,
};

export function Notice({
  tone = 'warn',
  title,
  children,
}: {
  tone?: Exclude<Tone, 'neutral'>;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    // `alert` so a refusal is announced when it appears, not silently painted.
    <div className={`${styles.notice} ${noticeTone[tone]}`} role="alert">
      {title && <p className={styles.noticeTitle}>{title}</p>}
      <p className={styles.noticeBody}>{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocking refusal
// ---------------------------------------------------------------------------

/**
 * A modal, used ONLY for a blocking refusal.
 *
 * The design's refusal grammar has four forms and using the wrong one is the
 * likeliest mistake here: inline for a typo, BLOCKING for "the entity is
 * wrong", a dossier note for a judgement about an applicant, and an
 * attestation panel when a source is unreachable. A modal says *stop*; a
 * mistyped digit does not deserve one.
 */
export function BlockingRefusal({
  open,
  onOpenChange,
  title,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.dialog}>
          <RadixDialog.Title className={styles.dialogTitle}>{title}</RadixDialog.Title>
          <RadixDialog.Description asChild>
            <div>{children}</div>
          </RadixDialog.Description>
          <div className={styles.dialogActions}>{actions}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function Button({
  variant = 'default',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'subtle' }) {
  const variantClass =
    variant === 'primary' ? styles.buttonPrimary : variant === 'subtle' ? styles.buttonSubtle : '';
  return <button {...rest} type={rest.type ?? 'button'} className={`${styles.button} ${variantClass}`} />;
}

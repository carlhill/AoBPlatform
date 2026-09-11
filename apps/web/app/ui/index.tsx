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
import { MainMenu } from '../MainMenu';
import { BackLink } from '../BackLink';
import { RefreshButton } from '../RefreshButton';
import { Copy, Check } from 'lucide-react';
import { useId, useState } from 'react';
import { strings } from '../strings';
import styles from './ui.module.css';

export { styles as ui };

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function Shell({
  nav,
  right,
  title,
  lead,
  children,
}: {
  nav?: React.ReactNode;
  right?: React.ReactNode;
  /**
   * The page's title and the sentence under it, PINNED while you scroll.
   *
   * Owned by the Shell rather than written into each page's body, and that is
   * the whole reason it moved: a banner can only stay put if something outside
   * the scrolling content holds it. A page rendering its own `<h1>` inside
   * `<main>` scrolls it away, and on a long roster or queue you lose which
   * practice you are even looking at.
   *
   * OPTIONAL, so nothing breaks. A page that passes neither renders exactly
   * what it did before and can be moved over when somebody is next in it.
   */
  title?: React.ReactNode;
  lead?: React.ReactNode;
  /**
   * OPTIONAL, because a page can be nothing but its banner. A refusal that says
   * "that link does not match an application" has a title, a sentence, and
   * genuinely nothing else -- requiring an empty body would mean writing one.
   */
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          {/*
            THE MENU FIRST, and in the shell rather than on each page. Every
            screen already wraps itself in Shell, so putting it here is what
            makes it appear everywhere at once — and, more to the point, keeps
            it from appearing on all but the one page somebody forgot.
          */}
          <MainMenu />
          <span className={styles.wordmark}>AoBPlatform</span>
          {/*
            AND WHERE "UP" IS. Derived from the path rather than passed in, so
            no page can be the one that forgot it, and it renders nothing at all
            on a page that has no parent.
          */}
          <BackLink />
          {nav && <nav className={styles.nav}>{nav}</nav>}
          {/*
            REFRESH, on every page that has anything to re-read. The token lives
            in memory only — by design, so nothing a script can reach holds it —
            which makes F5 throw the session away and ask somebody to sign in
            again. This is how to say "ask the server again" without paying that
            price. It hides itself when no page has registered a loader, because
            a refresh button that does nothing teaches people to press F5.
          */}
          <span className={styles.topbarRight}>
            <RefreshButton />
          </span>
          {right && <span className={styles.topbarRight}>{right}</span>}
        </div>
      </header>
      {(title || lead) && (
        <div className={styles.banner}>
          <div className={styles.bannerInner}>
            {title && <h1 className={styles.pageTitle}>{title}</h1>}
            {lead && <p className={styles.bannerLead}>{lead}</p>}
          </div>
        </div>
      )}
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export function Section({
  number,
  title,
  aside,
  collapsible = false,
  defaultOpen = true,
  summary,
  children,
}: {
  number: number;
  title: string;
  aside?: React.ReactNode;
  /**
   * Whether the whole section folds away.
   *
   * For sections that are CONSULTED rather than acted on. An audit trail is the
   * clearest case: it is long, it is the least often needed thing on the page,
   * and left open it pushes the decision — the thing the reviewer actually came
   * to do — below the fold.
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** A one-line stand-in shown while collapsed, so folding costs no information. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = !collapsible || open;

  const heading = (
    <>
      {/* Decorative: the heading already carries the name. */}
      <span className={styles.sectionNumber} aria-hidden="true">
        {number}
      </span>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
    </>
  );

  return (
    <section className={styles.section} aria-label={title}>
      {collapsible ? (
        // A real button, so it is reachable by keyboard and announces its state.
        // A div with an onClick is neither.
        <button
          type="button"
          className={`${styles.sectionHead} ${styles.sectionToggle}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
        >
          <span className={styles.sectionChevron} aria-hidden="true">
            {open ? '−' : '+'}
          </span>
          {heading}
        </button>
      ) : (
        <div className={styles.sectionHead}>{heading}</div>
      )}

      {collapsible && !open && summary && <div className={styles.sectionSummary}>{summary}</div>}

      <div className={styles.sectionBody} id={bodyId} hidden={!shown}>
        {children}
      </div>
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
  /**
   * A string normally; a node when a status chip needs to sit beside it (an
   * email address under verification, say). `RadixLabel.Root` renders
   * whatever it is given, so widening this cost nothing beyond the type.
   */
  label: React.ReactNode;
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

/**
 * The text IS the status. Colour only reinforces it.
 *
 * `solid` inverts the chip for the one case that is different in KIND rather
 * than degree — something that stops an action, as against something that
 * merits attention. Weight, not hue: adding a fifth colour would not have made
 * a fifth distinguishable meaning.
 */
export function Chip({
  tone = 'neutral',
  solid = false,
  children,
}: {
  tone?: Tone;
  solid?: boolean;
  children: React.ReactNode;
}) {
  return <span className={`${styles.chip} ${chipTone[tone]} ${solid ? styles.chipSolid : ''}`}>{children}</span>;
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
  ...rest
}: {
  tone?: Exclude<Tone, 'neutral'>;
  title?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    // `alert` so a refusal is announced when it appears, not silently painted.
    <div className={`${styles.notice} ${noticeTone[tone]}`} role="alert" {...rest}>
      {title && <p className={styles.noticeTitle}>{title}</p>}
      {/*
        A DIV, NOT A `p`. Longer notices carry more than one sentence and want
        paragraphs; a `p` inside a `p` is invalid and the browser silently
        closes the outer one, which broke the styling in a way that looked like
        a CSS bug rather than bad markup.
      */}
      <div className={styles.noticeBody}>{children}</div>
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

// ---------------------------------------------------------------------------
// The record line
// ---------------------------------------------------------------------------

/**
 * WHICH RECORD IS THIS PAGE ABOUT (Carl, 7 Sep 2026) — "every page must have
 * the patient GUID from AoBPlatform somewhere, so we can see which record has
 * the issue. Also helps with testing".
 *
 * ONE COMPONENT, SO IT LOOKS THE SAME EVERYWHERE. A header, a queue row, a
 * tablet row and a form all show the same thing in the same typeface, which is
 * what makes it recognisable enough to be ignored until it is wanted. Callers
 * pass the LABEL from the string table (`strings.recordId.patient`) rather than
 * a hardcoded word, so this component carries no copy of its own beyond the
 * copy control's.
 *
 * THE WHOLE ID, NEVER SHORTENED. Eight characters are for matching by eye
 * across a desk — that is the tablet session tag's job, and it keeps it. This
 * one exists to be matched EXACTLY: quoted into a support ticket, pasted into a
 * query, compared against a vault event. Truncating it would leave somebody
 * doing the one thing the id is for by hand.
 *
 * AN OPAQUE ID IS NOT A PERSONAL DETAIL, and this component must never be
 * pointed at one that is. It renders a value this platform minted. Never a
 * Medicare number (hard rule 1, REQ-VER-02 — there is no column for one), never
 * an IHI, never a record number from somebody else's system.
 *
 * COPY WRITES TO THE CLIPBOARD AND PERSISTS NOTHING. No storage, no state that
 * outlives the tab, no request — the confirmation is a two-second label change
 * on the button itself. Where the clipboard API is unavailable or refused (an
 * insecure origin, a permission denial, a test environment) the control simply
 * says nothing and the id is still on screen and still selectable, which is the
 * behaviour that was there before the button existed.
 */
export function RecordId({
  label,
  value,
  testId,
  className,
}: {
  label: string;
  value: string;
  testId?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Cosmetic only — the id is on screen and selectable either way. */
    }
  }

  return (
    <span className={`${styles.recordId} ${className ?? ''}`} data-testid={testId}>
      <span className={styles.recordIdLabel}>{label}</span>
      <span className={styles.recordIdValue}>{value}</span>
      <button
        type="button"
        className={styles.recordIdCopy}
        aria-label={strings.recordId.copyLabel(label)}
        onClick={() => void copy()}
        data-testid={testId ? `${testId}-copy` : undefined}
      >
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        {copied ? strings.recordId.copied : strings.recordId.copy}
      </button>
    </span>
  );
}

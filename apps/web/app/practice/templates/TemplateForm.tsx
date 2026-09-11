'use client';

/**
 * THE WORDING EDITOR — a form, not a box of JSON (Carl, 7 Sep 2026; W1).
 *
 * "Make this custom text a form and then you put it together in the right JSON
 * format."
 *
 * WHAT WAS WRONG WITH THE TEXTAREA. It asked a practice manager to edit the
 * operative words of a contract inside a JSON literal: braces, commas, section
 * keys, escaped quotes. A missing comma failed as "that is not valid
 * structured text"; a missing `{{serviceDate}}` failed as a sentence about the
 * s 65C data set; both arrived after Save, in the same red box, and neither
 * pointed at the thing to fix.
 *
 * WHAT REPLACES IT. The generic template's own shape, rendered as fields: a
 * heading and paragraphs per section, one line per statement, a footer. The
 * form assembles the JSON; nobody sees it. `templateEditing.ts` holds every piece
 * of that with no React in it.
 *
 * THREE THINGS ARE STRUCTURAL RATHER THAN COSMETIC.
 *
 *  1. PLACEHOLDERS ARE PICKED, NEVER TYPED. `{{patientNam}}` is a contract
 *     that prints literal braces. The menu is built from the placeholders the
 *     CONTENT FILE declares — read off the API response, never a list in this
 *     file — so it cannot offer one that does not exist.
 *  2. THE CHECKS ARE LIVE AND THEY ARE THE SERVER'S. Same loader, same
 *     regexes, collecting instead of throwing at the first. Save and Submit
 *     are dead while any check fails, with every reason visible — dead until
 *     valid, with the reasons shown (CLAUDE.md §6, §7).
 *  3. THE STATEMENT COUNT IS FIXED. The KEY is what a signature records, so
 *     adding or removing a statement changes what a signature means. The hint
 *     says so rather than the control silently not being there.
 *
 * THE PREVIEW IS NOT A SECOND RENDER PATH (hard rule 13). It substitutes
 * obviously fake values through `renderAgreementTemplate` — the DOMAIN's own
 * substitution, the one the server's lock uses — produces no artefact, is
 * never hashed, and carries a line on itself saying it is not the signed
 * document. What rule 13 forbids is a second way of producing the ARTEFACT;
 * there is still exactly one of those, on the server.
 *
 * No copy here says "certified", "approved" or "accredited" (hard rule 12),
 * and nothing on it carries an amount (hard rule 4) — the loader would refuse
 * the wording if it did, which is the point of running it here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgreementTemplateError,
  renderAgreementTemplate,
  type AgreementTemplateType,
  type RenderedAgreementTemplate,
} from '@aobplatform/domain';
import { Button, Notice, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';
import {
  bodyFromForm,
  candidateTemplate,
  checkTemplateForm,
  formFromBody,
  insertAtCaret,
  nextVersionName,
  sampleValuesFor,
  slugify,
  wrapSelection,
  type TemplateBody,
  type TemplateFormProblem,
  type TemplateFormState,
} from './templateEditing';

const s = strings.templates;

/**
 * ONE EDITABLE LINE OR PARAGRAPH, WITH ITS OWN TWO MENUS.
 *
 * The menus sit beside every box rather than once at the top of the form,
 * because "insert at the caret" has to know WHICH box the caret is in, and a
 * single menu would have to guess. Two native selects: short lists, and the
 * native control wins on keyboard, screen reader and touch (the reasoning
 * `SelectInput` already records).
 *
 * THE SELECTS RESET TO THEIR PROMPT AFTER EVERY USE. They are actions wearing
 * a select's clothes, not settings — leaving "the patient's name" showing
 * would read as a state the box is in.
 */
function Editable({
  label,
  hint,
  value,
  onChange,
  multiline,
  minRows = 3,
  placeholders,
  conditions,
  testId,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  /** The box's height while empty, and the least it ever shrinks back to. */
  minRows?: number;
  placeholders: readonly string[];
  conditions: readonly string[];
  testId: string;
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  /*
   * AUTO-GROWING, NO MANUAL RESIZE (Carl, 7 Sep 2026). A statement or a title
   * that wraps used to clip mid-sentence in a fixed box; growing the box to
   * fit what is typed is the fix, not a resize handle nobody asked for — the
   * handle is switched off in CSS (`autoGrowTextarea`) and the height is set
   * here instead, every time the text changes.
   */
  useEffect(() => {
    const el = ref.current;
    if (!multiline || !(el instanceof HTMLTextAreaElement)) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [multiline, value]);

  /** Where the caret is right now, defaulting to the end of the text. */
  const caret = useCallback((): { start: number; end: number } => {
    const el = ref.current;
    if (!el || el.selectionStart === null || el.selectionEnd === null) {
      return { start: value.length, end: value.length };
    }
    return { start: el.selectionStart, end: el.selectionEnd };
  }, [value.length]);

  const apply = useCallback(
    (next: { text: string; caret: number }) => {
      onChange(next.text);
      // Put the caret back where the insertion left it, after React has
      // written the new value — otherwise the browser drops it to the end and
      // the next insertion lands somewhere nobody asked for.
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      });
    },
    [onChange],
  );

  const insert = (key: string) => {
    const { start, end } = caret();
    apply(insertAtCaret(value, start, end, `{{${key}}}`));
  };

  const wrap = (token: string) => {
    const [kind, condition] = token.split(':') as ['if' | 'unless', string];
    const { start, end } = caret();
    apply(wrapSelection(value, start, end, kind, condition));
  };

  return (
    <div className={styles.subItem}>
      <label className={ui.hint} htmlFor={testId}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={testId}
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          className={`${ui.input} ${styles.autoGrowTextarea}`}
          rows={minRows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        />
      ) : (
        <input
          id={testId}
          ref={ref as React.RefObject<HTMLInputElement>}
          className={ui.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
        />
      )}
      <div className={styles.cardActions}>
        <select
          className={ui.select}
          value=""
          aria-label={`${s.insertDetail} — ${label}`}
          data-testid={`${testId}-insert`}
          onChange={(e) => {
            if (e.target.value) insert(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">{s.insertDetailChoose}</option>
          {placeholders.map((key) => (
            <option key={key} value={key}>
              {/* Unlabelled keys show as themselves — a placeholder added to
                  the content file appears rather than disappearing. */}
              {s.placeholderLabels[key] ?? key}
            </option>
          ))}
        </select>
        <select
          className={ui.select}
          value=""
          aria-label={`${s.insertOnlyWhen} — ${label}`}
          data-testid={`${testId}-only-when`}
          onChange={(e) => {
            if (e.target.value) wrap(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">{s.insertOnlyWhen}</option>
          {conditions.map((key) => {
            const conditionLabel = s.conditionLabels[key] ?? key;
            return [
              <option key={`if-${key}`} value={`if:${key}`}>
                {s.onlyWhenIf(conditionLabel)}
              </option>,
              <option key={`unless-${key}`} value={`unless:${key}`}>
                {s.onlyWhenUnless(conditionLabel)}
              </option>,
            ];
          })}
        </select>
      </div>
      {hint && <p className={ui.hint}>{hint}</p>}
    </div>
  );
}

export function TemplateForm({
  agreementType,
  generic,
  draft,
  placeholders,
  conditions,
  initialVersion,
  practiceName,
  existingVersions,
  busy,
  error,
  onPropose,
  onCancel,
}: {
  agreementType: AgreementTemplateType;
  /** The shipped wording. The form's SHAPE is always this one's. */
  generic: TemplateBody;
  /** An existing draft to carry on editing, if there is one. */
  draft?: TemplateBody;
  /** Declared by the content file and served by the API — never a list in here. */
  placeholders: readonly string[];
  conditions: readonly string[];
  /** An existing draft's own version name — carried on, never regenerated. */
  initialVersion: string;
  /** Trading name, falling back to legal name — read off the practice record, never typed here. */
  practiceName: string;
  /** Every version this practice has ever proposed, of either type — for numbering the next one. */
  existingVersions: readonly string[];
  busy: boolean;
  error: string | null;
  onPropose: (version: string, body: TemplateBody, submit: boolean) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TemplateFormState>(() => formFromBody(generic, draft));

  /*
   * GENERATED, NOT TYPED (Carl, 7 Sep 2026). "The version name must be lower
   * case, words joined by hyphens, and end in a number" is a rule about
   * `TEMPLATE_VERSION_PATTERN`, not a fact a practice manager should have to
   * satisfy by hand. A fresh proposal (no draft, so `initialVersion` is
   * empty) gets `<practice-slug>-<agreementType>-<n>`; a draft already in
   * progress keeps the name it was first saved under. Either way the value is
   * always well-formed, so the shape check never fires until somebody presses
   * Change and types something themselves.
   */
  const generatedVersion = useMemo(
    () => nextVersionName(slugify(practiceName), agreementType, existingVersions),
    [practiceName, agreementType, existingVersions],
  );
  const [version, setVersion] = useState(initialVersion || generatedVersion);
  const [versionEditing, setVersionEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  /*
   * EXPANDED BY DEFAULT WHILE BLOCKED. The bar is sticky so the reasons stay
   * on screen while the form scrolls (Carl, 7 Sep 2026) — but the first time
   * anything is wrong, showing the list is what tells a practice what to fix.
   * Collapsing to the one-line count is something a practice chooses once it
   * has read the list and wants the space back, not the state it opens in.
   */
  const [checksExpanded, setChecksExpanded] = useState(true);

  const problems: TemplateFormProblem[] = useMemo(
    () =>
      checkTemplateForm(form, {
        agreementType,
        version,
        placeholders,
        conditions,
        missingElement: (element) =>
          s.placeholderLabels[element]
            ? s.checkMissingElement(s.placeholderLabels[element])
            : /*
               * AN UNLABELLED ELEMENT SHOWS ITS KEY rather than vanishing. A
               * data element added to the domain before this table catches up
               * must still block the save and still be nameable — the same
               * principle as an unmapped refusal code (CLAUDE.md §7).
               */
              s.checkMissingElementUnlabelled(element),
        needsTitle: s.checkNeedsTitle,
        needsVersion: s.checkNeedsVersion,
        needsStatementText: (key) => s.checkNeedsStatementText(key),
      }),
    [form, version, agreementType, placeholders, conditions],
  );

  const blocked = problems.length > 0;

  const preview: RenderedAgreementTemplate | null = useMemo(() => {
    if (!previewing) return null;
    try {
      return renderAgreementTemplate(
        candidateTemplate(form, agreementType, version.trim() || 'draft-1'),
        sampleValuesFor(placeholders, conditions, s.sampleValues, (key) => s.sampleFallback(key)),
      );
    } catch (err) {
      // `renderAgreementTemplate` throws rather than printing braces at
      // anybody. The checks above already say what is outstanding.
      if (err instanceof AgreementTemplateError) return null;
      throw err;
    }
  }, [previewing, form, agreementType, version, placeholders, conditions]);

  const setSection = (index: number, next: Partial<TemplateFormState['sections'][number]>) =>
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section, i) => (i === index ? { ...section, ...next } : section)),
    }));

  const setParagraph = (sectionIndex: number, paragraphIndex: number, text: string) =>
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section, i) =>
        i === sectionIndex
          ? { ...section, paragraphs: section.paragraphs.map((p, j) => (j === paragraphIndex ? text : p)) }
          : section,
      ),
    }));

  return (
    <div className={styles.addPanel} data-testid={`template-form-${agreementType}`}>
      <p className={styles.cardNote}>{s.editorLead}</p>
      <p className={styles.cardNote}>{s.insertHint}</p>

      {/* --- The version name --------------------------------------------
        GENERATED, SHOWN, RARELY CHANGED (Carl, 7 Sep 2026). The technical
        shape ("lower case, hyphens, ending in a number") is the system's
        problem to satisfy, not the practice's — so it is satisfied before
        anybody sees this field. Change reveals the input for the rare case
        somebody wants a different name; the usual case is reading it and
        moving on. */}
      {versionEditing ? (
        <>
          <label className={ui.hint} htmlFor="variant-version">
            {s.versionLabel}
          </label>
          <input
            id="variant-version"
            className={ui.input}
            value={version}
            placeholder={s.versionPlaceholder}
            onChange={(e) => setVersion(e.target.value)}
            data-testid="variant-version"
          />
          <p className={ui.hint}>{s.versionHint}</p>
        </>
      ) : (
        <div className={styles.cardActions} data-testid="variant-version-display">
          <p className={styles.cardNote}>{s.versionGenerated(version)}</p>
          <Button
            variant="subtle"
            onClick={() => setVersionEditing(true)}
            data-testid="variant-version-change"
          >
            {s.versionChange}
          </Button>
        </div>
      )}

      {/* --- Title -------------------------------------------------------- */}
      <Editable
        multiline
        minRows={1}
        label={s.titleLabel}
        hint={s.titleHint}
        value={form.title}
        onChange={(title) => setForm((current) => ({ ...current, title }))}
        placeholders={placeholders}
        conditions={conditions}
        testId="template-title"
      />

      {/* --- Sections ----------------------------------------------------- */}
      <p className={styles.subHeading}>{s.sectionsHeading}</p>
      <p className={ui.hint}>{s.sectionsHint}</p>
      {form.sections.map((section, sectionIndex) => (
        <div key={section.key} className={styles.methodDetail} data-testid={`section-${section.key}`}>
          {/* THE KEY IS SHOWN AND FIXED. It orders the document and it is what
              a stored agreement refers to; a practice rewrites the words under
              it, never the key. */}
          <p className={styles.cardTitle}>{s.sectionKeyLabel(section.key)}</p>
          <Editable
            label={s.sectionHeadingLabel}
            value={section.heading}
            onChange={(heading) => setSection(sectionIndex, { heading })}
            placeholders={placeholders}
            conditions={conditions}
            testId={`section-${section.key}-heading`}
          />
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <div key={`${section.key}-${paragraphIndex}`}>
              <Editable
                multiline
                label={s.paragraphLabel(paragraphIndex + 1)}
                value={paragraph}
                onChange={(text) => setParagraph(sectionIndex, paragraphIndex, text)}
                placeholders={placeholders}
                conditions={conditions}
                testId={`section-${section.key}-paragraph-${paragraphIndex}`}
              />
              {/* MIN ONE. The last paragraph has no Remove, because a section
                  with no box is a section nobody can type into. */}
              {section.paragraphs.length > 1 && (
                <Button
                  variant="subtle"
                  onClick={() =>
                    setSection(sectionIndex, {
                      paragraphs: section.paragraphs.filter((_, j) => j !== paragraphIndex),
                    })
                  }
                  data-testid={`section-${section.key}-remove-${paragraphIndex}`}
                >
                  {s.removeParagraph}
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="subtle"
            onClick={() => setSection(sectionIndex, { paragraphs: [...section.paragraphs, ''] })}
            data-testid={`section-${section.key}-add-paragraph`}
          >
            {s.addParagraph}
          </Button>
        </div>
      ))}

      {/* --- Statements ---------------------------------------------------- */}
      <p className={styles.subHeading}>{s.statementsFormHeading}</p>
      <p className={ui.hint}>{s.statementsFormHint}</p>
      {form.statements.map((statement, index) => (
        <div key={statement.key} className={styles.methodDetail} data-testid={`statement-${statement.key}`}>
          <p className={styles.cardTitle}>{s.statementKeyLabel(statement.key)}</p>
          <Editable
            multiline
            minRows={2}
            label={s.statementKeyLabel(statement.key)}
            value={statement.text}
            onChange={(text) =>
              setForm((current) => ({
                ...current,
                statements: current.statements.map((st, i) => (i === index ? { ...st, text } : st)),
              }))
            }
            placeholders={placeholders}
            conditions={conditions}
            testId={`statement-${statement.key}-text`}
          />
        </div>
      ))}

      {/* --- Footer -------------------------------------------------------- */}
      <p className={styles.subHeading}>{s.footerHeading}</p>
      <Editable
        multiline
        label={s.footerHeading}
        hint={s.footerHint}
        value={form.footer}
        onChange={(footer) => setForm((current) => ({ ...current, footer }))}
        placeholders={placeholders}
        conditions={conditions}
        testId="template-footer"
      />

      {/* --- The live checks -------------------------------------------------
        PINNED WHILE THE FORM SCROLLS (Carl, 7 Sep 2026: "the yellow box need
        to be fixed"). This is the only part of the form somebody editing
        wording needs to see at every moment, not just when they happen to
        have scrolled to the bottom — so it sticks to the foot of the form's
        own column rather than living wherever the last field left it.
        Collapsed it is one line, announced as it changes (`role="status"`);
        expanded it is the same reasons the loader gives, each nameable
        (CLAUDE.md §7's unmapped-code principle, applied to a check instead of
        a refusal). */}
      <div className={styles.checksBar} data-testid="template-checks">
        {blocked ? (
          <button
            type="button"
            className={styles.checksSummary}
            aria-expanded={checksExpanded}
            onClick={() => setChecksExpanded((current) => !current)}
            data-testid="template-checks-toggle"
          >
            <span role="status">{s.checksSummaryBlocked(problems.length, checksExpanded)}</span>
          </button>
        ) : (
          <p role="status" className={`${styles.checksSummary} ${styles.checksSummaryOk}`} data-testid="checks-passing">
            {s.checksPassing}
          </p>
        )}
        {blocked && checksExpanded && (
          <div role="region" aria-labelledby="template-checks-heading" className={styles.checksListWrap}>
            <p id="template-checks-heading" className={styles.subHeading}>
              {s.checksHeading}
            </p>
            <Notice tone="warn" title={s.checksBlocked(problems.length)}>
              <ul>
                {problems.map((problem) => (
                  <li key={problem.key} data-testid={`check-${problem.key}`}>
                    {problem.message}
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        )}
      </div>

      {/* --- The preview ----------------------------------------------------- */}
      <Button
        variant="subtle"
        onClick={() => setPreviewing((current) => !current)}
        data-testid="template-preview-toggle"
      >
        {previewing ? s.previewHide : s.previewShow}
      </Button>
      {previewing && (
        <div className={styles.methodDetail} data-testid="template-preview">
          <Notice tone="warn" title={s.previewNotice}>
            <p>{s.previewBranchNote}</p>
          </Notice>
          {preview ? (
            <div>
              <p className={ui.hint}>{s.previewLetterhead}</p>
              <p className={styles.cardTitle} data-testid="preview-title">
                {preview.title}
              </p>
              {preview.sections.map((section) => (
                <div key={section.key}>
                  <p className={styles.subHeading}>{section.heading}</p>
                  {section.paragraphs.map((paragraph, i) => (
                    <p key={`${section.key}-${i}`} className={styles.cardNote}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              ))}
              {/* THE TICK BOXES, EMPTY — the statements are what the assignor
                  ticks, and a preview that showed them ticked would be a
                  picture of a signed document. */}
              <ul>
                {preview.statements.map((statement) => (
                  <li key={statement.key} className={styles.cardNote}>
                    <input type="checkbox" disabled checked={false} readOnly aria-hidden="true" />{' '}
                    {statement.text}
                  </li>
                ))}
              </ul>
              {preview.footer.map((line, i) => (
                <p key={`footer-${i}`} className={ui.hint}>
                  {line}
                </p>
              ))}
            </div>
          ) : (
            <p className={styles.cardNote} data-testid="preview-unavailable">
              {s.previewFailed}
            </p>
          )}
        </div>
      )}

      {error && <Notice tone="warn">{error}</Notice>}

      {/*
        DEAD UNTIL VALID, WITH THE REASONS SHOWN (CLAUDE.md §6). The checks
        above are the reasons; this line says what they are stopping, so a
        greyed-out button is never a mystery.
      */}
      {blocked && <p className={ui.hint}>{s.saveBlocked}</p>}
      <div className={styles.formActions}>
        <Button
          onClick={() => onPropose(version.trim(), bodyFromForm(form), false)}
          disabled={busy || blocked}
          data-testid="save-draft"
        >
          {s.saveDraft}
        </Button>
        <Button
          variant="primary"
          onClick={() => onPropose(version.trim(), bodyFromForm(form), true)}
          disabled={busy || blocked}
          data-testid="submit-for-review"
        >
          {s.submitForReview}
        </Button>
        <Button variant="subtle" onClick={onCancel}>
          {s.cancel}
        </Button>
      </div>
    </div>
  );
}

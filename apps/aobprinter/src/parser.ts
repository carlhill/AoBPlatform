/**
 * Printed lines in, DB4 Print Record out.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO HOLD, and both are the reason the brief
 * put a parser here rather than a language model:
 *
 *   DETERMINISM. The same bytes produce the same record, on any machine, in any
 *   year. The Signed-DB4 is evidence; a record that cannot be reproduced from
 *   its source cannot support it, and `sourceSha256` is only worth carrying
 *   because re-reading those bytes gives this record back. A model that reads
 *   the form is a different answer each time it is asked, and there is no
 *   version of it that can be shown to an auditor.
 *
 *   ABSENT, NEVER GUESSED. A pattern that does not match writes nothing. No
 *   default, no inference from a sibling field, no value carried over from the
 *   last job. The server's validator decides whether an incomplete set may
 *   proceed (hard rule 2); a parser that filled in a gap would be lying to the
 *   thing whose whole job is to catch gaps.
 *
 *   BOOLEANS ARE THE EXCEPTION, AND THERE ARE TWO OF THEM. A `flag` extractor
 *   writes `false` when its declared pattern does not match, and a row's
 *   `flags` (the tick box on each assignment statement) writes `false` when the
 *   nominated group did not carry a tick. Neither is a guess: in both cases the
 *   thing that had to be found WAS found — the page for a flag, the statement's
 *   own line for a row — and the mark was not on it. "We looked and it was not
 *   there" is an answer; "we did not look" is the thing that must stay absent.
 *
 *   AND ONE COUNT, FOR THE SAME REASON. `unparsedServiceLines` is written —
 *   zero included — whenever the template reads service rows: it is the number
 *   of service-shaped lines the row pattern did NOT read. Zero is "we looked
 *   and read them all", which is an answer, not a default.
 *
 * EVERYTHING SPECIFIC TO PRACSOFT IS IN THE TEMPLATE. This file knows how a
 * `line` extractor behaves; it does not know that the chart number is labelled
 * "Chart Number". That distinction is what lets the layout change without a
 * release (hard rule 14).
 */
import { DB4_DOCUMENT_TYPE, type Db4PrintRecord } from './db4-record';
import type { Extractor, ParserTemplate, RowExtractor, TransformName } from './template';

/** A record under construction: nested plain objects and arrays, written by dotted path. */
type Mutable = Record<string, unknown>;

function applyTransform(value: string, transform: TransformName | undefined): string {
  switch (transform) {
    case 'date:dmy': {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
      // NOT A DATE STAYS AS PRINTED. Mangling it would hide from the server
      // validator what actually came off the page.
      return m ? `${m[3]}-${m[2]}-${m[1]}` : value.trim();
    }
    case 'money':
      return value.replace(/[$,\s]/g, '');
    case 'collapseSpaces':
      return value.replace(/\s+/g, ' ').trim();
    case 'upper':
      return value.trim().toUpperCase();
    default:
      return value.trim();
  }
}

/** Write `value` at a dotted path, creating the objects on the way. */
function setPath(target: Mutable, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) node[part] = {};
    node = node[part] as Mutable;
  }
  node[parts[parts.length - 1]] = value;
}

function getPath(target: Mutable, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return (node as Mutable)[part];
  }, target);
}

function pushPath(target: Mutable, path: string, value: unknown): void {
  const existing = getPath(target, path);
  if (Array.isArray(existing)) existing.push(value);
  else setPath(target, path, [value]);
}

/**
 * Join a wrapped value's continuation onto it.
 *
 * A space between the two, EXCEPT where the continuation opens with closing
 * punctuation — a sentence whose full stop was pushed onto the next printed
 * line must not come back as "... services ." This is a normalisation of how
 * the page was printed, not a change to what it says.
 */
function joinWrapped(head: string, tail: string): string {
  return /^[.,;:)\]}!?]/.test(tail) ? `${head}${tail}` : `${head} ${tail}`;
}

function runLine(extractor: Extractor & { kind: 'line' }, lines: readonly string[], out: Mutable): void {
  for (const line of lines) {
    const m = extractor.pattern.exec(line);
    if (!m) continue;
    for (const [group, path] of Object.entries(extractor.paths)) {
      const raw = m.groups?.[group];
      // An OPTIONAL group that did not participate is absent, not empty.
      if (raw === undefined) continue;
      const value = applyTransform(raw, extractor.transforms[group]);
      if (value.length === 0) continue;
      setPath(out, path, value);
    }
    return; // First match wins. A form prints each field once.
  }
}

function runLines(extractor: Extractor & { kind: 'lines' }, lines: readonly string[], out: Mutable): void {
  const start = lines.findIndex((line) => extractor.after.test(line));
  if (start === -1) return;

  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (extractor.stopPattern.test(line)) break;
    if (extractor.excludePattern?.test(line)) continue;
    collected.push(line);
  }
  if (collected.length > 0) setPath(out, extractor.path, collected);
}

function runParagraphs(extractor: Extractor & { kind: 'paragraphs' }, lines: readonly string[], out: Mutable): void {
  const entries: string[] = [];
  let open = false;

  for (const line of lines) {
    if (open && extractor.stopPattern?.test(line)) break;
    if (extractor.startPatterns.some((p) => p.test(line))) {
      entries.push(line);
      open = true;
      continue;
    }
    if (!open) continue;
    if (extractor.stopPattern?.test(line)) break;
    // A continuation of the paragraph above it.
    entries[entries.length - 1] = joinWrapped(entries[entries.length - 1], line);
  }

  if (entries.length > 0) setPath(out, extractor.path, entries);
}

function runRows(extractor: RowExtractor, lines: readonly string[], out: Mutable): void {
  for (let i = 0; i < lines.length; i += 1) {
    const m = extractor.pattern.exec(lines[i]);
    if (!m) continue;

    const row: Mutable = {};
    for (const [field, value] of Object.entries(extractor.constants)) row[field] = value;

    const captured: Record<string, string> = {};
    for (const [group, raw] of Object.entries(m.groups ?? {})) {
      if (raw === undefined) continue;
      captured[group] = raw;
    }

    // A wrapped value absorbs the lines after it, up to the template's stop.
    if (extractor.continueInto !== null && captured[extractor.continueInto] !== undefined) {
      for (const next of lines.slice(i + 1)) {
        if (extractor.continueUntil?.test(next)) break;
        captured[extractor.continueInto] = joinWrapped(captured[extractor.continueInto], next);
      }
    }

    for (const [group, raw] of Object.entries(captured)) {
      if (extractor.flagsFrom === group) continue; // The tick box is a flag, not a field.
      const value = applyTransform(raw, extractor.transforms[group]);
      if (value.length > 0) row[group] = value;
    }

    // Flags read the group the template nominated; a group that did not
    // participate leaves the flag false, which is "we looked, it was not ticked".
    for (const [field, pattern] of Object.entries(extractor.flags)) {
      row[field] = extractor.flagsFrom !== null && pattern.test(captured[extractor.flagsFrom] ?? '');
    }

    for (const [field, spec] of Object.entries(extractor.derive)) {
      const source = captured[spec.from];
      if (source !== undefined && source.trim().length > 0) row[field] = `${spec.prefix}${source.trim()}`;
    }

    pushPath(out, extractor.path, row);
    if (extractor.kind === 'row') return;
  }
}

/**
 * A LINE THAT OPENS WITH A DAY-FIRST DATE — the shape every service row on a
 * DB4 starts with, and the same shape `date:dmy` already knows.
 *
 * DELIBERATELY LOOSER THAN ANY ROW PATTERN (one- or two-digit day and month,
 * leading space allowed). Its job is to catch the near-miss the row pattern
 * rejected, so it must accept more than the row pattern does.
 */
const DATE_LED = /^\s*\d{1,2}\/\d{1,2}\/\d{4}(?!\d)/;

/**
 * HOW MANY SERVICE LINES THE TEMPLATE DID NOT READ (Opus review, 10 Oct 2026;
 * D-2026-10-11-01).
 *
 * `runRows` skips a line its pattern does not match, which is right for the
 * page in general and wrong for a service row: a credit (`-$10.00`,
 * `($10.00)`), a whole-dollar amount (`$45`) or a row printed with no amount
 * all vanished from `services` under both shipped templates, and the patient's
 * copy of the form was then missing a row with nothing to say so. Core refuses
 * Send-to-tablet on a non-zero count.
 *
 * THE SERVICES BLOCK IS EVERY DATE-LED LINE ON THE PAGE. Neither shipped
 * template declares where the block starts and stops, and declaring it is a
 * template change (hard rule 14). On a DB4 the only lines that open with a date
 * are service rows, so the page-wide count is the block's count; a layout that
 * prints something else date-led (a footer timestamp, say) would be counted
 * too, and that errs toward a refusal at the desk rather than a missing row in
 * front of the patient.
 *
 * A COUNT, NEVER CONTENT. The lines are not kept, logged or returned — no
 * description, no item number, no amount leaves this function.
 *
 * NULL WHEN THE TEMPLATE READS NO SERVICE ROWS AT ALL, because then nobody
 * looked, and "we did not look" stays absent.
 */
function countUnparsedServiceLines(template: ParserTemplate, lines: readonly string[]): number | null {
  const serviceRows = template.extractors.filter(
    (e): e is RowExtractor => (e.kind === 'rows' || e.kind === 'row') && e.path === 'services',
  );
  if (serviceRows.length === 0) return null;
  return lines.filter((line) => DATE_LED.test(line) && !serviceRows.some((e) => e.pattern.test(line))).length;
}

export interface ParseInput {
  /** The printed lines, top to bottom. */
  readonly lines: readonly string[];
  /** SHA-256 (hex) of the spool bytes. */
  readonly sourceSha256: string;
  /** When the desktop claimed the job, by its clock. */
  readonly capturedAt: string;
}

/**
 * The record, or null when the page is not the document this template reads.
 *
 * NOT-A-DB4 IS NOT AN ERROR. A practice can print anything to a printer, and
 * somebody will. A page with no form reference and no assignment statement is a
 * page that was sent to the wrong queue; the watcher parks it and says so, and
 * nothing is posted. Posting a near-empty record and letting the server work it
 * out would put a mystery row in front of a receptionist.
 */
export function parseDb4(template: ParserTemplate, input: ParseInput): Db4PrintRecord | null {
  const out: Mutable = {};

  for (const [path, value] of Object.entries(template.constants)) setPath(out, path, value);

  for (const extractor of template.extractors) {
    switch (extractor.kind) {
      case 'line':
        runLine(extractor, input.lines, out);
        break;
      case 'lines':
        runLines(extractor, input.lines, out);
        break;
      case 'paragraphs':
        runParagraphs(extractor, input.lines, out);
        break;
      case 'row':
      case 'rows':
        runRows(extractor, input.lines, out);
        break;
      case 'flag':
        setPath(out, extractor.path, input.lines.some((line) => extractor.truePattern.test(line)));
        break;
      case 'derive': {
        const source = getPath(out, extractor.from);
        if (typeof source === 'string' && source.length > 0) setPath(out, extractor.path, `${extractor.prefix}${source}`);
        break;
      }
    }
  }

  if (!looksLikeThisForm(out)) return null;

  const unparsedServiceLines = countUnparsedServiceLines(template, input.lines);
  return {
    documentType: DB4_DOCUMENT_TYPE,
    sourceSha256: input.sourceSha256,
    parserTemplateVersion: template.version,
    pms: template.pms,
    capturedAt: input.capturedAt,
    ...(out as Omit<Db4PrintRecord, 'documentType' | 'sourceSha256' | 'parserTemplateVersion' | 'pms' | 'capturedAt'>),
    ...(unparsedServiceLines === null ? {} : { unparsedServiceLines }),
  };
}

/**
 * Is this page the form the template reads?
 *
 * TWO INDEPENDENT SIGNS, and it needs both: a form reference (which only this
 * form prints) and at least one assignment statement. One alone is too easy for
 * an unrelated page to produce by accident — an invoice has a reference number,
 * and a consent leaflet has the words. The constants the template writes
 * unconditionally are deliberately NOT counted: they are on the record because
 * the template put them there, not because the page said so.
 */
function looksLikeThisForm(out: Mutable): boolean {
  const hasReference = typeof getPath(out, 'form.formReference') === 'string';
  const statements = getPath(out, 'assignment.statements');
  const hasStatement = Array.isArray(statements) && statements.length > 0;
  return hasReference && hasStatement;
}

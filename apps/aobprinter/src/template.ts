/**
 * THE PARSER TEMPLATE IS VERSIONED CONTENT, NOT CODE (hard rule 14).
 *
 * Every pattern that turns a printed DB4 into a DB4 Print Record lives in
 * `content/<version>.json`, and the version travels on the record as
 * `parserTemplateVersion`. A practice management system changes its print
 * layout without asking us, and when PracSoft does, the answer is a new content
 * file, not a new build — the same reason `content/assignor-relationships.json`
 * exists, and the same defence against regulatory whipsaw that hard rule 14 is
 * written for.
 *
 * WHAT IS CODE HERE, deliberately. The EXTRACTOR KINDS are code: `line`,
 * `lines`, `paragraphs`, `row`, `rows`, `flag`, `derive`, and the handful of
 * named transforms. They are a fixed, auditable vocabulary. The content file
 * chooses from that vocabulary and supplies the patterns; it cannot introduce a
 * new behaviour, only a new pattern. That is the line between "the list is
 * content" and "the content file is a program".
 *
 * WHY THE VALIDATION IS HAND-WRITTEN AND NOT ZOD. Same answer as the domain
 * package: no runtime dependency for something this small, and it throws on the
 * first thing it does not like, which is what a schema library would do. It
 * runs at load, so a malformed edit fails at the bench rather than at a
 * practice's desk with a patient waiting.
 *
 * AND IT REFUSES A PATTERN IT CANNOT COMPILE. A bad regex in a content file is
 * the one failure that could otherwise reach a practice as "no fields found" —
 * which looks exactly like a blank form.
 */

export const EXTRACTOR_KINDS = ['line', 'lines', 'paragraphs', 'row', 'rows', 'flag', 'derive'] as const;
export type ExtractorKind = (typeof EXTRACTOR_KINDS)[number];

/**
 * The named transforms. A transform NORMALISES what was printed; it never
 * supplies a value that was not.
 *
 * `date:dmy`   "12/09/2026" → "2026-09-12". An Australian form prints
 *              day-first, and an ISO date is what every consumer wants. A value
 *              that is not a DD/MM/YYYY date is left exactly as printed rather
 *              than mangled — the server validator can then see what arrived.
 * `money`      "$1,045.05" → "1045.05". The figure PracSoft printed, with the
 *              presentation removed. Never rounded, never recomputed. NO
 *              SHIPPED TEMPLATE APPLIES IT TO AN AMOUNT SINCE -10-1: Carl wants
 *              the amount shown as printed, `$` included (D-2026-10-10-08). It
 *              stays because -09-1 uses it and must keep re-reading its records.
 * `collapseSpaces` trims, and folds runs of whitespace to one space. Every other
 *              character stays, which is why -10-1 uses it for the amount:
 *              "$1,045.05" stays "$1,045.05".
 * `upper`      for a code the form prints in mixed case.
 */
export const TRANSFORMS = ['date:dmy', 'money', 'collapseSpaces', 'upper'] as const;
export type TransformName = (typeof TRANSFORMS)[number];

export interface LineExtractor {
  readonly kind: 'line';
  readonly pattern: RegExp;
  /** Named capture group → dotted path on the record. */
  readonly paths: Readonly<Record<string, string>>;
  readonly transforms: Readonly<Record<string, TransformName>>;
}

export interface LinesExtractor {
  readonly kind: 'lines';
  readonly path: string;
  /** Collection starts at the line AFTER the first line matching this. */
  readonly after: RegExp;
  /** Collection stops BEFORE the first line matching this. */
  readonly stopPattern: RegExp;
  /** Lines matching this are dropped from the collection. */
  readonly excludePattern: RegExp | null;
}

export interface ParagraphsExtractor {
  readonly kind: 'paragraphs';
  readonly path: string;
  /** Each pattern starts one entry; lines between starts continue the entry before them. */
  readonly startPatterns: readonly RegExp[];
  readonly stopPattern: RegExp | null;
}

export interface RowExtractor {
  readonly kind: 'row' | 'rows';
  /** Dotted path to an ARRAY; each match appends one object to it. */
  readonly path: string;
  readonly pattern: RegExp;
  readonly constants: Readonly<Record<string, string | boolean>>;
  readonly transforms: Readonly<Record<string, TransformName>>;
  /** `field` → a pattern tested against the `flagsFrom` group; the field is the boolean result. */
  readonly flags: Readonly<Record<string, RegExp>>;
  readonly flagsFrom: string | null;
  /** `field` → { from: another captured group, prefix } — a key built from a value on the page. */
  readonly derive: Readonly<Record<string, { readonly from: string; readonly prefix: string }>>;
  /** A wrapped value: following lines are appended to this group until `continueUntil`. */
  readonly continueInto: string | null;
  readonly continueUntil: RegExp | null;
}

export interface FlagExtractor {
  readonly kind: 'flag';
  readonly path: string;
  /**
   * The field is TRUE when this matches a line and FALSE when it does not.
   * A declared pattern that does not match is a determination — we looked and
   * it was not on the page — which is why a flag is the one extractor that
   * writes a value without a match.
   */
  readonly truePattern: RegExp;
}

export interface DeriveExtractor {
  readonly kind: 'derive';
  readonly path: string;
  /** A dotted path already written by an earlier extractor. Absent source, absent result. */
  readonly from: string;
  readonly prefix: string;
}

export type Extractor =
  | LineExtractor
  | LinesExtractor
  | ParagraphsExtractor
  | RowExtractor
  | FlagExtractor
  | DeriveExtractor;

export interface ParserTemplate {
  /** Recorded on every record as `parserTemplateVersion`. */
  readonly version: string;
  readonly pms: string;
  readonly documentType: string;
  /** Dotted path → constant. Facts about the form, not about one printing of it. */
  readonly constants: Readonly<Record<string, string>>;
  /** IN FILE ORDER, which is the order they run in. `derive` reads what ran before it. */
  readonly extractors: readonly Extractor[];
}

function fail(why: string): never {
  throw new Error(
    `The parser template is not usable: ${why}. This file is versioned content (hard rule 14) and is ` +
      'validated at load, so a bad edit fails the build rather than a practice.',
  );
}

function asRegExp(value: unknown, where: string): RegExp {
  if (typeof value !== 'string' || value.length === 0) return fail(`${where} must be a non-empty pattern string`);
  try {
    return new RegExp(value);
  } catch (err) {
    return fail(`${where} is not a valid regular expression (${(err as Error).message})`);
  }
}

function asOptionalRegExp(value: unknown, where: string): RegExp | null {
  return value === undefined || value === null ? null : asRegExp(value, where);
}

function asPath(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/.test(value)) {
    return fail(`${where} must be a dotted path like "patient.familyName"`);
  }
  return value;
}

function asTransforms(value: unknown, where: string): Record<string, TransformName> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null) return fail(`${where} must be an object`);
  const out: Record<string, TransformName> = {};
  for (const [group, name] of Object.entries(value as Record<string, unknown>)) {
    if (typeof name !== 'string' || !(TRANSFORMS as readonly string[]).includes(name)) {
      return fail(`${where}.${group} must be one of: ${TRANSFORMS.join(', ')}`);
    }
    out[group] = name as TransformName;
  }
  return out;
}

/** Named groups the pattern actually declares — a typo in `paths` is otherwise silent. */
function namedGroupsOf(pattern: RegExp): Set<string> {
  return new Set([...pattern.source.matchAll(/\(\?<([A-Za-z][A-Za-z0-9]*)>/g)].map((m) => m[1]));
}

function parseExtractor(raw: unknown, index: number): Extractor {
  const where = `extractors[${index}]`;
  if (typeof raw !== 'object' || raw === null) return fail(`${where} is not an object`);
  const entry = raw as Record<string, unknown>;

  const kind = entry.kind;
  if (typeof kind !== 'string' || !(EXTRACTOR_KINDS as readonly string[]).includes(kind)) {
    return fail(`${where}.kind must be one of: ${EXTRACTOR_KINDS.join(', ')}`);
  }

  if (kind === 'line') {
    const pattern = asRegExp(entry.pattern, `${where}.pattern`);
    const groups = namedGroupsOf(pattern);
    if (typeof entry.paths !== 'object' || entry.paths === null) return fail(`${where}.paths must be an object`);
    const paths: Record<string, string> = {};
    for (const [group, path] of Object.entries(entry.paths as Record<string, unknown>)) {
      if (!groups.has(group)) return fail(`${where}.paths names group "${group}", which the pattern does not capture`);
      paths[group] = asPath(path, `${where}.paths.${group}`);
    }
    if (Object.keys(paths).length === 0) return fail(`${where}.paths must name at least one group`);
    return { kind: 'line', pattern, paths, transforms: asTransforms(entry.transforms, `${where}.transforms`) };
  }

  if (kind === 'lines') {
    return {
      kind: 'lines',
      path: asPath(entry.path, `${where}.path`),
      after: asRegExp(entry.after, `${where}.after`),
      stopPattern: asRegExp(entry.stopPattern, `${where}.stopPattern`),
      excludePattern: asOptionalRegExp(entry.excludePattern, `${where}.excludePattern`),
    };
  }

  if (kind === 'paragraphs') {
    if (!Array.isArray(entry.startPatterns) || entry.startPatterns.length === 0) {
      return fail(`${where}.startPatterns must be a non-empty array`);
    }
    return {
      kind: 'paragraphs',
      path: asPath(entry.path, `${where}.path`),
      startPatterns: entry.startPatterns.map((p, i) => asRegExp(p, `${where}.startPatterns[${i}]`)),
      stopPattern: asOptionalRegExp(entry.stopPattern, `${where}.stopPattern`),
    };
  }

  if (kind === 'flag') {
    return {
      kind: 'flag',
      path: asPath(entry.path, `${where}.path`),
      truePattern: asRegExp(entry.truePattern, `${where}.truePattern`),
    };
  }

  if (kind === 'derive') {
    if (typeof entry.prefix !== 'string') return fail(`${where}.prefix must be a string`);
    return {
      kind: 'derive',
      path: asPath(entry.path, `${where}.path`),
      from: asPath(entry.from, `${where}.from`),
      prefix: entry.prefix,
    };
  }

  // row | rows
  const pattern = asRegExp(entry.pattern, `${where}.pattern`);
  const groups = namedGroupsOf(pattern);

  const constants: Record<string, string | boolean> = {};
  if (entry.constants !== undefined) {
    if (typeof entry.constants !== 'object' || entry.constants === null) {
      return fail(`${where}.constants must be an object`);
    }
    for (const [field, value] of Object.entries(entry.constants as Record<string, unknown>)) {
      if (typeof value !== 'string' && typeof value !== 'boolean') {
        return fail(`${where}.constants.${field} must be a string or a boolean`);
      }
      constants[field] = value;
    }
  }

  const flags: Record<string, RegExp> = {};
  if (entry.flags !== undefined) {
    if (typeof entry.flags !== 'object' || entry.flags === null) return fail(`${where}.flags must be an object`);
    for (const [field, p] of Object.entries(entry.flags as Record<string, unknown>)) {
      flags[field] = asRegExp(p, `${where}.flags.${field}`);
    }
  }
  let flagsFrom: string | null = null;
  if (entry.flagsFrom !== undefined) {
    if (typeof entry.flagsFrom !== 'string' || !groups.has(entry.flagsFrom)) {
      return fail(`${where}.flagsFrom must name a group the pattern captures`);
    }
    flagsFrom = entry.flagsFrom;
  }
  if (Object.keys(flags).length > 0 && flagsFrom === null) {
    return fail(`${where}.flags needs ${where}.flagsFrom to say which group the flags are tested against`);
  }

  const derive: Record<string, { from: string; prefix: string }> = {};
  if (entry.derive !== undefined) {
    if (typeof entry.derive !== 'object' || entry.derive === null) return fail(`${where}.derive must be an object`);
    for (const [field, spec] of Object.entries(entry.derive as Record<string, unknown>)) {
      if (typeof spec !== 'object' || spec === null) return fail(`${where}.derive.${field} must be an object`);
      const s = spec as Record<string, unknown>;
      if (typeof s.from !== 'string' || !groups.has(s.from)) {
        return fail(`${where}.derive.${field}.from must name a group the pattern captures`);
      }
      if (typeof s.prefix !== 'string') return fail(`${where}.derive.${field}.prefix must be a string`);
      derive[field] = { from: s.from, prefix: s.prefix };
    }
  }

  let continueInto: string | null = null;
  if (entry.continueInto !== undefined) {
    if (typeof entry.continueInto !== 'string' || !groups.has(entry.continueInto)) {
      return fail(`${where}.continueInto must name a group the pattern captures`);
    }
    continueInto = entry.continueInto;
  }
  const continueUntil = asOptionalRegExp(entry.continueUntil, `${where}.continueUntil`);
  if (continueInto !== null && continueUntil === null) {
    return fail(`${where}.continueInto needs ${where}.continueUntil, or it would swallow the rest of the page`);
  }

  return {
    kind: kind as 'row' | 'rows',
    path: asPath(entry.path, `${where}.path`),
    pattern,
    constants,
    transforms: asTransforms(entry.transforms, `${where}.transforms`),
    flags,
    flagsFrom,
    derive,
    continueInto,
    continueUntil,
  };
}

export function parseTemplate(raw: unknown): ParserTemplate {
  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (typeof doc.pms !== 'string' || doc.pms.trim().length === 0) return fail('`pms` must be a non-empty string');
  if (typeof doc.documentType !== 'string' || doc.documentType.trim().length === 0) {
    return fail('`documentType` must be a non-empty string');
  }
  if (!Array.isArray(doc.extractors) || doc.extractors.length === 0) {
    return fail('`extractors` must be a non-empty array');
  }

  const constants: Record<string, string> = {};
  if (doc.constants !== undefined) {
    if (typeof doc.constants !== 'object' || doc.constants === null) return fail('`constants` must be an object');
    for (const [path, value] of Object.entries(doc.constants as Record<string, unknown>)) {
      if (typeof value !== 'string') return fail(`constants["${path}"] must be a string`);
      constants[asPath(path, `constants["${path}"]`)] = value;
    }
  }

  return {
    version: doc.version,
    pms: doc.pms,
    documentType: doc.documentType,
    constants,
    extractors: doc.extractors.map(parseExtractor),
  };
}

/*
 * THE TEMPLATE SET, loaded and validated at module load.
 *
 * Every version ever shipped stays here, oldest first. A superseded template is
 * never edited and never dropped: a record stamped with it must still be
 * re-read against the template that made it (hard rule 14). Each is imported
 * rather than read from disk so that the installed program carries its
 * templates in its own bundle — a desktop that reads its parser from a folder
 * is a desktop where somebody can change the parser, and the version on the
 * record would then be a claim rather than a fact.
 */
import pracsoft3Db4September from '../content/pracsoft3-db4-2026-09-1.json';
import pracsoft3Db4October from '../content/pracsoft3-db4-2026-10-1.json';

const TEMPLATES: readonly ParserTemplate[] = [
  parseTemplate(pracsoft3Db4September),
  parseTemplate(pracsoft3Db4October),
];

export function templateFor(version: string): ParserTemplate | null {
  return TEMPLATES.find((t) => t.version === version) ?? null;
}

/**
 * The template a fresh install parses with, until configuration says otherwise.
 *
 * -10-1 SINCE 10 OCTOBER 2026 (D-2026-10-10-08): identical to -09-1 except that
 * the amount keeps the `$` PracSoft printed. A config.json that names -09-1 in
 * `templateVersion` keeps parsing with it until that line is changed.
 */
export const DEFAULT_TEMPLATE_VERSION = 'pracsoft3-db4-2026-10-1';

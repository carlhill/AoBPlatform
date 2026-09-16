/**
 * Read the text layer out of a spooled print job, with its LINES intact.
 *
 * WHY THIS EXISTS WHEN `apps/core/src/artefacts/extract-text.ts` ALREADY READS
 * PDFs. It is the second copy, knowingly (wow.md §10 rule of three: write it,
 * wince, and extract at the third). Two reasons it is not a call into that one:
 *
 *   1. IT ANSWERS A DIFFERENT QUESTION. `extractText` answers "does this
 *      identifier appear anywhere in this uploaded evidence" and flattens the
 *      whole document to one whitespace-collapsed run, which is exactly right
 *      for that. A DB4 parser needs "what is on the line that begins
 *      `Medicare Card Number:`" — the layout IS the grammar, and flattening it
 *      throws the grammar away.
 *
 *   2. ON THIS EXACT INPUT IT RETURNS 90KB OF FONT BINARY FIRST. Measured on
 *      17 Sep 2026 against a page printed to AOBPRINTER through "Microsoft
 *      Print To PDF": the form's text is all there and correct, at the END of
 *      the string, behind the innards of an embedded TrueType subset. The
 *      filter over there rejects a stream whose dict says
 *      `/Subtype /TrueType`, but an embedded font PROGRAM is a `FontFile2`
 *      stream whose dict says `/Length1` and carries no `/Subtype` at all, and
 *      its bytes happen to contain `Tj`. A parser that must be deterministic
 *      cannot sift a record out of a font. (Reported to Carl: a `/Length1`
 *      test would fix it over there too, but `apps/core` is out of scope for
 *      this build.)
 *
 * WHAT IT DOES NOT DO, and says so rather than guessing: no encryption, no
 * filter but Flate, no OCR. A scanned or image-only print has no text layer,
 * and this returns null for it — which the watcher reports as "not parseable"
 * and never as an empty form.
 *
 * NO NEW DEPENDENCY. `node:zlib` is in the runtime. A PDF library would read
 * more formats and would also be a parser with a CVE history running against
 * whatever a practice printed; the same argument that keeps one out of the
 * artefact path keeps one out of here.
 */
import { inflateSync } from 'node:zlib';

/** A decompression bomb guard: a small stream that inflates to gigabytes. */
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;
/** A print job is one or two pages. Anything past this is not a DB4. */
const MAX_TEXT_CHARS = 400_000;

/**
 * A run of shown text and where it was shown, in unscaled text-space units.
 * Only `y` is kept: lines are what the parser needs, and the horizontal
 * position of a run within its line is carried by the order it was drawn.
 */
interface TextRun {
  readonly text: string;
  readonly y: number;
  readonly order: number;
}

interface RawStream {
  readonly inflated: string;
  /** The object dictionary immediately before the keyword — what the stream IS. */
  readonly dict: string;
}

/**
 * True for a stream that is a font program, an image, or anything else whose
 * bytes are not a content stream. THIS IS THE FILTER THAT MATTERS: a font
 * program inflates happily and yields its own tables as "text".
 */
function isNotAContentStream(dict: string): boolean {
  // /Length1 (and /Length2, /Length3) appear only on embedded font programs —
  // Type1, TrueType and CFF alike. This is the test the core extractor lacks.
  if (/\/Length[123]\b/.test(dict)) return true;
  if (/\/Subtype\s*\/(Image|Type1C|TrueType|CIDFontType\d|Type1|OpenType)\b/.test(dict)) return true;
  if (/\/Type\s*\/(XObject|Font|FontDescriptor|Metadata)\b/.test(dict) && !/\/Subtype\s*\/Form\b/.test(dict)) {
    return true;
  }
  return false;
}

function readStreams(buffer: Buffer): RawStream[] {
  // Latin-1 so byte offsets and string indices stay in step; a multi-byte
  // decode would shift every position and break the stream boundaries.
  const raw = buffer.toString('latin1');
  const out: RawStream[] = [];

  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf('stream', cursor);
    if (start === -1) break;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;

    const dictStart = raw.lastIndexOf('<<', start);
    const dict = dictStart === -1 ? '' : raw.slice(dictStart, start);

    let from = start + 'stream'.length;
    if (raw[from] === '\r') from += 1;
    if (raw[from] === '\n') from += 1;

    const slice = buffer.subarray(from, end);
    cursor = end + 'endstream'.length;

    try {
      const inflated =
        slice[0] === 0x78
          ? inflateSync(slice, { maxOutputLength: MAX_INFLATED_BYTES }).toString('latin1')
          : slice.toString('latin1');
      out.push({ inflated, dict });
    } catch {
      // A stream we cannot inflate is skipped, never fatal: a PDF has many and
      // the ones carrying the form may well be readable.
    }
  }

  return out;
}

/**
 * Merge every ToUnicode CMap in the document into one code → text map.
 *
 * The printer driver embeds SUBSET fonts, where a character code is a glyph
 * index private to that font: the code for "2" may be 0x03. The page is
 * readable on screen because the viewer follows the font's ToUnicode map, and
 * unreadable to a naive scraper because nothing in the content stream looks
 * like a digit.
 *
 * Merged rather than tracked per font, deliberately: following `Tf` to know
 * which font is active is real parser territory, and for reading a printed
 * form a union is right in every case but two subset fonts disagreeing on a
 * code — which yields a wrong character, never a crash.
 */
function buildToUnicode(streams: readonly RawStream[]): Map<number, string> {
  const map = new Map<number, string>();

  for (const stream of streams) {
    const text = stream.inflated;
    if (!text.includes('beginbfchar') && !text.includes('beginbfrange')) continue;

    for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
      for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(parseInt(m[1], 16), hexToUtf16(m[2]));
      }
    }

    for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
      // <lo> <hi> <dstStart>
      for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const lo = parseInt(m[1], 16);
        const hi = parseInt(m[2], 16);
        const dst = parseInt(m[3], 16);
        if (hi < lo || hi - lo > 0xffff) continue;
        for (let code = lo; code <= hi; code += 1) map.set(code, String.fromCharCode(dst + (code - lo)));
      }
      // <lo> <hi> [<d0> <d1> ...]
      for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
        const lo = parseInt(m[1], 16);
        (m[3].match(/<([0-9A-Fa-f]+)>/g) ?? []).forEach((item, i) => map.set(lo + i, hexToUtf16(item.slice(1, -1))));
      }
    }
  }

  return map;
}

function hexToUtf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const unit = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(unit)) out += String.fromCharCode(unit);
  }
  return out;
}

function decodeHex(hex: string, toUnicode: Map<number, string>): string {
  const clean = hex.replace(/\s/g, '');
  const width = toUnicode.size > 0 ? 4 : 2;
  let decoded = '';
  for (let i = 0; i + width <= clean.length; i += width) {
    const code = parseInt(clean.slice(i, i + width), 16);
    decoded += toUnicode.get(code) ?? (code >= 32 && code < 127 ? String.fromCharCode(code) : '');
  }
  return decoded;
}

/** One bracketed literal `(...)`, with the PDF escapes undone. */
function decodeLiteral(body: string, toUnicode: Map<number, string>): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let octal = '';
      let j = i + 1;
      while (j < body.length && octal.length < 3 && body[j] >= '0' && body[j] <= '7') {
        octal += body[j];
        j += 1;
      }
      out += String.fromCharCode(parseInt(octal, 8));
      i = j - 1;
      continue;
    }
    const mapped: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '', f: '' };
    out += mapped[next] ?? next;
    i += 1;
  }
  return toUnicode.size > 0 ? [...out].map((c) => toUnicode.get(c.charCodeAt(0)) ?? c).join('') : out;
}

/**
 * Walk one content stream, following the text-positioning operators far enough
 * to know which runs share a line.
 *
 * The operators that move the text cursor vertically:
 *   `Td` / `TD`  tx ty       — relative move; ty is the line step
 *   `Tm`         a b c d e f — absolute matrix; f is the y
 *   `T*`                     — next line, by the leading `TL`
 *   `TD`                     — also sets the leading
 *   `'` and `"`              — next line, then show
 *
 * A driver may well emit `1 0 0 1 x y Tm` per line, which is the simple case.
 * Following `Td` too keeps a driver that moves relatively readable.
 */
function scrapeRuns(stream: string, toUnicode: Map<number, string>, startOrder: number): TextRun[] {
  const runs: TextRun[] = [];
  let order = startOrder;
  let y = 0;
  let leading = 0;

  // One pass over the operators we care about, in source order. The alternation
  // is ordered so a longer operator name cannot be eaten by a shorter one.
  const TOKENS =
    /(\[[^\]]*\]\s*TJ)|(\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|"))|(<([0-9A-Fa-f\s]*)>\s*(?:Tj|'|"))|(-?[\d.]+)\s+(-?[\d.]+)\s+(TD|Td)\b|((?:-?[\d.]+\s+){6})Tm\b|(-?[\d.]+)\s+TL\b|(T\*)/g;

  for (const m of stream.matchAll(TOKENS)) {
    if (m[1] !== undefined) {
      // [ (a) -250 (b) <00480049> ] TJ — a kerned line. Kerns do not break it.
      const body = m[1];
      let text = '';
      for (const piece of body.matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]*)>/g)) {
        text += piece[1] !== undefined ? decodeLiteral(piece[1], toUnicode) : decodeHex(piece[2] ?? '', toUnicode);
      }
      if (text) runs.push({ text, y, order: (order += 1) });
      continue;
    }
    if (m[2] !== undefined) {
      const text = decodeLiteral(m[3] ?? '', toUnicode);
      if (text) runs.push({ text, y, order: (order += 1) });
      continue;
    }
    if (m[4] !== undefined) {
      const text = decodeHex(m[5] ?? '', toUnicode);
      if (text) runs.push({ text, y, order: (order += 1) });
      continue;
    }
    if (m[8] !== undefined) {
      // tx ty Td|TD
      const ty = Number(m[7]);
      if (Number.isFinite(ty)) y += ty;
      if (m[8] === 'TD' && Number.isFinite(ty)) leading = -ty;
      continue;
    }
    if (m[9] !== undefined) {
      const nums = m[9].trim().split(/\s+/).map(Number);
      const f = nums[5];
      if (Number.isFinite(f)) y = f;
      continue;
    }
    if (m[10] !== undefined) {
      const tl = Number(m[10]);
      if (Number.isFinite(tl)) leading = tl;
      continue;
    }
    if (m[11] !== undefined) {
      y -= leading;
    }
  }

  return runs;
}

/**
 * Lines are runs grouped by y; the LINES are ordered by the order they were
 * drawn, and so are the runs within a line.
 *
 * WHY DRAW ORDER AND NOT y, which would be the obvious choice. The sign of y
 * is the driver's to decide. PDF text space has y growing upward, so "top of
 * the page first" is descending y — but a driver is free to install a flipping
 * matrix (`1 0 0 -1 0 H cm`) and work in device coordinates, and "Microsoft
 * Print To PDF" does exactly that: sorting by descending y returned this form
 * upside down, signature line first, on 17 Sep 2026. Guessing the sign from
 * the content would be a guess. Draw order needs no guess: a driver rendering
 * a page emits it in reading order, and if one ever does not, that is visible
 * in the template's fixture rather than silently wrong.
 *
 * y still does the job only it can do — saying which runs SHARE a line, so a
 * label and its value stay together. The tolerance keeps a superscript or a
 * nudged baseline on the line it belongs to.
 */
const SAME_LINE_TOLERANCE = 3;

function runsToLines(runs: readonly TextRun[]): string[] {
  if (runs.length === 0) return [];

  // Cluster by y. Greedy over runs sorted by y, which makes the clustering
  // independent of draw order and therefore stable.
  const byY = [...runs].sort((a, b) => a.y - b.y || a.order - b.order);
  const clusters: TextRun[][] = [];
  let current: TextRun[] = [byY[0]];
  let anchor = byY[0].y;
  for (const run of byY.slice(1)) {
    if (Math.abs(run.y - anchor) > SAME_LINE_TOLERANCE) {
      clusters.push(current);
      current = [];
      anchor = run.y;
    }
    current.push(run);
  }
  clusters.push(current);

  return clusters
    .map((cluster) => ({
      first: Math.min(...cluster.map((r) => r.order)),
      text: [...cluster]
        .sort((a, b) => a.order - b.order)
        .map((r) => r.text.replace(/\r\n?/g, '\n'))
        .join(' '),
    }))
    .sort((a, b) => a.first - b.first)
    .flatMap((cluster) => cluster.text.split('\n'))
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

export interface PdfText {
  /** The page's lines, top to bottom. The parser's template matches against these. */
  readonly lines: readonly string[];
  /** The same lines joined by "\n" — what a multiline regex runs over. */
  readonly text: string;
}

/**
 * The spool bytes in, the printed lines out. `null` means WE COULD NOT READ
 * IT — never "the page was blank". The two are different facts and the caller
 * must never let them look the same.
 */
export function readPdfText(bytes: Uint8Array): PdfText | null {
  const buffer = Buffer.from(bytes);
  const streams = readStreams(buffer);
  if (streams.length === 0) return null;

  const toUnicode = buildToUnicode(streams);

  const runs: TextRun[] = [];
  for (const stream of streams) {
    if (isNotAContentStream(stream.dict)) continue;
    if (!/\bBT\b/.test(stream.inflated)) continue;
    runs.push(...scrapeRuns(stream.inflated, toUnicode, runs.length));
    if (runs.length > MAX_TEXT_CHARS) break;
  }

  const lines = runsToLines(runs);
  if (lines.length === 0) return null;

  const text = lines.join('\n').slice(0, MAX_TEXT_CHARS);
  return { lines: text.split('\n'), text };
}

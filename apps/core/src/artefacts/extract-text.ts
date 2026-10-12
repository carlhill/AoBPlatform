import { inflateSync } from 'node:zlib';

/**
 * Pull readable text out of an uploaded file, for checking that evidence
 * actually contains what it is cited as proving.
 *
 * WHY THIS IS HAND-ROLLED. A PDF library would do it better, and CLAUDE.md §7
 * requires asking before adding a dependency. But the stronger argument is
 * security rather than process: PDF parsers are a long-standing source of
 * remote-code-execution CVEs, and this runs against files uploaded by people we
 * are in the middle of deciding whether to trust. A deliberately small reader
 * that inflates streams and scrapes string literals has far less to go wrong
 * than a full parser, and when it cannot cope it returns null rather than
 * executing something.
 *
 * THE HARD PART, learned the hard way. The first real file this met was an ABN
 * Lookup page saved from a browser, and it reported the ABN absent when the ABN
 * was plainly there. Two reasons, both now handled:
 *
 *   1. IT WAS SCRAPING FONT BINARIES. A PDF stores embedded fonts in streams
 *      too, so inflating every stream and pulling bracketed runs out of it
 *      yields the innards of a TrueType file — `glyf`, `hmtx`, `loca` — as
 *      "text". Only streams carrying text operators are scraped now.
 *
 *   2. THE TEXT WAS NOT ASCII. Browser-generated PDFs embed SUBSET fonts, where
 *      character codes are glyph indices private to that font: the code for "2"
 *      might be 0x03. The page is readable on screen because the viewer follows
 *      the font's ToUnicode map, and unreadable to a naive scraper because
 *      nothing in the content stream resembles a digit.
 *
 *      So the ToUnicode CMaps are parsed and applied. They are merged into one
 *      map rather than tracked per font, which is a deliberate simplification:
 *      following `Tf` operators to know which font is active is real parser
 *      territory, and for the question actually being asked — does this string
 *      of digits appear — a union is close enough. Where two subset fonts
 *      disagree on a code the result is a wrong character, not a crash.
 *
 * WHAT IT STILL DOES NOT HANDLE, and says so rather than guessing:
 *   - images. A screenshot is pixels; reading it needs OCR, a large dependency
 *     and a separate decision
 *   - encrypted PDFs, and filters other than Flate
 *
 * A null return means WE COULD NOT READ IT — never "it was empty". The caller
 * must keep those apart: "we could not check" and "we checked and it was fine"
 * are different facts and must never look the same on screen.
 */

/** Guard against a decompression bomb: a small stream inflating to gigabytes. */
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;
/** Enough text to find an identifier in; no reason to hold a whole book. */
const MAX_TEXT_CHARS = 400_000;

export function extractText(bytes: Uint8Array, contentType: string): string | null {
  if (contentType.startsWith('text/') || contentType === 'message/rfc822') {
    return Buffer.from(bytes).toString('utf8').slice(0, MAX_TEXT_CHARS);
  }
  if (contentType === 'application/pdf') {
    return extractPdfText(bytes);
  }
  // Images and everything else. Not readable here, and saying so is the point.
  return null;
}

interface RawStream {
  readonly inflated: string;
  /** The object dictionary preceding it, which says what the stream IS. */
  readonly dict: string;
}

function readStreams(buffer: Buffer): RawStream[] {
  // Latin-1 so byte offsets and string indices stay in step — a multi-byte
  // decode would shift every position and break the stream boundaries.
  const raw = buffer.toString('latin1');
  const out: RawStream[] = [];

  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf('stream', cursor);
    if (start === -1) break;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;

    // The dictionary immediately before the keyword tells us the stream's type.
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
      // A stream we cannot inflate is skipped, not fatal: a PDF has many and
      // the ones that matter may well be readable.
    }
  }

  return out;
}

/**
 * Merge every ToUnicode CMap in the document into one code → text map.
 *
 * A CMap declares mappings in two forms:
 *
 *   beginbfchar  <0003> <0032>            endbfchar
 *   beginbfrange <0003> <0005> <0032>     endbfrange
 *   beginbfrange <0003> <0004> [<0032> <0041>] endbfrange
 *
 * All three appear in browser-generated PDFs and all three are handled. The
 * destination may be several UTF-16 code units — a ligature maps one code to
 * "fi" — so it is decoded as a string rather than a single character.
 */
function buildToUnicode(streams: readonly RawStream[]): Map<number, string> {
  const map = new Map<number, string>();

  for (const stream of streams) {
    if (!stream.inflated.includes('beginbfchar') && !stream.inflated.includes('beginbfrange')) continue;
    const text = stream.inflated;

    for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
      for (const pair of block.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
        const m = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(pair);
        if (!m) continue;
        map.set(parseInt(m[1], 16), hexToUtf16(m[2]));
      }
    }

    for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
      // Form A: <lo> <hi> <dstStart>
      for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const lo = parseInt(m[1], 16);
        const hi = parseInt(m[2], 16);
        const dst = parseInt(m[3], 16);
        // A malformed range could otherwise spin for a very long time.
        if (hi < lo || hi - lo > 0xffff) continue;
        for (let code = lo; code <= hi; code += 1) {
          map.set(code, String.fromCharCode(dst + (code - lo)));
        }
      }
      // Form B: <lo> <hi> [<d0> <d1> ...]
      for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
        const lo = parseInt(m[1], 16);
        const items = m[3].match(/<([0-9A-Fa-f]+)>/g) ?? [];
        items.forEach((item, i) => {
          const hex = item.slice(1, -1);
          map.set(lo + i, hexToUtf16(hex));
        });
      }
    }
  }

  return map;
}

function hexToUtf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const unit = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(unit)) out += String.fromCharCode(unit);
  }
  return out;
}

function extractPdfText(bytes: Uint8Array): string | null {
  const streams = readStreams(Buffer.from(bytes));
  if (streams.length === 0) return null;

  const toUnicode = buildToUnicode(streams);

  const pieces: string[] = [];
  for (const stream of streams) {
    // ONLY content streams. A font or image stream inflates happily and yields
    // its own binary as "text" — which is how this reported an ABN missing
    // from a document that showed it in 24-point type.
    if (!/\b(Tj|TJ)\b/.test(stream.inflated)) continue;
    if (/\/Subtype\s*\/(Image|Type1C|TrueType|CIDFontType\d)/.test(stream.dict)) continue;

    pieces.push(scrapeText(stream.inflated, toUnicode));
    if (pieces.join('').length > MAX_TEXT_CHARS) break;
  }

  const joined = pieces.join(' ').replace(/\s+/g, ' ').trim();
  // Nothing recovered means we could not read it, NOT that it was empty.
  return joined.length === 0 ? null : joined.slice(0, MAX_TEXT_CHARS);
}

/**
 * Pull the shown text out of a content stream.
 *
 * Two literal forms carry it, and browser PDFs use the second almost
 * exclusively:
 *
 *   (Some text) Tj              — bracketed, one byte per code
 *   <0003000400> Tj             — hex, two bytes per code for a CID font
 *
 * Both are decoded through the ToUnicode map when it has an entry, and left
 * alone when it does not — an ASCII-encoded PDF has no map and needs none.
 */
function scrapeText(stream: string, toUnicode: Map<number, string>): string {
  const out: string[] = [];

  /*
   * KERNED ARRAYS FIRST: `[<48656c> 50 <6c6f>] TJ`.
   *
   * A show-text array interleaves hex (or literal) runs with kern adjustments,
   * so most of its runs are followed by a NUMBER rather than by `TJ` or `]`.
   * The old rule below only matched a run sitting immediately before one of
   * those, which meant every run but the last of a kerned line was dropped —
   * and a PDF our own renderer produces is kerned on every line, so this read
   * as "unreadable" rather than as "missing a word" (Carl, 5 Sep 2026).
   *
   * The arrays are scraped and then REMOVED from the string, so the rule below
   * cannot count a run twice.
   */
  const withoutArrays = stream.replace(/\[([^\]]*)\]\s*TJ/g, (_whole, body: string) => {
    const decoded = (body.match(/<([0-9A-Fa-f\s]*)>/g) ?? [])
      .map((token) => decodeHex(token.slice(1, -1), toUnicode))
      .join('');
    if (decoded) out.push(decoded);
    // The literal runs inside the array — `[(Hel) 50 (lo)] TJ` — are left in
    // place for the bracketed-literal pass below, which reads them correctly.
    return body.replace(/<[0-9A-Fa-f\s]*>/g, ' ');
  });

  // Hex strings shown on their own: `<hhhh...> Tj`. Two-byte codes when the
  // map is two-byte, which is the usual case for the subset fonts browsers
  // embed.
  for (const m of withoutArrays.matchAll(/<([0-9A-Fa-f\s]{2,})>\s*(?:Tj|TJ|\])/g)) {
    const decoded = decodeHex(m[1], toUnicode);
    if (decoded) out.push(decoded);
  }

  // Bracketed literals.
  let inString = false;
  let depth = 0;
  let current = '';
  for (let i = 0; i < withoutArrays.length; i += 1) {
    const ch = withoutArrays[i];

    if (!inString) {
      if (ch === '(') {
        inString = true;
        depth = 1;
        current = '';
      }
      continue;
    }

    if (ch === '\\') {
      const next = withoutArrays[i + 1];
      if (next === undefined) break;
      if (next >= '0' && next <= '7') {
        let octal = '';
        let j = i + 1;
        while (
          j < withoutArrays.length &&
          octal.length < 3 &&
          withoutArrays[j] >= '0' &&
          withoutArrays[j] <= '7'
        ) {
          octal += withoutArrays[j];
          j += 1;
        }
        current += String.fromCharCode(parseInt(octal, 8));
        i = j - 1;
      } else {
        const mapped: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '', f: '' };
        current += mapped[next] ?? next;
        i += 1;
      }
      continue;
    }

    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        // Map single-byte codes through ToUnicode where the font is a subset.
        const decoded =
          toUnicode.size > 0
            ? [...current].map((c) => toUnicode.get(c.charCodeAt(0)) ?? c).join('')
            : current;
        out.push(decoded);
        inString = false;
        current = '';
      } else {
        current += ch;
      }
      continue;
    }

    current += ch;
  }

  return out.join(' ');
}

/**
 * One hex run to text. Codes are two bytes wide where a ToUnicode map is in
 * play (subset fonts) and one byte otherwise — the base-14 fonts our own
 * renderer pins have no map and need none.
 */
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

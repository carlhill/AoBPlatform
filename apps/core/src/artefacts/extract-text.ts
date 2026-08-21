import { inflateSync } from 'node:zlib';

/**
 * Pull readable text out of an uploaded file, for checking that evidence
 * actually contains what it is cited as proving.
 *
 * WHY THIS IS HAND-ROLLED. A PDF library would do it better, and CLAUDE.md §7
 * requires asking before adding a dependency. But the stronger argument is
 * security rather than process: PDF parsers are a long-standing source of
 * remote-code-execution CVEs, and this code runs against files uploaded by
 * people we are in the middle of deciding whether to trust. A deliberately
 * small reader that only inflates streams and scrapes string literals has far
 * less to go wrong than a full parser, and the failure mode when it cannot cope
 * is "returns null", not "executes something".
 *
 * WHAT IT HANDLES:
 *   - text/plain and message/rfc822, directly
 *   - PDFs whose content streams are FlateDecode or uncompressed, which covers
 *     print-to-PDF and browser "save as PDF" — exactly how somebody captures an
 *     ABN Lookup page
 *
 * WHAT IT DOES NOT, and says so rather than guessing:
 *   - images. A screenshot is pixels; reading it needs OCR, which is a large
 *     dependency and a separate decision
 *   - PDFs using other filters, encryption, or fonts with custom encodings
 *
 * A null return means WE COULD NOT READ IT — never "it was empty". The caller
 * must keep those apart, because "we could not check" and "we checked and it
 * was fine" are different facts and must never look the same on screen.
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

/**
 * Scrape text from a PDF's content streams.
 *
 * A PDF's page text lives inside `stream ... endstream` blocks, usually
 * Flate-compressed. Inside, text-showing operators carry string literals in
 * round brackets — `(Some text) Tj` — or arrays of them for kerned runs,
 * `[(Som) -20 (e text)] TJ`. Scraping the bracketed literals recovers the
 * words, in roughly the right order, which is all that is needed to search for
 * a number.
 *
 * It does NOT reconstruct layout, reading order, tables or columns, and it is
 * not trying to. Anything that needs those needs a real parser.
 */
function extractPdfText(bytes: Uint8Array): string | null {
  const buffer = Buffer.from(bytes);
  const pieces: string[] = [];

  // Latin-1 so byte offsets and string indices stay in step — a multi-byte
  // decode would shift every position and break the stream boundaries.
  const raw = buffer.toString('latin1');

  let cursor = 0;
  while (cursor < raw.length && pieces.join('').length < MAX_TEXT_CHARS) {
    const start = raw.indexOf('stream', cursor);
    if (start === -1) break;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;

    // Skip the EOL after the `stream` keyword: CRLF or a bare LF, per the spec.
    let from = start + 'stream'.length;
    if (raw[from] === '\r') from += 1;
    if (raw[from] === '\n') from += 1;

    const slice = buffer.subarray(from, end);
    cursor = end + 'endstream'.length;

    let text: string;
    try {
      // Flate streams begin 0x78. Anything else is tried as-is, which covers
      // the uncompressed case and harmlessly produces noise otherwise.
      text = slice[0] === 0x78 ? inflateBounded(slice) : slice.toString('latin1');
    } catch {
      // A stream we cannot inflate is skipped, not fatal: a PDF has many
      // streams and the ones we want may well be readable.
      continue;
    }

    pieces.push(scrapeLiterals(text));
  }

  const joined = pieces.join(' ').replace(/\s+/g, ' ').trim();
  // Nothing recovered means we could not read it, NOT that it was empty.
  return joined.length === 0 ? null : joined.slice(0, MAX_TEXT_CHARS);
}

function inflateBounded(slice: Buffer): string {
  const out = inflateSync(slice, { maxOutputLength: MAX_INFLATED_BYTES });
  return out.toString('latin1');
}

/**
 * Pull the bracketed string literals out of a content stream.
 *
 * PDF string escapes are honoured for the ones that matter — \( \) \\ and the
 * octal form — because an unescaped bracket would otherwise truncate a run at
 * the wrong place and could hide the very digits being searched for.
 */
function scrapeLiterals(stream: string): string {
  const out: string[] = [];
  let inString = false;
  let depth = 0;
  let current = '';

  for (let i = 0; i < stream.length; i += 1) {
    const ch = stream[i];

    if (!inString) {
      if (ch === '(') {
        inString = true;
        depth = 1;
        current = '';
      }
      continue;
    }

    if (ch === '\\') {
      const next = stream[i + 1];
      if (next === undefined) break;
      if (next >= '0' && next <= '7') {
        // Octal escape: up to three digits.
        let octal = '';
        let j = i + 1;
        while (j < stream.length && octal.length < 3 && stream[j] >= '0' && stream[j] <= '7') {
          octal += stream[j];
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
        out.push(current);
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

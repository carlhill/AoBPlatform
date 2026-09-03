#!/usr/bin/env node
/**
 * Guards the kiosk string table (REQ-LANG-01) and the guardrail language rule
 * (REQ-65C-05 / hard rule 12). Runs inside `lint`, which is the gate before a
 * commit, so a violation is caught before it reaches a screen.
 *
 * THREE CHECKS, in increasing order of how much they cost when missed:
 *
 *   1. DUPLICATE KEYS. `strings.ts` is one object literal; the later key wins
 *      silently at runtime. TypeScript does catch it (TS1117) but only at
 *      typecheck, by which point the dev server is already showing a build
 *      error to whoever is using it. Same rationale, same shape, as
 *      apps/web/check-strings.mjs.
 *
 *   2. BANNED WORDS. "certified", "approved", "accredited",
 *      "government-approved" — a form that claims a government blessing it
 *      does not have is the one piece of copy in this product that could not
 *      be walked back. Note the word boundary: "approve" (as in tap to
 *      approve, which is a signature method) is fine; "approved" is not.
 *      Permitted phrasings are "checked against the s 65C data set" and
 *      "self-assessment".
 *
 *   3. INLINE USER-FACING TEXT. A literal inside a `<Text>` element is a
 *      string that will never be translated and that nobody will find when the
 *      multilingual pipeline lands. It fails here rather than being noticed
 *      three languages later.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TABLE = join(here, 'src', 'strings.ts');

/**
 * Split, and drop a trailing carriage return.
 *
 * NOT A TIDY-UP. `.` in a JavaScript regular expression does not match `\r`,
 * so on a CRLF checkout `^\s*\*.*$` fails to match a comment line and the
 * comment strip below silently does nothing — which made this script fail the
 * build on its OWN prose about the banned words. It cost twenty minutes and it
 * would have cost the next person the same.
 */
function readLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

const lines = readLines(TABLE);

const failures = [];

// --- 1. duplicate keys -----------------------------------------------------
const path = [];
const seen = new Map();
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i].trim();
  const opens = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{/.exec(line);
  if (opens) {
    path.push(opens[1]);
    continue;
  }
  if (line.startsWith('}')) {
    path.pop();
    continue;
  }
  const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
  if (!key) continue;
  const full = [...path, key[1]].join('.');
  if (seen.has(full)) {
    failures.push(`DUPLICATE KEY  ${full} — first at line ${seen.get(full)}, again at line ${i + 1}`);
  } else {
    seen.set(full, i + 1);
  }
}

// --- 2. banned words -------------------------------------------------------
const BANNED = [/\bcertified\b/i, /\bapproved\b/i, /\baccredited\b/i, /government[\s-]approved/i];
lines.forEach((line, index) => {
  // Comments carry the rule itself and must be allowed to name the words.
  const code = line.replace(/\/\*.*?\*\//g, '').replace(/^\s*(\*|\/\/).*$/, '');
  for (const pattern of BANNED) {
    if (pattern.test(code)) {
      failures.push(
        `BANNED WORD  src/strings.ts:${index + 1} matches ${pattern} — `
          + 'permitted: "checked against the s 65C data set", "self-assessment" (REQ-65C-05).',
      );
    }
  }
});

// --- 3. inline user-facing text -------------------------------------------
const sources = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) sources.push([full, readFileSync(full, 'utf8')]);
  }
})(join(here, 'src'));
sources.push([join(here, 'App.tsx'), readFileSync(join(here, 'App.tsx'), 'utf8')]);

for (const [file, source] of sources) {
  const fileLines = source.split('\n');
  fileLines.forEach((line, index) => {
    // `<Text ...>Some words` — an opening Text tag followed by letters that are
    // not an expression. Whitespace-only and `{...}` children are fine.
    const match = /<Text(?:\s[^>]*)?>\s*([A-Za-z][^<{]*)/.exec(line);
    if (match && match[1].trim().length > 0) {
      failures.push(
        `INLINE STRING  ${file.replace(here, '.')}:${index + 1} — "${match[1].trim().slice(0, 40)}". `
          + 'Every user-facing string goes through src/strings.ts (REQ-LANG-01).',
      );
    }
  });
}

if (failures.length > 0) {
  console.error('');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`\n  ${failures.length} problem(s) in the kiosk string table.\n`);
  process.exit(1);
}

console.log(`  kiosk strings.ts: ${seen.size} keys, no duplicates, no banned words, no inline text.`);

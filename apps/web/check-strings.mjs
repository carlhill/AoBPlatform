#!/usr/bin/env node
/**
 * Guard the string table (REQ-LANG-01).
 *
 * WHY THIS EXISTS. `strings.ts` is one object literal, now past 1,600 lines,
 * and every new surface appends to the end of it. Appending blind to a file
 * that long collides with a key somebody chose months ago — twice in one
 * afternoon, in this case, both times `entitlement*` names that read as
 * obviously distinct until they were not.
 *
 * TypeScript does catch it (TS1117), but only at typecheck, by which point the
 * dev server is already showing a build error to whoever is using it. This runs
 * inside `lint`, which is the gate before a commit, and it names the exact key
 * and both line numbers rather than pointing at the closing brace.
 *
 * THE REAL FIX IS TO SPLIT THE FILE, one module per surface re-exported from a
 * single index. That keeps REQ-LANG-01 true — one place a component reads text
 * from — while making a cross-surface collision impossible rather than merely
 * detected. This is the cheap guard until then.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, 'app', 'strings.ts');

const lines = readFileSync(FILE, 'utf8').split('\n');

/** Nesting path, so `review.audience` and `setup.audience` do not collide. */
const path = [];
const seen = new Map();
const duplicates = [];

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
  if (seen.has(full)) duplicates.push({ full, first: seen.get(full), again: i + 1 });
  else seen.set(full, i + 1);
}

if (duplicates.length > 0) {
  console.error(`\n  ${FILE}\n`);
  for (const d of duplicates) {
    console.error(`  DUPLICATE KEY  ${d.full}`);
    console.error(`    first defined at line ${d.first}, again at line ${d.again}`);
    console.error('    The later one silently wins at runtime. Rename the newcomer.\n');
  }
  console.error(`  ${duplicates.length} duplicate key(s). ${seen.size} keys checked.\n`);
  process.exit(1);
}

/*
 * THE FRONT DESK'S OWN VOCABULARY, ENFORCED (FRONT-DESK-PAGE.md §5; Carl,
 * 12 Sep 2026).
 *
 * WHY A LINT AND NOT ONLY A TEST. The front desk page exists because the
 * existing desk speaks the regulator's language and a person on their first
 * shift does not. Every one of the banned words below is the CORRECT word
 * somewhere else in this product — which is exactly why the vocabulary drifts
 * back the first time somebody reuses a string, and why the plan asks for a
 * lint rule the same shape as the kiosk's storage one. The named test over
 * `strings.frontdesk` catches it too; this catches it before the tests run,
 * and names the line.
 *
 * COMMENTS ARE EXEMPT, deliberately. The docstrings in that block have to be
 * able to say WHICH words are banned and why, and a rule that could not be
 * explained in the file it governs is a rule nobody will keep.
 *
 * THE LAST FOUR ARE HARD RULE 12 (REQ-65C-05) and are banned everywhere, not
 * only here; they are repeated in this list so one read of it says everything
 * this surface may not say.
 */
const BANNED = [
  'assignor',
  'episodic',
  'enduring',
  'supersede',
  'particulars',
  'capture request',
  'affiliation',
  'artefact',
  'attestation',
  'certified',
  'approved',
  'accredited',
  'government-approved',
];

const offences = [];
let inFrontdesk = false;
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  const trimmed = line.trim();
  /*
   * BOTH FRONT DESKS. `frontdeskSmall` is the same work on a small screen —
   * one list instead of five rails — read by the same person on the same
   * first shift, so it is governed by the same vocabulary. A rule that covered
   * only the wide desk would let the words drift back in through the page
   * built to replace it.
   */
  if (/^frontdesk(Small)?\s*:\s*\{/.test(trimmed)) {
    inFrontdesk = true;
    continue;
  }
  if (!inFrontdesk) continue;
  /*
   * The block's own closing brace, at the top level of the strings object.
   * It ENDS the block rather than the scan, because there is more than one
   * block to check and the second one comes later in the file.
   */
  if (line === '  },') {
    inFrontdesk = false;
    continue;
  }
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) continue;
  const lowered = line.toLowerCase();
  for (const word of BANNED) {
    if (lowered.includes(word)) offences.push({ word, line: i + 1, text: trimmed });
  }
}

if (offences.length > 0) {
  console.error(`\n  ${FILE}\n`);
  for (const o of offences) {
    console.error(`  BANNED WORD ON THE FRONT DESK  "${o.word}"  line ${o.line}`);
    console.error(`    ${o.text}`);
  }
  console.error(
    '\n  FRONT-DESK-PAGE.md §5 lists what to say instead. This page is read by\n' +
      '  somebody on their first shift; every word above is correct elsewhere and\n' +
      '  wrong here.\n',
  );
  process.exit(1);
}

/*
 * Unused keys are reported and do NOT fail. Several are read dynamically —
 * `strings.channels.identifierNames[type]` — so a reference scan cannot see
 * them, and failing the build on a false positive would teach everybody to
 * ignore this script.
 */
const sources = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry) && !full.endsWith('strings.ts')) sources.push(readFileSync(full, 'utf8'));
  }
})(join(here, 'app'));

const haystack = sources.join('\n');
const unused = [...seen.keys()].filter((k) => {
  const leaf = k.split('.').pop();
  return !haystack.includes(`.${leaf}`) && !haystack.includes(`'${leaf}'`);
});

console.log(`  strings.ts: ${seen.size} keys, no duplicates.`);
if (unused.length > 0) {
  console.log(`  ${unused.length} possibly unused (dynamic access is not detected):`);
  for (const k of unused.slice(0, 12)) console.log(`    ${k}`);
  if (unused.length > 12) console.log(`    … and ${unused.length - 12} more`);
}

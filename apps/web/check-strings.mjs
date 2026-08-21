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

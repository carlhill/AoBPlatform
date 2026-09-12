#!/usr/bin/env node
/**
 * Staleness guard for INVENTORY.md — the same shape as the realm-export guard
 * in `infra/keycloak`, and for the same reason: read the artefact, don't trust
 * the prose about it.
 *
 * WHY. An index of what already exists is only worth reading if it is true.
 * A generated file that nobody regenerates is a hand-written file with extra
 * steps — it drifts in a week, and then it actively misleads: an agent trusts
 * a row for a component that has since moved, or writes a second copy of a
 * helper the stale file did not list. This runs inside `npm run lint`, so a
 * branch that adds an export and does not run `npm run inventory` fails at the
 * bench and in CI rather than shipping a lie.
 *
 * WHY IT COMPARES CONTENT AND NOT A HASH. When it fails, the diff is the
 * useful part — `git diff INVENTORY.md` after regenerating shows exactly which
 * exports appeared, and that is often the first time anyone notices a build
 * added forty of them.
 *
 * LINE ENDINGS ARE NORMALISED before comparing. `core.autocrlf` is true on the
 * Windows bench, so the file on disk there has CRLF while the generator emits
 * LF and CI checks out LF. Comparing raw bytes would fail on one machine and
 * pass on the other, which is the worst of both.
 *
 *   node scripts/dev/inventory.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInventory, REPO_ROOT, firstSentence } from './inventory.mjs';

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
};

const normalise = (text) => text.replace(/\r\n/g, '\n').trimEnd();

// A handful of unit checks on the one piece of parsing that is easy to get
// subtly wrong, so a regression shows up as a named failure and not as a
// thousand-line diff.
check('firstSentence stops at a full stop', firstSentence('One thing. Then another.') === 'One thing.');
check(
  'firstSentence does not stop inside TODO.md',
  firstSentence('See TODO.md for why. Next.') === 'See TODO.md for why.',
);
check('firstSentence does not stop at e.g.', firstSentence('Anything, e.g. this. Next.') === 'Anything, e.g. this.');
check('firstSentence keeps a sentenceless line whole', firstSentence('No full stop here') === 'No full stop here');
check('firstSentence takes only the first paragraph', firstSentence('Lead line\n\nSecond para.') === 'Lead line');

let committed = '';
try {
  committed = readFileSync(join(REPO_ROOT, 'INVENTORY.md'), 'utf8');
} catch {
  failures.push('INVENTORY.md is missing — run `npm run inventory`');
}

if (committed) {
  const generated = buildInventory();
  if (normalise(committed) !== normalise(generated)) {
    const a = normalise(committed).split('\n');
    const b = normalise(generated).split('\n');
    let line = 0;
    while (line < a.length && line < b.length && a[line] === b[line]) line += 1;
    failures.push(
      'INVENTORY.md is out of date with the source tree.\n' +
        `    first difference at line ${line + 1}:\n` +
        `      committed: ${a[line] ?? '(end of file)'}\n` +
        `      generated: ${b[line] ?? '(end of file)'}\n` +
        '    Run `npm run inventory` and commit the result (wow.md §10).',
    );
  }
}

if (failures.length > 0) {
  console.error('Inventory guard FAILED:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
console.log('Inventory guard passed — INVENTORY.md matches the source tree.');

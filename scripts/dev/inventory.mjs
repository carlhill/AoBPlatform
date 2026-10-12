#!/usr/bin/env node
/**
 * INVENTORY.md, generated — the index of what this codebase already exports.
 *
 * WHY IT EXISTS (Carl, 12 Sep 2026; wow.md §10). A session starts cold and
 * knows only what its brief names, so it writes again what it could not
 * discover. On 12 Sep the front desk panel shipped a hand-rolled subset of the
 * tablet page's session controls because nobody — human or agent — could see
 * that `SessionActions`, `SendAgain` and `sendSteps` were already sitting in
 * `pushDesk.tsx`. There was no index of any of it: 148 exported React
 * components in `apps/web`, ~550 exported helpers in `packages/domain`, 55
 * exports out of `pushDesk.tsx` alone.
 *
 * WHY IT IS GENERATED AND NOT WRITTEN. A hand-written index drifts within a
 * week and then it LIES, which is worse than having none: an agent that trusts
 * a stale list reuses something that moved, or re-writes something it was told
 * did not exist. This walks the source every time, and `inventory.test.mjs`
 * fails the build when the committed file no longer matches the tree.
 *
 * WHY REGEX AND NOT THE TYPESCRIPT COMPILER. Speed is the whole point — an
 * index nobody runs is an index nobody trusts. A type-checking pass over 700
 * files costs tens of seconds; this is a single line-wise scan and finishes in
 * about a second, so it can run on every lint. The cost is honest: it sees
 * syntax, not types. A clever re-export it cannot follow shows as an
 * unattributed import rather than a wrong one, which is the safe direction to
 * be wrong in.
 *
 * WHY DESCRIPTIONS ARE QUOTED, NEVER COMPOSED. The one line against each
 * symbol is the first sentence of that symbol's own comment. Where a symbol
 * has no comment the cell says so. An invented description would be this
 * script guessing at intent and publishing the guess as fact, and the whole
 * point of the artefact is that it can be trusted without checking.
 *
 *   node scripts/dev/inventory.mjs        # rewrite INVENTORY.md
 *   npm run inventory                     # the same thing
 *   node scripts/dev/inventory.test.mjs   # the staleness guard
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The four areas the inventory indexes, in reading order.
 *
 * Each is a source root whose exports are catalogued. Everything else in the
 * repo is still scanned for IMPORTS (so `apps/rules` using a domain helper
 * counts towards that helper's reuse) but its own exports are not listed —
 * those services are small, human-authored zones and nothing is meant to
 * reach into them.
 */
const EXPORT_ROOTS = [
  { key: 'web', dir: 'apps/web/app', short: 'web' },
  { key: 'domain', dir: 'packages/domain/src', short: 'domain' },
  { key: 'contracts', dir: 'packages/contracts/src', short: 'contracts' },
  { key: 'core', dir: 'apps/core/src', short: 'core' },
  // AOBPRINTER is a standalone desktop program that nothing imports, so its
  // reuse counts will read zero. It is indexed anyway, because the failure
  // §10 was written about is an agent writing a helper that already exists
  // somewhere it could not see — and a whole workspace missing from the index
  // is the largest version of that blind spot. Added 17 Sep 2026 with the
  // workspace itself.
  { key: 'aobprinter', dir: 'apps/aobprinter/src', short: 'aobprinter' },
];

/** Everything under here is scanned for imports, so reuse counts are repo-wide. */
const IMPORT_ROOTS = ['apps', 'packages', 'scripts', 'infra'];

/** Path shorteners, longest prefix first, so the table stays readable. */
const SHORTEN = [
  ['apps/web/app/', 'web:'],
  ['packages/domain/src/', 'domain:'],
  ['packages/contracts/src/', 'contracts:'],
  ['packages/vault-client/src/', 'vault-client:'],
  ['packages/auth-client/src/', 'auth-client:'],
  ['apps/core/src/', 'core:'],
  ['apps/rules/src/', 'rules:'],
  ['apps/vault/src/', 'vault:'],
  ['apps/connector/src/', 'connector:'],
  ['apps/aobprinter/src/', 'aobprinter:'],
];

/** Workspace package names that resolve back into this repo. */
const WORKSPACE_ENTRIES = {
  '@aobplatform/domain': 'packages/domain/src/index.ts',
  '@aobplatform/contracts': 'packages/contracts/src/index.ts',
  '@aobplatform/vault-client': 'packages/vault-client/src/index.ts',
  '@aobplatform/auth-client': 'packages/auth-client/src/index.ts',
};

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  'generated',
  'migrations',
  'test-results',
  'playwright-report',
  '__snapshots__',
]);

/** Tests, type shims and generated client code are noise in an index of what to reuse. */
function isExcludedFile(rel) {
  if (!/\.(ts|tsx)$/.test(rel)) return false;
  if (rel.endsWith('.d.ts')) return true;
  if (/\.(test|spec|e2e-spec)\.tsx?$/.test(rel)) return true;
  if (/(^|\/)(test|tests|__tests__|e2e)\//.test(rel)) return true;
  return false;
}

function walk(absDir, out) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const rel = relative(REPO_ROOT, abs).split('\\').join('/');
      if (!isExcludedFile(rel)) out.push(rel);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|etc|vs|cf|approx|Dr|Mr|Mrs|Ms|St|No|Fig|reg|s|ss|v)|\b[A-Z]|\d)$/;

/**
 * The first sentence of a comment, or the whole first paragraph if it has no
 * sentence end. Abbreviations that end in a full stop do not end a sentence,
 * and neither does a full stop with no space after it (`TODO.md`, `65C.4`).
 */
export function firstSentence(text) {
  const paragraph = text
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!paragraph) return '';
  for (let i = 0; i < paragraph.length; i += 1) {
    const ch = paragraph[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = paragraph[i + 1];
    if (next !== undefined && next !== ' ') continue;
    if (ch === '.' && ABBREVIATIONS.test(paragraph.slice(0, i))) continue;
    return paragraph.slice(0, i + 1);
  }
  return paragraph;
}

/** Strip comment punctuation and hand back the prose. */
function commentProse(lines) {
  return lines
    .map((line) =>
      line
        .replace(/^\s*\/\*\*?/, '')
        .replace(/\*\/\s*$/, '')
        .replace(/^\s*\*\s?/, '')
        .replace(/^\s*\/\/\s?/, ''),
    )
    .join('\n')
    .trim();
}

/**
 * The comment block immediately above a line, if there is one.
 *
 * Adjacency is the rule: decorators and `export default` continuations are
 * stepped over, a blank line is not. A file-header comment sitting above the
 * imports therefore does NOT get attributed to the first export twenty lines
 * below it — that fallback is deliberate and separate, and it is marked as
 * such in the table.
 */
function commentAbove(lines, index) {
  let i = index - 1;
  while (i >= 0 && /^\s*@[A-Za-z]/.test(lines[i])) i -= 1; // Nest decorators
  if (i < 0) return '';
  const end = lines[i].trimEnd();
  if (end.endsWith('*/')) {
    const block = [];
    let j = i;
    while (j >= 0) {
      block.unshift(lines[j]);
      if (/^\s*\/\*/.test(lines[j])) break;
      j -= 1;
    }
    return commentProse(block);
  }
  if (/^\s*\/\//.test(end)) {
    const block = [];
    let j = i;
    while (j >= 0 && /^\s*\/\//.test(lines[j])) {
      block.unshift(lines[j]);
      j -= 1;
    }
    return commentProse(block);
  }
  return '';
}

/** The file's own header comment — the block before the first import or statement. */
function fileHeader(lines) {
  let i = 0;
  while (i < lines.length && (lines[i].trim() === '' || /^['"]use (client|server)['"];?$/.test(lines[i].trim())))
    i += 1;
  if (i >= lines.length || !/^\s*\/\*/.test(lines[i])) return '';
  const block = [];
  while (i < lines.length) {
    block.push(lines[i]);
    if (lines[i].trimEnd().endsWith('*/')) break;
    i += 1;
  }
  return commentProse(block);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const DECL = [
  [/^export\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^export\s+default\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^export\s+interface\s+([A-Za-z_$][\w$]*)/, 'type'],
  [/^export\s+type\s+([A-Za-z_$][\w$]*)/, 'type'],
  [/^export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'type'],
  [/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, 'value'],
];

const isHookName = (name) => /^use[A-Z]/.test(name);
const isPascal = (name) => /^[A-Z]/.test(name);

/**
 * What kind of thing an export is, for grouping.
 *
 * A React component is judged by the only two signals available without a type
 * checker: a PascalCase name in a `.tsx` file that is callable. That misses a
 * component defined in a `.ts` file (there are none) and would wrongly claim a
 * PascalCase non-component in a `.tsx` file — which is why the row still shows
 * the file, so the reader can tell.
 */
function classify(name, decl, rel, rhs) {
  if (decl === 'class') return 'class';
  if (decl === 'type') return 'type';
  const callable = decl === 'function' || /^(?:async\s*)?(?:\(|function\b|<[A-Za-z])/.test(rhs.trim());
  if (isHookName(name) && callable) return 'hook';
  if (rel.endsWith('.tsx') && isPascal(name) && callable) return 'component';
  if (callable) return 'function';
  return 'constant';
}

/**
 * Every export a file declares, plus the barrel edges it re-exports along.
 *
 * Re-exports are collected but NOT listed as declarations: `packages/domain/
 * src/index.ts` re-exports nearly everything, and listing it would double the
 * inventory and attribute every helper to the barrel instead of the file that
 * owns it. The edges are kept only so an import from `@aobplatform/domain` can
 * be traced back to the real file.
 */
function readExports(rel) {
  const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
  const lines = text.split(/\r?\n/);
  const header = fileHeader(lines);
  const declared = [];
  const reexports = []; // { names: string[] | '*', from: string }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^export\b/.test(line)) continue;

    const star = line.match(/^export\s+\*\s+(?:as\s+[\w$]+\s+)?from\s+['"]([^'"]+)['"]/);
    if (star) {
      reexports.push({ names: '*', from: star[1] });
      continue;
    }
    if (/^export\s+(?:type\s+)?\{/.test(line)) {
      // May span several lines; gather to the closing brace.
      let clause = line;
      let j = i;
      while (!clause.includes('}') && j + 1 < lines.length) {
        j += 1;
        clause += '\n' + lines[j];
      }
      const from = clause.match(/from\s+['"]([^'"]+)['"]/);
      const inner = clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'));
      const names = inner
        .split(',')
        .map((part) =>
          part
            .replace(/\btype\b/, '')
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        .filter(Boolean);
      if (from) reexports.push({ names, from: from[1] });
      i = j;
      continue;
    }

    for (const [pattern, decl] of DECL) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1];
      const rhs = line.slice(line.indexOf(name) + name.length).replace(/^[^=]*=/, '');
      let description = commentAbove(lines, i);
      let fromHeader = false;
      if (!description && header) {
        const base = basename(rel).replace(/\.(ts|tsx)$/, '');
        if (line.includes('export default') || base.toLowerCase() === name.toLowerCase()) {
          description = header;
          fromHeader = true;
        }
      }
      declared.push({
        name,
        file: rel,
        line: i + 1,
        kind: classify(name, decl, rel, rhs),
        description: firstSentence(description),
        fromHeader,
      });
      break;
    }
  }
  return { declared, reexports };
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Turn a module specifier into a repo-relative file, or null if it leaves the repo. */
function resolveSpecifier(spec, fromFile, known) {
  let base;
  if (spec.startsWith('.')) {
    base = relative(REPO_ROOT, resolve(join(REPO_ROOT, dirname(fromFile)), spec))
      .split('\\')
      .join('/');
  } else if (WORKSPACE_ENTRIES[spec]) {
    return WORKSPACE_ENTRIES[spec];
  } else {
    const pkg = Object.keys(WORKSPACE_ENTRIES).find((name) => spec.startsWith(name + '/'));
    if (!pkg) return null;
    base = WORKSPACE_ENTRIES[pkg].replace(/index\.ts$/, '') + spec.slice(pkg.length + 1);
  }
  if (known.has(base)) return base;
  for (const ext of EXTENSIONS) if (known.has(base + ext)) return base + ext;
  return null;
}

/** Named bindings an import clause brings in; `* as ns` yields nothing attributable. */
function bindingsOf(clause) {
  const names = [];
  const braced = clause.match(/\{([\s\S]*)\}/);
  if (braced) {
    for (const part of braced[1].split(',')) {
      const cleaned = part.replace(/^\s*type\s+/, '').trim();
      if (!cleaned) continue;
      names.push(cleaned.split(/\s+as\s+/)[0].trim());
    }
  }
  const head = clause.slice(0, braced ? clause.indexOf('{') : clause.length).replace(/^\s*type\s+/, '');
  const def = head.split(',')[0].trim();
  if (def && /^[A-Za-z_$][\w$]*$/.test(def)) names.push(def);
  return names.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const SECTIONS = [
  { title: 'Web components', root: 'web', kinds: ['component'] },
  { title: 'Web hooks', root: 'web', kinds: ['hook'] },
  { title: 'Web helpers and constants', root: 'web', kinds: ['function', 'constant', 'class'] },
  { title: 'Web types', root: 'web', kinds: ['type'] },
  { title: 'Domain functions', root: 'domain', kinds: ['function', 'hook', 'component', 'class'] },
  { title: 'Domain constants and content', root: 'domain', kinds: ['constant'] },
  { title: 'Domain types', root: 'domain', kinds: ['type'] },
  { title: 'Contracts types', root: 'contracts', kinds: ['type'] },
  { title: 'Contracts functions and constants', root: 'contracts', kinds: ['function', 'constant', 'class'] },
  { title: 'Core services, controllers and modules', root: 'core', kinds: ['class'] },
  {
    title: 'Core helpers, constants and types',
    root: 'core',
    kinds: ['function', 'constant', 'type', 'hook', 'component'],
  },
  {
    title: 'AOBPRINTER (the desktop print channel)',
    root: 'aobprinter',
    kinds: ['function', 'constant', 'type', 'class', 'hook', 'component'],
  },
];

function shorten(rel) {
  for (const [prefix, label] of SHORTEN) if (rel.startsWith(prefix)) return label + rel.slice(prefix.length);
  return rel;
}

function escapeCell(text) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** Build the whole document. Returns the markdown; writes nothing. */
export function buildInventory() {
  const started = Date.now();

  const exportFiles = [];
  for (const root of EXPORT_ROOTS) walk(join(REPO_ROOT, root.dir), exportFiles);

  const importFiles = [];
  for (const root of IMPORT_ROOTS) walk(join(REPO_ROOT, root), importFiles);
  const knownFiles = new Set(importFiles);

  // Pass 1 — declarations and barrel edges.
  const declarations = [];
  const byFile = new Map();
  const reexportsByFile = new Map();
  for (const rel of exportFiles) {
    const { declared, reexports } = readExports(rel);
    byFile.set(rel, declared);
    reexportsByFile.set(rel, reexports);
    declarations.push(...declared);
  }
  // Barrels themselves are not indexed, but their edges are needed to trace imports.
  for (const rel of importFiles) {
    if (reexportsByFile.has(rel)) continue;
    if (!/(^|\/)index\.tsx?$/.test(rel)) continue;
    reexportsByFile.set(rel, readExports(rel).reexports);
  }

  const byName = new Map();
  for (const decl of declarations) {
    if (!byName.has(decl.name)) byName.set(decl.name, []);
    byName.get(decl.name).push(decl);
  }

  const importers = new Map(); // "file\0name" -> Set<importer file>
  const addImporter = (decl, importer) => {
    const key = decl.file + '\u0000' + decl.name;
    if (!importers.has(key)) importers.set(key, new Set());
    importers.get(key).add(importer);
  };

  /** Follow barrel edges from a resolved module until the declaring file is found. */
  const trace = (name, start) => {
    const candidates = byName.get(name);
    if (!candidates) return null;
    const seen = new Set();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      const direct = candidates.find((c) => c.file === current);
      if (direct) return direct;
      for (const edge of reexportsByFile.get(current) ?? []) {
        if (edge.names !== '*' && !edge.names.includes(name)) continue;
        const next = resolveSpecifier(edge.from, current, knownFiles);
        if (next) queue.push(next);
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  };

  // Pass 2 — who imports what.
  const importPattern = /(?:^|\n)\s*import\s+((?:type\s+)?[^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const rel of importFiles) {
    const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
    if (!text.includes('import')) continue;
    importPattern.lastIndex = 0;
    let match;
    while ((match = importPattern.exec(text)) !== null) {
      const target = resolveSpecifier(match[2], rel, knownFiles);
      if (!target || target === rel) continue;
      for (const name of bindingsOf(match[1])) {
        const decl = trace(name, target);
        if (decl && decl.file !== rel) addImporter(decl, rel);
      }
    }
  }

  for (const decl of declarations) {
    const set = importers.get(decl.file + '\u0000' + decl.name);
    decl.importers = set ? [...set].sort() : [];
  }

  // Render.
  const lines = [];
  const undocumented = declarations.filter((d) => !d.description).length;
  const unused = declarations.filter((d) => d.importers.length === 0).length;

  lines.push('# INVENTORY.md — what AoBPlatform already exports');
  lines.push('');
  lines.push(
    '**Generated. Do not edit by hand — run `npm run inventory`.** ' +
      'The staleness guard (`node scripts/dev/inventory.test.mjs`, wired into `npm run lint`) fails when this file and the source tree disagree.',
  );
  lines.push('');
  lines.push(
    'This is required reading before you write a component, a hook or a helper (wow.md §10). ' +
      'Search it for the noun you are about to build. The thing at the top of a section is the thing you should probably be using.',
  );
  lines.push('');
  lines.push('## How to read it');
  lines.push('');
  lines.push(
    '- **Used by** is the number of other files that import the symbol, then up to three of them. Sections are sorted most-imported first, because that is the answer to "what should I be using".',
  );
  lines.push(
    "- **What it is** is the first sentence of the symbol's own comment, quoted, never composed. `(file)` marks a description taken from the file's header comment because the symbol shares the file's name and has no comment of its own. An empty cell means the export carries no comment — that is a gap in the code, not in this file.",
  );
  lines.push(
    '- Tests, `.d.ts`, generated Prisma output, `node_modules` and `.next` are excluded, and so are test files as importers — a count here is production reuse.',
  );
  lines.push(
    '- Paths are shortened: `web:` = `apps/web/app/`, `domain:` = `packages/domain/src/`, `contracts:` = `packages/contracts/src/`, `core:` = `apps/core/src/`, and the same for `rules:`, `vault:`, `connector:`, `vault-client:`, `auth-client:`.',
  );
  lines.push(
    '- Barrels (`index.ts`) are not listed. An import of a domain helper through `@aobplatform/domain` is credited to the file that declares it.',
  );
  lines.push(
    '- No line numbers, deliberately: they would change on every edit above a symbol and the staleness guard would fire on work that added nothing. Search the file for the name.',
  );
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push('| | Count |');
  lines.push('|---|---|');
  lines.push(`| Exported symbols indexed | ${declarations.length} |`);
  lines.push(`| Files scanned for exports | ${exportFiles.length} |`);
  lines.push(`| Files scanned for imports | ${importFiles.length} |`);
  lines.push(`| Exports with no comment of their own | ${undocumented} |`);
  lines.push(`| Exports imported nowhere else | ${unused} |`);
  lines.push('');

  const sectionRows = SECTIONS.map((section) => {
    const rows = declarations
      .filter((d) => {
        const root = EXPORT_ROOTS.find((r) => d.file.startsWith(r.dir + '/'));
        return root?.key === section.root && section.kinds.includes(d.kind);
      })
      .sort(
        (a, b) =>
          b.importers.length - a.importers.length ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
          (a.file < b.file ? -1 : 1),
      );
    return { section, rows };
  });

  lines.push('## Sections');
  lines.push('');
  for (const { section, rows } of sectionRows) {
    lines.push(`- [${section.title}](#${section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}) — ${rows.length}`);
  }
  lines.push('');

  for (const { section, rows } of sectionRows) {
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(`${rows.length} exports.`);
    lines.push('');
    lines.push('| Symbol | File | What it is | Used by |');
    lines.push('|---|---|---|---|');
    for (const row of rows) {
      const shown = row.importers.slice(0, 3).map(shorten).join(', ');
      const more = row.importers.length > 3 ? `, +${row.importers.length - 3} more` : '';
      const used = row.importers.length === 0 ? '0' : `**${row.importers.length}** · ${shown}${more}`;
      const description = row.description ? `${row.fromHeader ? '(file) ' : ''}${row.description}` : '';
      lines.push(`| \`${row.name}\` | ${shorten(row.file)} | ${escapeCell(description)} | ${escapeCell(used)} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    'Generated by `scripts/dev/inventory.mjs`. Nothing in this file varies between runs on the same tree — no timestamp, no duration, no machine name — because the staleness guard compares it byte for byte.',
  );
  lines.push('');
  void started;
  return lines.join('\n');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/dev/inventory.mjs')) {
  const started = Date.now();
  const markdown = buildInventory();
  writeFileSync(join(REPO_ROOT, 'INVENTORY.md'), markdown, 'utf8');
  const symbols = (markdown.match(/^\| `/gm) ?? []).length;
  console.log(`INVENTORY.md written — ${symbols} exports in ${Date.now() - started} ms.`);
}

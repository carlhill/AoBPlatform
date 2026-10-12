#!/usr/bin/env node
// Enforces CLAUDE.md section 7b rules 1, 4 and 6 before every `git commit`.
//
// CLAUDE.md is advisory: an agent can read a rule and still not follow it. This
// hook is deterministic. It blocks a commit on `main`, blocks one carrying a
// .env file, a private key, a log or a large generated file, and prints
// `git diff --stat` so rule 4 happens whether or not anybody remembered it.
//
// Limits are recorded in wow.md section 12. It checks PATHS and SIZES, not diff
// content, because this repo legitimately holds dev passwords in
// docker-compose.yml and a content scan would either block ordinary commits or
// prove nothing. Carl, 17 September 2026.

import { execFileSync } from 'node:child_process';

export const PROTECTED_BRANCHES = ['main', 'master'];
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Is this bash command a real commit (not --dry-run, not `git log`)? */
export function isCommitCommand(command) {
  if (typeof command !== 'string') return false;
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(command)) return false;
  if (/--dry-run\b/.test(command)) return false;
  return true;
}

export function checkBranch(branch) {
  if (PROTECTED_BRANCHES.includes(branch)) {
    return `Refusing to commit on \`${branch}\` (CLAUDE.md 7b rule 1). Branch first: git switch -c <type>/<short-description>`;
  }
  return null;
}

/** Paths that must never be committed (CLAUDE.md 7b rule 6). */
export function checkPaths(files) {
  const bad = [];
  for (const f of files) {
    const base = f.split('/').pop() ?? f;
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') bad.push([f, 'an environment file']);
    else if (/\.(log|pem|key|p12|pfx)$/i.test(base)) bad.push([f, 'a log or a key file']);
    else if (/(^|\/)id_rsa(\.|$)/.test(f)) bad.push([f, 'a private key']);
    else if (/(^|\/)node_modules\//.test(f)) bad.push([f, 'a dependency directory']);
    else if (/(^|\/)(dist|\.next|coverage)\//.test(f)) bad.push([f, 'a build output']);
  }
  if (bad.length === 0) return null;
  return `Refusing to commit (CLAUDE.md 7b rule 6):\n${bad.map(([f, why]) => `  ${f} — ${why}`).join('\n')}\nUnstage it, and add it to .gitignore if it should never have been there.`;
}

export function checkSizes(sized) {
  const big = sized.filter(({ bytes }) => bytes > MAX_FILE_BYTES);
  if (big.length === 0) return null;
  return `Refusing to commit a large generated file (CLAUDE.md 7b rule 6):\n${big
    .map(({ file, bytes }) => `  ${file} — ${(bytes / 1024 / 1024).toFixed(1)} MB`)
    .join('\n')}\nIf it genuinely belongs in the repository, ask Carl first.`;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  let payload = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (payload += c));
  process.stdin.on('end', () => {
    let command = '';
    try {
      command = JSON.parse(payload)?.tool_input?.command ?? '';
    } catch {
      process.exit(0); // Not a shape we understand: never block on our own bug.
    }
    if (!isCommitCommand(command)) process.exit(0);

    let branch, files, stat;
    try {
      branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
      files = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
      stat = git(['diff', '--cached', '--stat']);
    } catch (e) {
      // Not a repo, or git unavailable. Blocking here would be the hook failing,
      // not the rule firing.
      process.exit(0);
    }

    const sized = files.map((file) => {
      try {
        return { file, bytes: Buffer.byteLength(git(['show', `:${file}`]), 'utf8') };
      } catch {
        return { file, bytes: 0 };
      }
    });

    const problem = checkBranch(branch) ?? checkPaths(files) ?? checkSizes(sized);
    if (problem) {
      console.error(problem);
      process.exit(2); // 2 = block the tool call and show this to Claude.
    }

    // Rule 4: the stat, every time, whether or not anybody asked for it.
    console.error(
      `[git-commit-guard] branch ${branch}, ${files.length} staged file${files.length === 1 ? '' : 's'}.\n` +
        `${stat}\n` +
        `Check that file count is the one you expect: \`git add <paths> && git commit\` commits the WHOLE index (wow.md 5a).`
    );
    process.exit(0);
  });
}

if ((process.argv[1] || '').endsWith('git-commit-guard.mjs')) main();

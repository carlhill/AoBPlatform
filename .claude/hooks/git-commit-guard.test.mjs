// Tests for the commit guard. Run: node .claude/hooks/git-commit-guard.test.mjs
// A guard nobody tested is a guard that fails open on the day it matters.
import assert from 'node:assert/strict';
import { isCommitCommand, checkBranch, checkPaths, checkSizes, MAX_FILE_BYTES } from './git-commit-guard.mjs';

let ran = 0;
const test = (name, fn) => { fn(); ran++; console.log(`  ok  ${name}`); };

test('a_commit_is_recognised', () => {
  assert.ok(isCommitCommand('git commit -m "feat: thing"'));
  assert.ok(isCommitCommand('git commit -o a.ts b.ts -F msg.txt'));
  assert.ok(isCommitCommand('cd apps/core && git commit -am wip'));
});

test('a_non_commit_is_left_alone', () => {
  assert.ok(!isCommitCommand('git log --oneline -5'));
  assert.ok(!isCommitCommand('git diff --cached --stat'));
  assert.ok(!isCommitCommand('npm test'));
  assert.ok(!isCommitCommand('git commit --dry-run'));
  assert.ok(!isCommitCommand(undefined));
});

test('main_is_refused_and_a_feature_branch_is_not', () => {
  assert.match(checkBranch('main'), /Refusing to commit on/);
  assert.match(checkBranch('master'), /Refusing to commit on/);
  assert.equal(checkBranch('feat/apply-ui'), null);
});

test('an_env_file_is_refused', () => {
  assert.match(checkPaths(['apps/web/.env.local']), /environment file/);
  assert.match(checkPaths(['.env']), /environment file/);
  assert.equal(checkPaths(['.env.example']), null, '.env.example is documentation, not a secret');
});

test('keys_logs_and_build_output_are_refused', () => {
  assert.match(checkPaths(['infra/tls/server.pem']), /key file/);
  assert.match(checkPaths(['run.log']), /log or a key/);
  assert.match(checkPaths(['.ssh/id_rsa']), /private key/);
  assert.match(checkPaths(['node_modules/left-pad/index.js']), /dependency directory/);
  assert.match(checkPaths(['packages/domain/dist/index.js']), /build output/);
});

test('ordinary_source_files_pass', () => {
  assert.equal(checkPaths(['apps/core/src/agreements/agreements.service.ts', 'CLAUDE.md', 'wow.md']), null);
});

test('a_large_generated_file_is_refused', () => {
  assert.match(checkSizes([{ file: 'bundle.js', bytes: MAX_FILE_BYTES + 1 }]), /large generated file/);
  assert.equal(checkSizes([{ file: 'small.ts', bytes: 1024 }]), null);
});

console.log(`\n${ran} tests passed.`);

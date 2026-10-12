import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * ONE CONTENT-TYPE PER REQUEST (12 Oct 2026).
 *
 * apiHeaders() already sets `Content-Type: application/json`. A caller that
 * spreads it and then adds a LOWER-CASE `content-type` sends two headers: the
 * object keys differ, so neither overwrites the other, and fetch joins them
 * into "application/json, application/json". Nest's body parser does not
 * recognise that type and leaves the body empty, so the server refuses the
 * request with every field missing. The telehealth panel's "Send the link"
 * and two waiting-list POSTs did exactly that, and their tests (which mock
 * fetch) could not see it.
 *
 * Spreading apiHeaders and adding the SAME-case `'Content-Type'` is fine: the
 * key is overwritten.
 */

const APP_DIR = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('apiHeaders and content-type', () => {
  it('fetch joins two content-type keys that differ only in case', () => {
    const joined = new Headers({ 'Content-Type': 'application/json', 'content-type': 'application/json' });
    expect(joined.get('content-type')).toBe('application/json, application/json');
  });

  it('no_caller_adds_a_lower_case_content_type_to_apiHeaders', () => {
    const offenders = sourceFiles(APP_DIR).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(APP_DIR, file)}:${i + 1}` }))
        .filter(({ line }) => /\.\.\.apiHeaders\([^)]*\)[^}]*'content-type'/.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});

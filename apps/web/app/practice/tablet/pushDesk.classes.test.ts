/**
 * EVERY CLASS THE PUSH DESK NAMES EXISTS IN THE FILE IT NAMES IT FROM.
 *
 * Carl, 28 September 2026, twice: *"can we print the actual error in a light
 * red"* — and then, after it shipped, *"failed flags still black"*.
 *
 * WHY THAT GOT THROUGH. `pushDesk.tsx` imports TWO css modules, `styles` from
 * `../manage.module.css` and `rowStyles` from `./tablet.module.css`, and the
 * checks list and the print-record identity block were written with their
 * rules in TABLET and their references to STYLES. `styles.checks` is then
 * plain `undefined`, React renders no `class` at all, and the band falls back
 * to inherited ink — which is exactly "still black".
 *
 * NOTHING ELSE WOULD HAVE CAUGHT IT. TypeScript types a css module as
 * `Record<string, string>`, so an unknown key is not an error. jsdom applies
 * no cascade, so every existing test that asserted the list's CONTENT passed
 * with the list unstyled. The bug is only visible in a browser, or here.
 *
 * SO THE TEST IS ON THE SOURCE, not on a render: pull every `styles.x` and
 * `rowStyles.x` out of the component and require the matching stylesheet to
 * define it. It costs two file reads and it guards the whole class of
 * mistake, not just the two bands that met it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(join(__dirname, 'pushDesk.tsx'), 'utf8');

/** The class names a stylesheet defines — `.foo` wherever it appears as a selector. */
function definedIn(path: string): Set<string> {
  const css = readFileSync(path, 'utf8');
  const names = new Set<string>();
  for (const match of css.matchAll(/\.([A-Za-z_][\w-]*)/g)) names.add(match[1]);
  return names;
}

/**
 * The class names the component asks a given import for. Anchored on a
 * non-word character before the binding so `rowStyles.` is never read as
 * `styles.`, which would make the guard pass by looking in the wrong file.
 */
function referenced(binding: string): string[] {
  const pattern = new RegExp(String.raw`(?:^|[^\w$])` + binding + String.raw`\.([A-Za-z_]\w*)`, 'g');
  const found = new Set<string>();
  for (const match of SOURCE.matchAll(pattern)) found.add(match[1]);
  return [...found].sort();
}

describe('the push desk names classes that exist', () => {
  it('the_extraction_itself_finds_something', () => {
    // A REGEX THAT MATCHES NOTHING PASSES EVERY CHECK BELOW, and the first
    // draft of this file did exactly that (`\b` in a template literal is a
    // backspace, not a word boundary). So the guard is guarded.
    expect(referenced('styles')).toContain('formActions');
    expect(referenced('rowStyles')).toContain('checks');
    expect(referenced('rowStyles')).toContain('printId');
  });

  it.each([
    ['styles', join(__dirname, '..', 'manage.module.css')],
    ['rowStyles', join(__dirname, 'tablet.module.css')],
  ])('every_%s_class_is_defined_in_its_own_stylesheet', (binding, stylesheet) => {
    const defined = definedIn(stylesheet);
    const missing = referenced(binding).filter((name) => !defined.has(name));
    expect(missing).toEqual([]);
  });

  it('the_failed_checks_are_set_in_the_house_red', () => {
    /*
     * THE ONE CARL ASKED FOR, PINNED TO THE ELEMENT. The guard above proves
     * the reference resolves; this proves what it resolves TO still carries
     * the colour, so a later tidy of the stylesheet cannot quietly return the
     * bullets to black while every other test stays green.
     */
    const css = readFileSync(join(__dirname, 'tablet.module.css'), 'utf8');
    expect(css).toMatch(/\.checks li\s*\{[^}]*color:\s*var\(--stop\)/);
    expect(css).toMatch(/\.checks\s*\{[^}]*background:\s*var\(--stop-wash\)/);
  });
});

// Root ESLint flat config — shared across every app and package. There is
// deliberately no per-workspace eslint config; one shared ruleset keeps
// parallel contributors (human or agent) consistent. See CONVENTIONS.md §10.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/src/generated/**',
      '**/*.config.js',
      '**/*.config.mjs',
      'infra/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // `ignoreRestSiblings` is for the omit-by-rest idiom, which this codebase
      // uses to build a payload with one field deliberately missing:
      //
      //     const { adminEmail, ...withoutEmail } = application();
      //
      // The named binding is never read on purpose — removing it is the whole
      // point. Without this the rule pushes you to rename it to `_adminEmail`,
      // which says nothing about which field was dropped, or to disable the
      // rule at the line, which disables it for everything else there too.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // CLAUDE.md hard rule 1 / HARD-03: the Medicare card number is never an
      // identifier and never stored. Any identifier with "medicare" in its name
      // is a design mistake — the lint rule makes it loud at review time; the
      // domain types make it a compile error (see packages/domain).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Identifier[name=/medicareNumber|medicareCardNumber/i]',
          message:
            'The Medicare card number is NOT an approved identifier and is never stored ' +
            '(REQ-VER-02, HARD-03). Use the six approved identifiers in @aobplatform/domain.',
        },
      ],
    },
  },
  {
    /*
     * ZERO FOOTPRINT ON THE TABLET — Carl, 3 Sep 2026, recorded in CLAUDE.md
     * §7: "As we could have 1000's of kiosks/tablets, ensure that nothing gets
     * written to the kiosk/tablet ... We do not want the scenario where a bug
     * is released and all kiosks are not working and the only way to fix it is
     * to go to each device — this will break the bank."
     *
     * WHY A LINT RULE AND NOT A CODE REVIEW. Every name below is one import or
     * one line away at all times, each is individually reasonable ("just
     * remember which patient we were on across a refresh"), and the cost of
     * getting it wrong is not a bug on one machine — it is stale state, or a
     * stale service worker, on every tablet in every practice, fixable only by
     * visiting them. The rule makes the decision structural instead of
     * remembered.
     *
     * SCOPED TO `apps/web/app/kiosk/**` ONLY. The console legitimately uses
     * `sessionStorage` for the PKCE verifier and `localStorage` for the
     * has-signed-in hint (`app/auth.ts`); neither belongs on a device a
     * hundred strangers touch in a morning.
     *
     * WHEN PAIRING LANDS it gets exactly one key, listed in
     * `app/kiosk/session.ts`'s `PERSISTABLE_KEYS`, and this rule gains one
     * narrow exception for the module that owns it — not a blanket relaxation.
     */
    files: ['apps/web/app/kiosk/**/*.ts', 'apps/web/app/kiosk/**/*.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'The kiosk persists NOTHING on the device (CLAUDE.md §7). Hold it in memory for the life of ' +
            'the tab, as app/kiosk/session.ts does, or ask the server.',
        },
        {
          name: 'sessionStorage',
          message:
            'The kiosk persists NOTHING on the device (CLAUDE.md §7). Hold it in memory for the life of ' +
            'the tab, as app/kiosk/session.ts does, or ask the server.',
        },
        {
          name: 'indexedDB',
          message: 'The kiosk persists NOTHING on the device (CLAUDE.md §7). There is no local database.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Identifier[name=/medicareNumber|medicareCardNumber/i]',
          message:
            'The Medicare card number is NOT an approved identifier and is never stored ' +
            '(REQ-VER-02, HARD-03). Use the six approved identifiers in @aobplatform/domain.',
        },
        {
          selector:
            'MemberExpression[property.name=/^(localStorage|sessionStorage|indexedDB)$/]',
          message:
            'The kiosk persists NOTHING on the device (CLAUDE.md §7) — not via `window.` either. ' +
            'In-memory only; the future pairing credential is the single exception and is not built yet.',
        },
        {
          selector: 'MemberExpression[property.name="serviceWorker"]',
          message:
            'No service worker on the kiosk (CLAUDE.md §7). A bad one is a stale tablet in every practice, ' +
            'fixable only by visiting each device — which is the failure this rule exists to prevent.',
        },
        {
          selector: 'MemberExpression[object.name="document"][property.name="cookie"]',
          message:
            'The kiosk sets no cookies (CLAUDE.md §7). Nothing about a patient may outlive the tab.',
        },
      ],
    },
  },
  {
    // Hard-rule tests must name the forbidden field in order to prove it is
    // rejected — the only legitimate places the word may appear.
    files: [
      'packages/domain/src/**/*.test.ts',
      'apps/vault/test/**/*.e2e-spec.ts',
      // The kiosk's `medicare_number_rejected_as_identifier` test must name the
      // forbidden field to prove the approved-set guard throws on it; the
      // zero-footprint test must name the storage APIs to prove none is used.
      'apps/web/app/kiosk/**/*.test.ts',
      'apps/web/app/kiosk/**/*.test.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-globals': 'off' },
  },
);

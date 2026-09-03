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
    // Hard-rule tests must name the forbidden field in order to prove it is
    // rejected — the only legitimate places the word may appear.
    files: [
      'packages/domain/src/**/*.test.ts',
      'apps/vault/test/**/*.e2e-spec.ts',
      // The kiosk's `medicare_number_rejected_as_identifier` test must name the
      // forbidden field to prove the approved-set guard throws on it.
      'apps/kiosk/src/**/*.test.tsx',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },
);

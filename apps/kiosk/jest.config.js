// jest-expo, pinned to the SDK, on Jest 29 (CONVENTIONS.md §3 — jest-expo
// needs @jest/globals ^29 and mixing 29/30 in one workspace tree collides).
//
// THE REACT MAPPING IS LOAD-BEARING, not tidiness. This workspace pins react
// 19.2.3 (Expo's pair for RN 0.86) while the root hoists a newer 19.2.x for
// apps/web, so npm installs TWO copies. Components that import `react` for a
// hook resolved the nested one; `react-test-renderer` at the root resolved the
// hoisted one; the dispatcher was therefore null and every render of a
// component with a `useState` died on "Invalid hook call" — while components
// without hooks rendered perfectly, which is what made it look like a bug in
// the screen rather than in resolution.
//
// Metro does not have this problem: metro.config.js already puts this
// workspace's node_modules first and turns off hierarchical lookup, which is
// why the web export has always worked. This is the same instruction, for Jest.
const path = require('node:path');

const react = path.resolve(__dirname, 'node_modules/react');

module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  moduleNameMapper: {
    '^react$': react,
    '^react/(.*)$': path.join(react, '$1'),
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg))',
  ],
};

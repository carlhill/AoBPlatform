/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'src/.*\.test\.ts$',
  transform: {
    '^.+\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};

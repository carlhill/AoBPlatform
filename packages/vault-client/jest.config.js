/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.test\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};

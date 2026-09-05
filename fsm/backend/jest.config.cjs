module.exports = {
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.json' }] },
  setupFiles: ['<rootDir>/test/env.cjs'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage',
};

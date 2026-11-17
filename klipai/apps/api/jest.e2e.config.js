module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false, isolatedModules: true }] },
  testTimeout: 60000,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};

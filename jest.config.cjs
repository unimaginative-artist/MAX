module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.js'],
  moduleNameMapper: {
    '^node:test$': '<rootDir>/test/shims/node-test.js',
    '^test$': '<rootDir>/test/shims/node-test.js',
    '^pptxgenjs$': '<rootDir>/node_modules/pptxgenjs/dist/pptxgen.cjs.js'
  },
  // Remove strict coverage thresholds for now
  collectCoverageFrom: [
    'core/**/*.js',
    '!**/node_modules/**'
  ]
};
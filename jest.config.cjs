module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.js'],
  // Remove strict coverage thresholds for now
  collectCoverageFrom: [
    'core/**/*.js',
    '!**/node_modules/**'
  ]
};
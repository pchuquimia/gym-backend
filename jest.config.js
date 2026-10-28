export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  testPathIgnorePatterns: ["/tests/integration/"],
  transform: {},
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ["src/utils/**/*.js", "src/middleware/**/*.js"],
};

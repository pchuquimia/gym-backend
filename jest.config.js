export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  transform: {},
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ["src/utils/**/*.js", "src/middleware/**/*.js"],
};

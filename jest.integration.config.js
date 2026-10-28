import config from "./jest.config.js";

export default {
  ...config,
  testMatch: ["<rootDir>/tests/integration/**/*.test.js"],
  testPathIgnorePatterns: [],
  testTimeout: 120_000,
};

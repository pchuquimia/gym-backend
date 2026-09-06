import {
  isValidUsername,
  normalizeUsername,
} from "../src/utils/normalizeUsername.js";

describe("normalizeUsername", () => {
  test("normaliza espacios y mayusculas", () => {
    expect(normalizeUsername("  Juan_Fit  ")).toBe("juan_fit");
  });

  test("acepta solo el formato publico definido", () => {
    expect(isValidUsername("juan_fit")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("juan-fit")).toBe(false);
    expect(isValidUsername("juan fit")).toBe(false);
  });
});

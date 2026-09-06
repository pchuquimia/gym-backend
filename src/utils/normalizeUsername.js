export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const normalizeUsername = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

export const isValidUsername = (value) =>
  USERNAME_PATTERN.test(normalizeUsername(value));

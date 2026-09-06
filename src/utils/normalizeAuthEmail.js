import validator from "validator";

export const normalizeAuthEmail = (value) =>
  validator.normalizeEmail(String(value || "").trim(), {
    all_lowercase: true,
  }) || "";


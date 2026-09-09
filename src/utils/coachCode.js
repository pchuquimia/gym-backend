import crypto from "crypto";
import User from "../models/User.js";

export const COACH_CODE_PREFIX = "RIRFIT";
export const LEGACY_COACH_CODE_PREFIX = "APEX";

export const canonicalCoachCode = (value) => {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (
    compact.startsWith(COACH_CODE_PREFIX) &&
    compact.length === COACH_CODE_PREFIX.length + 8
  ) {
    return `${COACH_CODE_PREFIX}-${compact.slice(COACH_CODE_PREFIX.length)}`;
  }
  if (
    compact.startsWith(LEGACY_COACH_CODE_PREFIX) &&
    compact.length === LEGACY_COACH_CODE_PREFIX.length + 8
  ) {
    return `${LEGACY_COACH_CODE_PREFIX}-${compact.slice(LEGACY_COACH_CODE_PREFIX.length)}`;
  }
  return "";
};

export const createCoachCode = async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `${COACH_CODE_PREFIX}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    if (!(await User.exists({ coachCode: code }))) return code;
  }
  throw new Error("No se pudo generar un codigo de coach");
};

export const ensureCoachCode = async (userId) => {
  const current = await User.findById(userId, "coachCode").lean();
  if (
    current?.coachCode &&
    !current.coachCode.startsWith(`${LEGACY_COACH_CODE_PREFIX}-`)
  ) {
    return current.coachCode;
  }
  const code = await createCoachCode();
  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { coachCode: code } },
    { new: true },
  ).select("coachCode");
  return updated.coachCode;
};

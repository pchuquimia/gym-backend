import { getEffectiveWeightKg } from "./weightConfig.js";

const roundWeight = (value) => Math.round(value * 100) / 100;

export const convertHistoricalWeight = (
  value,
  { conversion = "keep", sourceConfig = {}, targetConfig = {} } = {},
) => {
  if (value === null || value === undefined || value === "") return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return value;

  if (conversion === "to_total") {
    return roundWeight(getEffectiveWeightKg(numeric, sourceConfig));
  }
  if (conversion !== "from_total") return numeric;
  if (targetConfig.weightBasis === "per_side") {
    return Math.max(
      0,
      roundWeight((numeric - Number(targetConfig.barWeightKg || 0)) / 2),
    );
  }
  if (targetConfig.weightBasis === "per_implement") {
    return roundWeight(
      numeric / Math.max(1, Number(targetConfig.implementCount || 1)),
    );
  }
  return numeric;
};

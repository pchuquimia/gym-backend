export const buildTrainingHistoryScopeFilter = ({
  progressScopeId = "",
  includeTrainingPlanId = "",
  excludeProgressScopeId = "",
} = {}) => {
  const included = [];
  if (progressScopeId) included.push({ progressScopeId });
  if (includeTrainingPlanId) {
    included.push({ trainingPlanId: includeTrainingPlanId });
  }

  const result = {};
  if (included.length === 1) Object.assign(result, included[0]);
  if (included.length > 1) result.$or = included;

  if (excludeProgressScopeId) {
    const exclusion = {
      progressScopeId: { $ne: excludeProgressScopeId },
    };
    if (included.length) {
      const inclusion =
        included.length > 1 ? { $or: included } : included[0];
      Object.keys(result).forEach((key) => delete result[key]);
      result.$and = [inclusion, exclusion];
    } else {
      Object.assign(result, exclusion);
    }
  }
  return result;
};

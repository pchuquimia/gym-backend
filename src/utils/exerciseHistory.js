const normalizeText = (value = "") =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const escapeRegExp = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const buildExerciseHistoryMatch = ({
  exerciseId = "",
  exerciseName = "",
} = {}) => {
  const normalizedId = String(exerciseId || "").trim();
  const normalizedName = String(exerciseName || "").trim();
  const matches = [];
  if (normalizedId) matches.push({ "exercises.exerciseId": normalizedId });
  if (normalizedName) {
    matches.push({
      "exercises.exerciseName": new RegExp(
        `^${escapeRegExp(normalizedName)}$`,
        "i",
      ),
    });
  }
  return matches.length === 1 ? matches[0] : { $or: matches };
};

export const matchesExerciseHistoryTarget = (
  exercise = {},
  { exerciseId = "", exerciseName = "" } = {},
) => {
  const normalizedId = String(exerciseId || "").trim();
  const candidateId = String(exercise.exerciseId || exercise.id || "").trim();
  if (normalizedId && candidateId === normalizedId) return true;

  const normalizedName = normalizeText(exerciseName);
  const candidateName = normalizeText(
    exercise.exerciseName || exercise.name || "",
  );
  return Boolean(normalizedName && candidateName === normalizedName);
};

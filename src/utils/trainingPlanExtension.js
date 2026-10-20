const DAY = 86400000;

export function planExtensionError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function calculatePlanExtension(
  plan,
  additionalWeeks,
  now = new Date(),
) {
  const weeks = Number(additionalWeeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52)
    throw planExtensionError("Añade de 1 a 52 semanas");
  if (!["active", "completed", "paused", "scheduled"].includes(plan.status))
    throw planExtensionError("Esta planificación no se puede extender", 409);
  const startDate = new Date(plan.startDate);
  const previousEnd = new Date(plan.endDate);
  const today = new Date(now);
  [startDate, previousEnd, today].forEach((date) =>
    date.setUTCHours(0, 0, 0, 0),
  );
  if (
    ![startDate, previousEnd, today].every((date) =>
      Number.isFinite(date.getTime()),
    ) ||
    previousEnd < startDate
  )
    throw planExtensionError(
      "Las fechas de la planificación no son válidas",
      409,
    );
  // Si venció, las semanas adicionales comienzan hoy, conservando el inicio original.
  const base = Math.max(previousEnd.getTime(), today.getTime() - DAY);
  const endDate = new Date(base + weeks * 7 * DAY);
  return {
    endDate,
    durationWeeks: Math.ceil(((endDate - startDate) / DAY + 1) / 7),
    status: plan.status === "completed" ? "active" : plan.status,
  };
}

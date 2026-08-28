const parseEventTime = (value) => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const normalizeTimeEvents = (events = []) =>
  Array.isArray(events)
    ? events
        .filter(
          (event) =>
            event?.type && event?.at && parseEventTime(event.at) != null,
        )
        .map((event) => ({
          type: event.type,
          at: new Date(parseEventTime(event.at)).toISOString(),
          exerciseId: event.exerciseId || null,
          ...(event.setId ? { setId: event.setId } : {}),
          ...(event.source ? { source: event.source } : {}),
          ...(event.restType ? { restType: event.restType } : {}),
          ...(Number.isFinite(Number(event.workSeconds))
            ? {
                workSeconds: Math.max(
                  0,
                  Math.round(Number(event.workSeconds)),
                ),
              }
            : {}),
        }))
        .sort((a, b) => parseEventTime(a.at) - parseEventTime(b.at))
    : [];

export const calculateTimingSummary = (events = []) => {
  let running = false;
  let resting = false;
  let activeExerciseId = null;
  let lastAt = null;
  let pauseStartedAt = null;
  let durationSeconds = 0;
  let restSeconds = 0;
  let pauseSeconds = 0;
  let recordedWorkSeconds = 0;
  const exerciseMap = new Map();
  const exerciseRestMap = new Map();
  const exerciseWorkMap = new Map();
  const normalizedEvents = normalizeTimeEvents(events);
  const hasRestEvents = normalizedEvents.some((event) =>
    ["rest_start", "rest_end"].includes(event.type),
  );
  const hasSetCompletionEvents = normalizedEvents.some(
    (event) => event.type === "set_complete",
  );

  const accrue = (nextAt) => {
    if (!running || lastAt == null || nextAt <= lastAt) return;
    const delta = Math.floor((nextAt - lastAt) / 1000);
    if (delta <= 0) return;
    durationSeconds += delta;
    if (resting) restSeconds += delta;
    if (activeExerciseId) {
      exerciseMap.set(
        activeExerciseId,
        (exerciseMap.get(activeExerciseId) || 0) + delta,
      );
      if (resting) {
        exerciseRestMap.set(
          activeExerciseId,
          (exerciseRestMap.get(activeExerciseId) || 0) + delta,
        );
      }
    }
  };

  normalizedEvents.forEach((event) => {
    const at = parseEventTime(event.at);
    accrue(at);
    if (event.type === "session_start" || event.type === "session_resume") {
      if (pauseStartedAt != null && at > pauseStartedAt) {
        pauseSeconds += Math.floor((at - pauseStartedAt) / 1000);
      }
      running = true;
      resting = false;
      pauseStartedAt = null;
      lastAt = at;
      return;
    }
    if (event.type === "session_pause" || event.type === "session_end") {
      if (pauseStartedAt != null && at > pauseStartedAt) {
        pauseSeconds += Math.floor((at - pauseStartedAt) / 1000);
      }
      running = false;
      resting = false;
      pauseStartedAt = event.type === "session_pause" ? at : null;
      lastAt = at;
      return;
    }
    if (
      event.type === "exercise_start" ||
      event.type === "exercise_selected"
    ) {
      if (!running) running = true;
      activeExerciseId = event.exerciseId || null;
      lastAt = at;
      return;
    }
    if (event.type === "set_complete") {
      const workSeconds = Math.max(0, Number(event.workSeconds) || 0);
      recordedWorkSeconds += workSeconds;
      if (event.exerciseId) {
        exerciseWorkMap.set(
          event.exerciseId,
          (exerciseWorkMap.get(event.exerciseId) || 0) + workSeconds,
        );
      }
      lastAt = at;
      return;
    }
    if (event.type === "set_start") {
      lastAt = at;
      return;
    }
    if (event.type === "rest_start" && running) {
      resting = true;
      lastAt = at;
      return;
    }
    if (event.type === "rest_end") {
      resting = false;
      lastAt = at;
    }
  });

  const workSeconds = hasSetCompletionEvents
    ? Math.min(durationSeconds, recordedWorkSeconds)
    : hasRestEvents
      ? Math.max(0, durationSeconds - restSeconds)
      : null;
  const preparationSeconds = hasSetCompletionEvents
    ? Math.max(0, durationSeconds - restSeconds - workSeconds)
    : null;
  const exerciseIds = new Set([
    ...exerciseMap.keys(),
    ...exerciseWorkMap.keys(),
    ...exerciseRestMap.keys(),
  ]);

  return {
    durationSeconds,
    workSeconds,
    restSeconds: hasRestEvents ? restSeconds : null,
    preparationSeconds,
    pauseSeconds,
    hasRestEvents,
    hasSetCompletionEvents,
    exerciseDurations: Array.from(exerciseIds).map((exerciseId) => {
      const trackedSeconds = exerciseMap.get(exerciseId) || 0;
      const exerciseRestSeconds = exerciseRestMap.get(exerciseId) || 0;
      const recordedExerciseWork = exerciseWorkMap.get(exerciseId) || 0;
      const exerciseWorkSeconds = hasSetCompletionEvents
        ? Math.min(trackedSeconds || recordedExerciseWork, recordedExerciseWork)
        : hasRestEvents
          ? Math.max(0, trackedSeconds - exerciseRestSeconds)
          : null;
      const durationSeconds = Math.max(
        trackedSeconds,
        (exerciseWorkSeconds || 0) + exerciseRestSeconds,
      );
      return {
        exerciseId,
        durationSeconds,
        workSeconds: exerciseWorkSeconds,
        restSeconds: hasRestEvents ? exerciseRestSeconds : null,
        preparationSeconds:
          hasSetCompletionEvents && Number.isFinite(exerciseWorkSeconds)
            ? Math.max(
                0,
                durationSeconds - exerciseRestSeconds - exerciseWorkSeconds,
              )
            : null,
      };
    }),
  };
};

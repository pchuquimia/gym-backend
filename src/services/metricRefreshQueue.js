import MetricRefreshJob from "../models/MetricRefreshJob.js";
import { markAthleteIntelligenceDirty } from "./athleteMetricsService.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const todayKey = () => new Date().toISOString().slice(0, 10);

export const enqueueAthleteMetricRefresh = async (ownerId, dateKey) => {
  const normalizedOwnerId = String(ownerId || "").trim();
  const normalizedDate = DATE_PATTERN.test(String(dateKey || ""))
    ? String(dateKey)
    : todayKey();
  if (!normalizedOwnerId) return;
  const today = todayKey();
  await Promise.all([
    markAthleteIntelligenceDirty(normalizedOwnerId, today),
    MetricRefreshJob.findByIdAndUpdate(
      `athlete-metrics:${normalizedOwnerId}:${normalizedDate}`,
      {
        $set: {
          ownerId: normalizedOwnerId,
          dateKey: normalizedDate,
          status: "pending",
          attempts: 0,
          nextRunAt: new Date(),
          lockedAt: null,
          completedAt: null,
          lastError: "",
          expiresAt: null,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ),
  ]);
};

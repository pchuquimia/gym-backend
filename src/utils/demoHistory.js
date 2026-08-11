const TRAINING_WEEKDAYS = new Set([1, 2, 4, 6]);

export const getDemoHistoryTrainingCount = () => {
  const value = Number(process.env.DEMO_HISTORY_TRAININGS || 200);
  return Number.isInteger(value) && value >= 40 && value <= 240 ? value : 200;
};

export const buildDemoTrainingOffsets = (count, today = new Date()) => {
  const target = Math.max(1, Math.floor(Number(count) || 1));
  const offsets = [];
  const cursor = new Date(today);
  cursor.setUTCHours(12, 0, 0, 0);

  for (let offset = -500; offset < 0; offset += 1) {
    const date = new Date(cursor);
    date.setUTCDate(date.getUTCDate() + offset);
    if (TRAINING_WEEKDAYS.has(date.getUTCDay())) offsets.push(offset);
  }

  return offsets.slice(-target);
};

export const buildDemoWeightOffsets = (count, today = new Date()) => {
  const target = Math.max(2, Math.floor(Number(count) || 2));
  const spanDays = Math.max(30, Math.min(364, target * 3));
  const offsets = new Set([0]);
  for (let index = 0; index < target - 1; index += 1) {
    offsets.add(-Math.round((spanDays * (index + 1)) / (target - 1)));
  }
  return [...offsets].sort((a, b) => a - b).slice(-target);
};

export const demoProgressionKg = (trainingIndex, totalTrainings) => {
  const progress = (trainingIndex / Math.max(1, totalTrainings - 1)) * 17.5;
  const wave = [0, 1.25, 2.5, 1.25, -2.5][trainingIndex % 5];
  const deload = trainingIndex > 0 && trainingIndex % 24 >= 20 ? -5 : 0;
  return Math.max(0, progress + wave + deload);
};

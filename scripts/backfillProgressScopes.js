import "dotenv/config";
import crypto from "crypto";
import mongoose from "mongoose";
import Routine from "../src/models/Routine.js";
import Training from "../src/models/Training.js";

const createProgressScopeId = () => `scope_${crypto.randomUUID()}`;

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI no configurado");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB conectado");

  const routines = await Routine.find({}).lean();
  const routineScopeById = new Map();
  let routinesUpdated = 0;

  for (const routine of routines) {
    const routineId = routine._id || routine.id;
    const progressScopeId = routine.progressScopeId || createProgressScopeId();
    routineScopeById.set(String(routineId), progressScopeId);

    if (!routine.progressScopeId) {
      await Routine.updateOne(
        { _id: routineId },
        {
          $set: {
            progressScopeId,
            progressMode: routine.progressMode || "fresh",
          },
        },
      );
      routinesUpdated += 1;
    }
  }

  const trainings = await Training.find(
    {
      $or: [
        { progressScopeId: { $exists: false } },
        { progressScopeId: "" },
        { progressScopeId: null },
      ],
    },
    "_id routineId",
  ).lean();

  let trainingsUpdated = 0;
  for (const training of trainings) {
    const routineId = training.routineId ? String(training.routineId) : "";
    const progressScopeId =
      routineScopeById.get(routineId) || `legacy_${routineId || "sin_rutina"}`;
    await Training.updateOne(
      { _id: training._id },
      { $set: { progressScopeId } },
    );
    trainingsUpdated += 1;
  }

  console.log(
    JSON.stringify(
      {
        routinesSeen: routines.length,
        routinesUpdated,
        trainingsSeen: trainings.length,
        trainingsUpdated,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});

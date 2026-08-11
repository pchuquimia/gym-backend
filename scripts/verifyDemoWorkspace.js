import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import Routine from "../src/models/Routine.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";
import User from "../src/models/User.js";
import WeightEntry from "../src/models/WeightEntry.js";
import {
  createDemoWorkspace,
  deleteDemoWorkspace,
} from "../src/services/demoWorkspaceService.js";

loadBackendEnvironment();

let workspaceId = "";

try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  const result = await createDemoWorkspace("athlete");
  workspaceId = result.workspaceId;
  const ownerId = result.user._id.toString();
  const counts = {
    users: await User.countDocuments({ demoWorkspaceId: workspaceId }),
    plans: await TrainingPlan.countDocuments({ athleteId: ownerId }),
    routines: await Routine.countDocuments({ ownerId }),
    trainings: await Training.countDocuments({ ownerId }),
    sessions: await Session.countDocuments({ ownerId }),
    weighIns: await WeightEntry.countDocuments({ ownerId }),
  };

  if (
    !counts.users ||
    counts.plans < 4 ||
    counts.routines < 3 ||
    counts.trainings < 40 ||
    !counts.sessions ||
    !counts.weighIns
  ) {
    throw new Error(`Workspace demo incompleto: ${JSON.stringify(counts)}`);
  }

  console.log(`Workspace demo verificado: ${JSON.stringify(counts)}`);
} finally {
  if (workspaceId) {
    await deleteDemoWorkspace(workspaceId);
  }
  await mongoose.disconnect();
}

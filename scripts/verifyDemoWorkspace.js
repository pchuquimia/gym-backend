import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import Routine from "../src/models/Routine.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";
import User from "../src/models/User.js";
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
  };

  if (!counts.users || !counts.plans || !counts.routines || !counts.trainings) {
    throw new Error(`Workspace demo incompleto: ${JSON.stringify(counts)}`);
  }

  console.log(`Workspace demo verificado: ${JSON.stringify(counts)}`);
} finally {
  if (workspaceId) {
    await deleteDemoWorkspace(workspaceId);
  }
  await mongoose.disconnect();
}

import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import Routine from "../src/models/Routine.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import TrainingPlan from "../src/models/TrainingPlan.js";
import User from "../src/models/User.js";
import WeightEntry from "../src/models/WeightEntry.js";
import AthleteCheckIn from "../src/models/AthleteCheckIn.js";
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
  const result = await createDemoWorkspace("coach");
  workspaceId = result.workspaceId;
  const athleteIds = result.members
    .filter((member) => member.role === "Cliente")
    .map((member) => member._id.toString());
  const counts = {
    users: await User.countDocuments({ demoWorkspaceId: workspaceId }),
    athletes: athleteIds.length,
    plans: await TrainingPlan.countDocuments({ athleteId: { $in: athleteIds } }),
    routines: await Routine.countDocuments({ ownerId: { $in: athleteIds } }),
    trainings: await Training.countDocuments({ ownerId: { $in: athleteIds } }),
    sessions: await Session.countDocuments({ ownerId: { $in: athleteIds } }),
    weighIns: await WeightEntry.countDocuments({ ownerId: { $in: athleteIds } }),
    checkIns: await AthleteCheckIn.countDocuments({
      athleteId: { $in: athleteIds },
    }),
  };

  if (
    counts.users < 6 ||
    counts.athletes < 5 ||
    counts.plans < 15 ||
    counts.routines < 12 ||
    counts.trainings < 150 ||
    !counts.sessions ||
    !counts.weighIns ||
    counts.checkIns < 5
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

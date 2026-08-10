import "dotenv/config";
import mongoose from "mongoose";
import Routine from "../src/models/Routine.js";
import User from "../src/models/User.js";

const apply = process.argv.includes("--apply");
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) throw new Error("MONGO_URI no esta configurado");

await mongoose.connect(mongoUri);

try {
  const [routines, users] = await Promise.all([
    Routine.find({}, "ownerId assignedByCoachId trainingPlanId sourceRoutineId kind version sourceRoutineVersion").lean(),
    User.find({}, "role").lean(),
  ]);
  const roleByUserId = new Map(
    users.map((user) => [String(user._id), user.role]),
  );
  const versionByRoutineId = new Map(
    routines.map((routine) => [String(routine._id), Number(routine.version || 1)]),
  );
  const operations = [];
  const totals = { template: 0, personal: 0, assigned: 0 };

  for (const routine of routines) {
    const kind =
      routine.trainingPlanId || routine.assignedByCoachId
        ? "assigned"
        : roleByUserId.get(String(routine.ownerId)) === "Entrenador"
          ? "template"
          : "personal";
    totals[kind] += 1;
    const sourceRoutineVersion = routine.sourceRoutineId
      ? versionByRoutineId.get(String(routine.sourceRoutineId)) || 1
      : null;
    const set = { kind, version: Number(routine.version || 1) };
    if (sourceRoutineVersion) set.sourceRoutineVersion = sourceRoutineVersion;
    operations.push({
      updateOne: { filter: { _id: routine._id }, update: { $set: set } },
    });
  }

  console.log(
    `Rutinas: ${routines.length} | plantillas: ${totals.template} | personales: ${totals.personal} | asignadas: ${totals.assigned}`,
  );
  if (!apply) {
    console.log("Simulacion terminada. Ejecuta con --apply para guardar.");
  } else {
    if (operations.length) await Routine.bulkWrite(operations, { ordered: false });
    console.log("Estructura de planificacion migrada.");
  }
} finally {
  await mongoose.disconnect();
}

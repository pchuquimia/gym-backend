import "dotenv/config";
import mongoose from "mongoose";
import PlanTemplate from "../src/models/PlanTemplate.js";
import Routine from "../src/models/Routine.js";
import { ensureDefaultPlanTemplates } from "../src/utils/defaultPlanTemplates.js";
import {
  DEFAULT_ROUTINE_TEMPLATES,
  ensureDefaultRoutineTemplates,
} from "../src/utils/defaultRoutineTemplates.js";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta configurado");

await mongoose.connect(process.env.MONGO_URI);

try {
  const result = await ensureDefaultRoutineTemplates({ force: true });
  await ensureDefaultPlanTemplates({ force: true });

  const routineIds = DEFAULT_ROUTINE_TEMPLATES.map((item) => item._id);
  const [routines, plans] = await Promise.all([
    Routine.find({ _id: { $in: routineIds } }, "_id exercises visibility kind").lean(),
    PlanTemplate.find({ visibility: "system" }, "_id weeklySchedule").lean(),
  ]);
  const linkedTrainingDays = plans.flatMap((plan) => plan.weeklySchedule || [])
    .filter((day) => day.type === "training");
  const invalidDays = linkedTrainingDays.filter(
    (day) => !day.sourceRoutineId || !routineIds.includes(day.sourceRoutineId),
  );
  if (routines.length !== routineIds.length || invalidDays.length) {
    throw new Error("La verificacion final de plantillas no fue satisfactoria");
  }

  console.log(
    `Plantillas listas: ${result.routineCount} rutinas, ${result.exerciseCount} ejercicios del catalogo y ${linkedTrainingDays.length} dias enlazados.`,
  );
} finally {
  await mongoose.disconnect();
}

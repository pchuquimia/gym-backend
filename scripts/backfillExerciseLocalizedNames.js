import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import {
  translateExerciseNameToEnglish,
  translateExerciseNameToSpanish,
} from "../src/utils/exerciseLocalization.js";

const apply = process.argv.includes("--apply");

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta configurado");
  await mongoose.connect(process.env.MONGO_URI);

  const exercises = await Exercise.find(
    {},
    "name localizedNames source.provider",
  ).lean();
  const operations = exercises.map((exercise) => {
    const importedInEnglish = exercise.source?.provider === "hasaneyldrm";
    const currentEnglish = exercise.localizedNames?.en?.trim();
    const currentSpanish = exercise.localizedNames?.es?.trim();
    const englishName =
      (currentEnglish || (importedInEnglish
        ? exercise.name
        : translateExerciseNameToEnglish(
            currentSpanish || exercise.name,
          ))) || "Exercise";
    const spanishName = currentSpanish || (importedInEnglish
      ? translateExerciseNameToSpanish(englishName)
      : exercise.name || translateExerciseNameToSpanish(englishName));
    const fields = {};
    if (!currentEnglish) fields["localizedNames.en"] = englishName;
    if (!currentSpanish) fields["localizedNames.es"] = spanishName;
    if (!Object.keys(fields).length) return null;
    return {
      updateOne: {
        filter: { _id: exercise._id },
        update: { $set: fields },
      },
    };
  }).filter(Boolean);

  const preview = operations.slice(0, 12).map((operation) => ({
    id: operation.updateOne.filter._id,
    en: operation.updateOne.update.$set["localizedNames.en"],
    es: operation.updateOne.update.$set["localizedNames.es"],
  }));
  console.log(JSON.stringify({ apply, count: operations.length, preview }, null, 2));

  if (apply && operations.length) {
    const result = await Exercise.bulkWrite(operations, { ordered: false });
    console.log(
      JSON.stringify(
        {
          matched: result.matchedCount,
          modified: result.modifiedCount,
        },
        null,
        2,
      ),
    );
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

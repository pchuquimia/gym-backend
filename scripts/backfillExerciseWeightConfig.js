import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import { inferWeightConfig } from "../src/utils/weightConfig.js";

const apply = process.argv.includes("--apply");

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta configurado");
  await mongoose.connect(process.env.MONGO_URI);

  const exercises = await Exercise.find(
    {},
    "name equipment loadType movementMode weightConfig",
  ).lean();
  const rows = exercises.map((exercise) => ({
    id: exercise._id,
    name: exercise.name,
    previous: exercise.weightConfig || null,
    next: inferWeightConfig(exercise),
  }));
  const summary = rows.reduce((accumulator, row) => {
    accumulator[row.next.basis] = (accumulator[row.next.basis] || 0) + 1;
    return accumulator;
  }, {});
  const samples = rows.reduce((accumulator, row) => {
    if (!accumulator[row.next.basis]) accumulator[row.next.basis] = [];
    if (accumulator[row.next.basis].length < 12) {
      accumulator[row.next.basis].push(row.name);
    }
    return accumulator;
  }, {});

  console.log(
    JSON.stringify(
      {
        apply,
        count: rows.length,
        summary,
        samples,
        preview: rows.slice(0, 20),
      },
      null,
      2,
    ),
  );

  if (apply && rows.length) {
    const result = await Exercise.bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { _id: row.id },
          update: { $set: { weightConfig: row.next } },
        },
      })),
      { ordered: false },
    );
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

import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import { getMongoConnectionOptions } from "../src/config/db.js";

loadBackendEnvironment();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const rollbackArgument = [...args].find((value) =>
  value.startsWith("--rollback="),
);
const rollbackPath = rollbackArgument?.slice("--rollback=".length) || "";

if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta configurado");

await mongoose.connect(process.env.MONGO_URI, {
  ...getMongoConnectionOptions(),
  minPoolSize: 0,
  appName: "apex-performance-database-quality",
});

const db = mongoose.connection.db;
const orphanStringRefs = (collection, field, target) =>
  db
    .collection(collection)
    .aggregate([
      { $match: { [field]: { $type: "string", $ne: "" } } },
      {
        $lookup: {
          from: target,
          localField: field,
          foreignField: "_id",
          as: "target",
        },
      },
      { $match: { "target.0": { $exists: false } } },
      { $project: { _id: 1, value: `$${field}` } },
    ])
    .toArray();

const ensureDatabaseValidators = async () => {
  const datePattern = "^\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$";
  const validators = {
    users: {
      required: ["name", "email", "password", "role"],
      properties: {
        name: { bsonType: "string", minLength: 2, maxLength: 80 },
        email: { bsonType: "string", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
        password: { bsonType: "string", pattern: "^\\$2[aby]\\$" },
        role: { enum: ["Admin", "Entrenador", "Cliente"] },
      },
    },
    trainings: {
      required: ["date", "ownerId"],
      properties: {
        date: { bsonType: "string", pattern: datePattern },
        ownerId: { bsonType: "string", minLength: 1 },
        durationSeconds: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
        totalVolume: { bsonType: ["int", "long", "double", "decimal"], minimum: 0 },
      },
    },
    sessions: {
      required: ["date", "ownerId", "exerciseId", "exerciseName"],
      properties: {
        date: { bsonType: "string", pattern: datePattern },
        ownerId: { bsonType: "string", minLength: 1 },
        exerciseId: { bsonType: "string", minLength: 1 },
      },
    },
    photos: {
      required: ["date", "ownerId", "url"],
      properties: {
        date: { bsonType: "string", pattern: datePattern },
        ownerId: { bsonType: "string", minLength: 1 },
        url: { bsonType: "string", minLength: 1 },
      },
    },
    weightentries: {
      required: ["dateKey", "ownerId", "weightKg", "recordedBy"],
      properties: {
        dateKey: { bsonType: "string", pattern: datePattern },
        ownerId: { bsonType: "string", minLength: 1 },
        weightKg: { bsonType: ["int", "long", "double", "decimal"], minimum: 25, maximum: 400 },
      },
    },
    athletedailymetrics: {
      required: ["dateKey", "ownerId"],
      properties: {
        dateKey: { bsonType: "string", pattern: datePattern },
        ownerId: { bsonType: "string", minLength: 1 },
      },
    },
    athletecheckins: {
      required: ["dateKey", "athleteId"],
      properties: {
        dateKey: { bsonType: "string", pattern: datePattern },
        athleteId: { bsonType: "string", minLength: 1 },
      },
    },
    trainingplans: {
      required: ["athleteId", "createdById", "startDate", "endDate", "status"],
      properties: {
        athleteId: { bsonType: "string", minLength: 1 },
        status: { enum: ["draft", "scheduled", "active", "paused", "completed", "cancelled"] },
      },
    },
  };

  for (const [collection, schema] of Object.entries(validators)) {
    const exists = await db.listCollections({ name: collection }).hasNext();
    if (!exists) continue;
    await db.command({
      collMod: collection,
      validator: { $jsonSchema: { bsonType: "object", ...schema } },
      validationLevel: "moderate",
      validationAction: "warn",
    });
  }
};

const rollback = async (filePath) => {
  const backup = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const restore = async (collection, operations) => {
        if (operations.length) {
          await db.collection(collection).bulkWrite(operations, { session });
        }
      };
      await restore(
        "sessions",
        backup.orphans.sessionTraining.map((item) => ({
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(item.id) },
            update: {
              $set: { trainingId: item.value },
              $unset: { historicalTrainingId: "", detachedAt: "" },
            },
          },
        })),
      );
      const trainingRestores = new Map();
      for (const item of backup.orphans.trainingRoutine) {
        trainingRestores.set(item.id, {
          ...(trainingRestores.get(item.id) || {}),
          routineId: item.value,
        });
      }
      for (const item of backup.orphans.trainingPlan) {
        trainingRestores.set(item.id, {
          ...(trainingRestores.get(item.id) || {}),
          trainingPlanId: item.value,
        });
      }
      await restore(
        "trainings",
        [...trainingRestores].map(([id, fields]) => ({
          updateOne: {
            filter: { _id: id },
            update: { $set: fields, $unset: { historicalRefs: "" } },
          },
        })),
      );
      await restore(
        "routines",
        backup.orphans.routinePlan.map((item) => ({
          updateOne: {
            filter: { _id: item.id },
            update: {
              $set: { trainingPlanId: item.value },
              $unset: { historicalTrainingPlanId: "", detachedAt: "" },
            },
          },
        })),
      );
    });
    console.log(JSON.stringify({ ok: true, rollback: path.resolve(filePath) }, null, 2));
  } finally {
    await session.endSession();
  }
};

try {
  if (rollbackPath) {
    await rollback(rollbackPath);
  } else {
    const [sessionTraining, trainingRoutine, trainingPlan, routinePlan] =
      await Promise.all([
        orphanStringRefs("sessions", "trainingId", "trainings"),
        orphanStringRefs("trainings", "routineId", "routines"),
        orphanStringRefs("trainings", "trainingPlanId", "trainingplans"),
        orphanStringRefs("routines", "trainingPlanId", "trainingplans"),
      ]);
    const backup = {
      createdAt: new Date().toISOString(),
      database: db.databaseName,
      orphans: {
        sessionTraining: sessionTraining.map((item) => ({ id: String(item._id), value: item.value })),
        trainingRoutine: trainingRoutine.map((item) => ({ id: String(item._id), value: item.value })),
        trainingPlan: trainingPlan.map((item) => ({ id: String(item._id), value: item.value })),
        routinePlan: routinePlan.map((item) => ({ id: String(item._id), value: item.value })),
      },
    };
    const summary = Object.fromEntries(
      Object.entries(backup.orphans).map(([key, value]) => [key, value.length]),
    );

    if (!apply) {
      console.log(JSON.stringify({ mode: "dry-run", summary }, null, 2));
    } else {
      const backupRoot = path.resolve(process.cwd(), "../artifacts/database-backups");
      await fs.mkdir(backupRoot, { recursive: true });
      const backupPath = path.join(
        backupRoot,
        `database-quality-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
      );
      await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          if (sessionTraining.length) {
            await db.collection("sessions").bulkWrite(
              sessionTraining.map((item) => ({
                updateOne: {
                  filter: { _id: item._id },
                  update: {
                    $set: {
                      historicalTrainingId: item.value,
                      trainingId: null,
                      detachedAt: new Date(),
                    },
                  },
                },
              })),
              { session },
            );
          }

          const trainingRepairs = new Map();
          for (const item of trainingRoutine) {
            trainingRepairs.set(String(item._id), {
              _id: item._id,
              set: { "historicalRefs.routineId": item.value, routineId: null },
            });
          }
          for (const item of trainingPlan) {
            const current = trainingRepairs.get(String(item._id)) || {
              _id: item._id,
              set: {},
            };
            current.set["historicalRefs.trainingPlanId"] = item.value;
            current.set.trainingPlanId = null;
            trainingRepairs.set(String(item._id), current);
          }
          if (trainingRepairs.size) {
            await db.collection("trainings").bulkWrite(
              [...trainingRepairs.values()].map((item) => ({
                updateOne: {
                  filter: { _id: item._id },
                  update: {
                    $set: {
                      ...item.set,
                      "historicalRefs.detachedAt": new Date(),
                      "historicalRefs.reason": "missing-parent-repair",
                    },
                  },
                },
              })),
              { session },
            );
          }
          if (routinePlan.length) {
            await db.collection("routines").bulkWrite(
              routinePlan.map((item) => ({
                updateOne: {
                  filter: { _id: item._id },
                  update: {
                    $set: {
                      historicalTrainingPlanId: item.value,
                      trainingPlanId: null,
                      detachedAt: new Date(),
                    },
                  },
                },
              })),
              { session },
            );
          }

          for (const collection of ["trainings", "sessions", "routines", "trainingplans"]) {
            await db.collection(collection).updateMany(
              { __v: { $exists: false } },
              { $set: { __v: 0 } },
              { session },
            );
          }
          await db.collection("exercises").updateMany(
            { isActive: { $exists: false } },
            { $set: { isActive: true } },
            { session },
          );
        });
      } finally {
        await session.endSession();
      }

      await ensureDatabaseValidators();
      const modelFiles = await fs.readdir(path.resolve(process.cwd(), "src/models"));
      for (const file of modelFiles) {
        if (file.endsWith(".js") && file !== "schemaValidation.js") {
          await import(`../src/models/${file}`);
        }
      }
      for (const model of Object.values(mongoose.models)) {
        await model.createIndexes();
      }
      console.log(JSON.stringify({ mode: "applied", summary, backupPath }, null, 2));
    }
  }
} finally {
  await mongoose.disconnect();
}

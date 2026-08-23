import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import Photo from "../src/models/Photo.js";
import Preference from "../src/models/Preference.js";
import Routine from "../src/models/Routine.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import User from "../src/models/User.js";
import {
  applyAdminCredentialRotation,
  getAdminBootstrapConfig,
} from "../src/config/adminBootstrap.js";

const rotatePasswordOnly = process.argv.includes("--rotate-password");

const missingOwnerFilter = {
  $or: [
    { ownerId: { $exists: false } },
    { ownerId: null },
    { ownerId: "" },
    { ownerId: "default" },
  ],
};

async function assignMissingOwner(Model, label, ownerId) {
  const result = await Model.updateMany(missingOwnerFilter, {
    $set: { ownerId },
  });
  console.log(`${label}: ${result.modifiedCount || 0} registros asignados`);
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI no esta definido");
  }

  const config = getAdminBootstrapConfig(process.env, {
    requirePassword: rotatePasswordOnly,
  });
  await mongoose.connect(process.env.MONGO_URI);

  let admin = await User.findOne({ email: config.email }).select("+password");
  if (!admin) {
    if (!config.password) {
      throw new Error(
        "ADMIN_PASSWORD es obligatorio para crear la cuenta administrativa",
      );
    }
    admin = await User.create({
      name: config.name,
      email: config.email,
      password: config.password,
      role: "Admin",
      isActive: true,
    });
    console.log("Cuenta administrativa creada de forma segura");
  } else if (rotatePasswordOnly) {
    applyAdminCredentialRotation(admin, config.password);
    await admin.save();
    console.log("Credencial administrativa rotada y sesiones revocadas");
  } else {
    admin.name = admin.name || config.name;
    admin.role = "Admin";
    admin.isActive = true;
    await admin.save();
    console.log("Cuenta administrativa existente validada");
  }

  if (rotatePasswordOnly) return;

  const adminId = admin._id.toString();

  await assignMissingOwner(Routine, "Rutinas", adminId);
  await assignMissingOwner(Training, "Entrenamientos", adminId);
  await assignMissingOwner(Session, "Sesiones", adminId);
  await assignMissingOwner(Photo, "Fotos", adminId);
  await assignMissingOwner(Exercise, "Ejercicios", adminId);

  const defaultPreference = await Preference.findOne({
    userId: "default",
  }).lean();
  if (defaultPreference) {
    await Preference.findOneAndUpdate(
      { userId: adminId },
      {
        $set: {
          branch: defaultPreference.branch || "sopocachi",
          locationMode: defaultPreference.locationMode || "single",
          allowedBranches: defaultPreference.allowedBranches?.length
            ? defaultPreference.allowedBranches
            : [defaultPreference.branch || "sopocachi"],
          goals: defaultPreference.goals || {},
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await Preference.deleteOne({ userId: "default" });
    console.log("Preferencias predeterminadas migradas");
  }
}

main()
  .catch((error) => {
    console.error(
      `No se pudo completar la operacion administrativa: ${error.message}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

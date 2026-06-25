import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import Photo from "../src/models/Photo.js";
import Preference from "../src/models/Preference.js";
import Routine from "../src/models/Routine.js";
import Session from "../src/models/Session.js";
import Training from "../src/models/Training.js";
import User from "../src/models/User.js";

const ADMIN = {
  name: "Administrador Gym",
  email: "admin@gym",
  password: "7O79963i9*",
};

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

  await mongoose.connect(process.env.MONGO_URI);

  let admin = await User.findOne({ email: ADMIN.email });
  if (!admin) {
    admin = await User.create({
      name: ADMIN.name,
      email: ADMIN.email,
      password: ADMIN.password,
      role: "Admin",
      isActive: true,
    });
    console.log("Admin creado");
  } else {
    admin.name = admin.name || ADMIN.name;
    admin.role = "Admin";
    admin.isActive = true;
    await admin.save();
    console.log("Admin existente actualizado");
  }

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
          goals: defaultPreference.goals || {},
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await Preference.deleteOne({ userId: "default" });
    console.log("Preferencias default migradas al Admin");
  }

  console.log("");
  console.log("Credenciales Admin");
  console.log(`Nombre: ${ADMIN.name}`);
  console.log(`Email: ${ADMIN.email}`);
  console.log(`Password: ${ADMIN.password}`);
  console.log("");
  console.log("Cambia este password despues del primer ingreso.");

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});

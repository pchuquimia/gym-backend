import "dotenv/config";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";
import User from "../src/models/User.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@gym.local";

const slugify = (text = "") =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta definido");
  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ email: ADMIN_EMAIL }).lean();
  const adminId = admin?._id?.toString() || null;
  const exercises = await Exercise.find({}).lean();
  let updated = 0;

  for (const exercise of exercises) {
    const slug = exercise.slug || slugify(exercise._id || exercise.name);
    const imageUrl = exercise.media?.image?.url || exercise.image || "";
    const imagePublicId =
      exercise.media?.image?.publicId || exercise.imagePublicId || "";
    await Exercise.findByIdAndUpdate(exercise._id, {
      $set: {
        slug,
        type: "system",
        ownerId: null,
        primaryMuscle: exercise.primaryMuscle || exercise.muscle || "",
        muscle: exercise.muscle || exercise.primaryMuscle || "",
        secondaryMuscles: exercise.secondaryMuscles || [],
        tags: exercise.tags || [],
        isActive: exercise.isActive ?? true,
        version: exercise.version || 1,
        createdBy: exercise.createdBy || adminId,
        updatedBy: adminId,
        image: imageUrl,
        imagePublicId,
        media: {
          ...(exercise.media || {}),
          image: {
            ...(exercise.media?.image || {}),
            url: imageUrl,
            publicId: imagePublicId,
          },
        },
      },
    });
    updated += 1;
  }

  console.log(`Ejercicios convertidos a catalogo system: ${updated}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});

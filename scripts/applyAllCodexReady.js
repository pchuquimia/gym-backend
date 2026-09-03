import "dotenv/config";
import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import Exercise from "../src/models/Exercise.js";
import Routine from "../src/models/Routine.js";
import CodexImageRequest from "../src/models/CodexImageRequest.js";

loadBackendEnvironment();
await mongoose.connect(process.env.MONGO_URI);
const requests = await CodexImageRequest.find({
  status: "ready",
  "result.url": /^https?:\/\//i,
});
let applied = 0;
for (const request of requests) {
  const exercise = await Exercise.findById(request.exerciseId);
  if (!exercise || !request.result?.url) continue;
  const uploaded = request.result.toObject?.() || request.result;
  exercise.media = { ...(exercise.media?.toObject?.() || exercise.media || {}), image: uploaded };
  exercise.image = uploaded.url;
  exercise.imagePublicId = uploaded.publicId || "";
  exercise.updatedBy = "admin:bulk-approval";
  await exercise.save();
  await Routine.updateMany(
    { "exercises.exerciseId": exercise._id },
    { $set: { "exercises.$[exercise].image": uploaded.url, "exercises.$[exercise].imagePublicId": uploaded.publicId || "" } },
    { arrayFilters: [{ "exercise.exerciseId": exercise._id }] },
  );
  await Routine.updateMany(
    { "exercises.alternatives.exerciseId": exercise._id },
    { $set: { "exercises.$[].alternatives.$[alternative].image": uploaded.url, "exercises.$[].alternatives.$[alternative].imagePublicId": uploaded.publicId || "" } },
    { arrayFilters: [{ "alternative.exerciseId": exercise._id }] },
  );
  request.status = "applied";
  request.appliedAt = new Date();
  request.reviewedAt = new Date();
  request.reviewedBy = "admin:bulk-approval";
  request.reviewDecision = "approved";
  await request.save();
  applied += 1;
}
console.log(JSON.stringify({ ready: requests.length, applied }));
await mongoose.disconnect();

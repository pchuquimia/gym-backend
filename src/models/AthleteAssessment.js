import mongoose from "mongoose";
import { isoDateKey } from "./schemaValidation.js";

const AthleteAssessmentSchema = new mongoose.Schema(
  {
    athleteId: { type: String, required: true, index: true },
    coachId: { type: String, required: true, index: true },
    planId: { type: String, required: true, index: true },
    type: { type: String, enum: ["final"], default: "final" },
    dateKey: isoDateKey(),
    answers: {
      progress: { type: Number, min: 1, max: 5, required: true },
      goalReached: {
        type: String,
        enum: ["yes", "partly", "no"],
        required: true,
      },
      pain: { type: String, trim: true, maxlength: 500, default: "" },
      feedback: { type: String, trim: true, maxlength: 1000, default: "" },
      availabilityChanged: { type: Boolean, default: false },
    },
    submittedBy: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

AthleteAssessmentSchema.index(
  { athleteId: 1, planId: 1, type: 1 },
  { unique: true },
);

export default mongoose.model("AthleteAssessment", AthleteAssessmentSchema);

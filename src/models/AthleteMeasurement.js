import mongoose from "mongoose";
import { isoDateKey } from "./schemaValidation.js";

const AthleteMeasurementSchema = new mongoose.Schema(
  {
    athleteId: { type: String, required: true, index: true },
    coachId: { type: String, default: null, index: true },
    planId: { type: String, default: null, index: true },
    dateKey: isoDateKey(),
    values: {
      waist: { type: Number, min: 1, max: 400, default: null },
      chest: { type: Number, min: 1, max: 400, default: null },
      hips: { type: Number, min: 1, max: 400, default: null },
      arm: { type: Number, min: 1, max: 200, default: null },
      thigh: { type: Number, min: 1, max: 250, default: null },
      calf: { type: Number, min: 1, max: 150, default: null },
    },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
    submittedBy: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

AthleteMeasurementSchema.index({ athleteId: 1, dateKey: 1 }, { unique: true });
AthleteMeasurementSchema.index({ athleteId: 1, dateKey: -1 });

export default mongoose.model("AthleteMeasurement", AthleteMeasurementSchema);

import mongoose from "mongoose";

const PreferenceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    branch: {
      type: String,
      enum: ["sopocachi", "miraflores"],
      default: "sopocachi",
    },
    locationMode: {
      type: String,
      enum: ["single", "multiple", "disabled"],
      default: "single",
    },
    allowedBranches: {
      type: [String],
      enum: ["sopocachi", "miraflores"],
      default: ["sopocachi"],
    },
    goals: { type: Object, default: {} },
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model("Preference", PreferenceSchema);

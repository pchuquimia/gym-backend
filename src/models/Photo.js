import mongoose from "mongoose";
import { isoDateKey } from "./schemaValidation.js";

const PhotoSchema = new mongoose.Schema(
  {
    date: isoDateKey(),
    label: { type: String, default: "" },
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
    deliveryType: {
      type: String,
      enum: ["upload", "authenticated"],
      default: "upload",
    },
    type: {
      type: String,
      enum: ["gym", "home", "profile"],
      default: "gym",
    },
    sessionId: { type: String, default: null },
    routineName: { type: String, default: "" },
    view: {
      type: String,
      enum: ["front", "side", "back", "other"],
      default: "front",
    },
    ownerId: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

PhotoSchema.index({ ownerId: 1, date: -1 });
PhotoSchema.index({ ownerId: 1, type: 1, view: 1 });

export default mongoose.model("Photo", PhotoSchema);

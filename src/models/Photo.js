import mongoose from "mongoose";
import { isoDateKey } from "./schemaValidation.js";

const PhotoSchema = new mongoose.Schema(
  {
    date: isoDateKey(),
    label: { type: String, default: "", maxlength: 240 },
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
    localFilename: { type: String, default: "" },
    storage: {
      type: String,
      enum: ["cloudinary", "private-local", "legacy-local", "external"],
      default: "external",
    },
    deliveryType: {
      type: String,
      enum: ["upload", "authenticated"],
      default: "upload",
    },
    mimeType: {
      type: String,
      enum: ["", "image/jpeg", "image/png", "image/webp"],
      default: "",
    },
    bytes: { type: Number, min: 0, default: null },
    width: { type: Number, min: 1, default: null },
    height: { type: Number, min: 1, default: null },
    contentStatus: {
      type: String,
      enum: ["available", "missing"],
      default: "available",
    },
    visibility: {
      type: String,
      enum: ["private", "coach"],
      default: "private",
    },
    type: {
      type: String,
      enum: ["gym", "home", "profile"],
      default: "gym",
    },
    sessionId: { type: String, default: null },
    routineName: { type: String, default: "", maxlength: 120 },
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
PhotoSchema.index({ ownerId: 1, visibility: 1, date: -1 });

export default mongoose.model("Photo", PhotoSchema);

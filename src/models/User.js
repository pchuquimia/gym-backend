import bcrypt from "bcrypt";
import mongoose from "mongoose";

export const USER_ROLES = ["Admin", "Entrenador", "Cliente"];

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: "Cliente",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    assignedTrainerId: {
      type: String,
      default: null,
      index: true,
    },
    profile: {
      birthDate: { type: String, default: "" },
      weight: { type: Number, default: 82.5 },
      height: { type: Number, default: 181 },
      goal: {
        type: String,
        enum: ["volumen", "mantenimiento", "definicion"],
        default: "mantenimiento",
      },
      calories: { type: Number, default: 2500 },
      units: { type: String, enum: ["metric", "imperial"], default: "metric" },
      privacy: { type: String, enum: ["público", "privado"], default: "público" },
      notifications: {
        workoutReminders: { type: Boolean, default: true },
        achievements: { type: Boolean, default: true },
        community: { type: Boolean, default: false },
      },
    },
    security: {
      biometricEnabled: { type: Boolean, default: true },
      twoFactorEnabled: { type: Boolean, default: false },
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    activeSessions: [
      {
        sessionId: { type: String, required: true },
        device: { type: String, default: "Dispositivo" },
        browser: { type: String, default: "Navegador" },
        os: { type: String, default: "" },
        ip: { type: String, default: "" },
        userAgent: { type: String, default: "" },
        createdAt: { type: Date, default: Date.now },
        lastSeenAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true, versionKey: false },
);

UserSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

UserSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    isActive: this.isActive,
    lastLoginAt: this.lastLoginAt,
    profile: this.profile,
    security: this.security,
    passwordChangedAt: this.passwordChangedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model("User", UserSchema);

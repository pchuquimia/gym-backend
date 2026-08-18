import bcrypt from "bcrypt";
import mongoose from "mongoose";
import {
  getEffectiveSubscription,
  getEntitlements,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
} from "../utils/subscription.js";
import { maxArrayLength } from "./schemaValidation.js";

export const USER_ROLES = ["Admin", "Entrenador", "Cliente"];
export const TRAINING_MODES = ["independent", "coach_managed"];

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
    isDemo: {
      type: Boolean,
      default: false,
      index: true,
    },
    demoWorkspaceId: {
      type: String,
      default: null,
      index: true,
    },
    demoExpiresAt: {
      type: Date,
      default: null,
      index: true,
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
    trainingMode: {
      type: String,
      enum: TRAINING_MODES,
      default: "independent",
      index: true,
    },
    onboarding: {
      status: {
        type: String,
        enum: ["pending", "complete"],
        default: "complete",
      },
      completedAt: { type: Date, default: null },
    },
    coachCode: {
      type: String,
      default: undefined,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
    },
    subscription: {
      plan: { type: String, enum: SUBSCRIPTION_PLANS, default: "free" },
      status: {
        type: String,
        enum: SUBSCRIPTION_STATUSES,
        default: "active",
      },
      trialEndsAt: { type: Date, default: null },
      currentPeriodEnd: { type: Date, default: null },
      activatedAt: { type: Date, default: null },
      canceledAt: { type: Date, default: null },
      trialStartedAt: { type: Date, default: null },
      trialUsedAt: { type: Date, default: null },
      provider: {
        type: String,
        enum: ["manual", "stripe", "other"],
        default: "manual",
      },
      grantedBy: { type: String, default: null },
      externalCustomerId: { type: String, default: null, select: false },
      externalSubscriptionId: { type: String, default: null, select: false },
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
      experienceLevel: {
        type: String,
        enum: ["beginner", "intermediate", "advanced"],
        default: "beginner",
      },
      weeklyFrequency: { type: Number, min: 1, max: 7, default: 3 },
      calories: { type: Number, default: 2500 },
      units: { type: String, enum: ["metric", "imperial"], default: "metric" },
      language: { type: String, enum: ["es", "en"], default: "es" },
      privacy: {
        type: String,
        enum: ["público", "privado"],
        default: "público",
      },
      notifications: {
        workoutReminders: { type: Boolean, default: true },
        achievements: { type: Boolean, default: true },
        community: { type: Boolean, default: false },
      },
      avatarPhotoId: { type: String, default: "" },
    },
    security: {
      biometricEnabled: { type: Boolean, default: true },
      twoFactorEnabled: { type: Boolean, default: false },
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    emailVerificationToken: {
      type: String,
      default: null,
      select: false,
    },
    emailVerificationExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    emailVerificationRequired: {
      type: Boolean,
      default: false,
    },
    emailVerifiedAt: {
      type: Date,
      default: null,
    },
    activeSessions: {
      type: [
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
      validate: maxArrayLength(20, "Las sesiones activas"),
    },
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

UserSchema.index({ role: 1, assignedTrainerId: 1, isActive: 1, name: 1 });

UserSchema.methods.toSafeJSON = function toSafeJSON() {
  const subscription = getEffectiveSubscription(this);
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    trainingMode:
      this.role === "Cliente" && this.assignedTrainerId
        ? "coach_managed"
        : this.trainingMode || "independent",
    onboarding: {
      status: this.onboarding?.status || "complete",
      completedAt: this.onboarding?.completedAt || null,
    },
    assignedTrainerId: this.assignedTrainerId || null,
    coachCode: ["Admin", "Entrenador"].includes(this.role)
      ? this.coachCode || null
      : null,
    isActive: this.isActive,
    isDemo: Boolean(this.isDemo),
    demoExpiresAt: this.isDemo ? this.demoExpiresAt || null : null,
    lastLoginAt: this.lastLoginAt,
    profile: this.profile,
    security: this.security,
    passwordChangedAt: this.passwordChangedAt,
    emailVerificationRequired: this.emailVerificationRequired,
    emailVerifiedAt: this.emailVerifiedAt,
    subscription,
    entitlements: getEntitlements(this),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model("User", UserSchema);

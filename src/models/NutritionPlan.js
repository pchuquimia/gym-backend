import mongoose from "mongoose";
import { isoDateKey, maxArrayLength } from "./schemaValidation.js";

const nutrient = () => ({ type: Number, min: 0, max: 10000, default: null });
export const NutritionMealSchema = new mongoose.Schema(
  {
    mealId: { type: String, required: true, maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    time: { type: String, default: "", maxlength: 5 },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    foods: {
      type: [
        new mongoose.Schema(
          {
            name: { type: String, required: true, trim: true, maxlength: 120 },
            quantity: {
              type: String,
              required: true,
              trim: true,
              maxlength: 100,
            },
            nutritionSource: {
              type: new mongoose.Schema(
                {
                  provider: { type: String, enum: ["usda"], required: true },
                  foodId: { type: String, required: true },
                  description: { type: String, required: true, maxlength: 300 },
                  grams: { type: Number, required: true, min: 0.1, max: 5000 },
                  portion: {
                    type: new mongoose.Schema(
                      {
                        amount: {
                          type: Number,
                          required: true,
                          min: 0.001,
                          max: 50000,
                        },
                        label: { type: String, required: true, maxlength: 80 },
                        gramWeight: {
                          type: Number,
                          required: true,
                          min: 0.1,
                          max: 5000,
                        },
                      },
                      { _id: false },
                    ),
                    default: undefined,
                  },
                  per100g: {
                    calories: nutrient(),
                    protein: nutrient(),
                    carbs: nutrient(),
                    fat: nutrient(),
                  },
                },
                { _id: false },
              ),
              default: null,
            },
            calories: nutrient(),
            protein: nutrient(),
            carbs: nutrient(),
            fat: nutrient(),
          },
          { _id: false },
        ),
      ],
      validate: maxArrayLength(30, "Los alimentos"),
      required: true,
    },
  },
  { _id: false },
);

export const NutritionSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 120 },
    notes: { type: String, default: "", maxlength: 2000 },
    meals: {
      type: [NutritionMealSchema],
      validate: maxArrayLength(8, "Las comidas"),
      required: true,
    },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    athleteId: { type: String, required: true },
    coachId: { type: String, required: true },
    startsOn: isoDateKey(),
    content: { type: NutritionSnapshotSchema, required: true },
  },
  { timestamps: true, versionKey: false },
);
schema.index({ athleteId: 1, coachId: 1, startsOn: -1, _id: -1 });
export default mongoose.model("NutritionPlan", schema);

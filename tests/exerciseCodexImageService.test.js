import CodexImageRequest from "../src/models/CodexImageRequest.js";
import {
  buildExerciseCodexImagePrompt,
  getExerciseReferenceImage,
} from "../src/services/exerciseCodexImageService.js";
import { shouldQueueExerciseImage } from "../src/services/exerciseCodexAutoQueueService.js";

describe("exerciseCodexImageService", () => {
  const exercise = {
    name: "Band bench press",
    localizedNames: { es: "Press de banca con banda elástica" },
    primaryMuscleGroup: "Pectoral",
    secondaryMuscles: ["Tríceps"],
    movementPattern: "Empuje horizontal",
    image: "https://res.cloudinary.com/demo/reference.webp",
  };

  it("crea un prompt anatómico autocontenido para Codex", () => {
    const prompt = buildExerciseCodexImagePrompt(
      exercise,
      "Mantener visible el agarre",
    );

    expect(prompt).toContain("Press de banca con banda elástica");
    expect(prompt).toContain("Musculos principales registrados: Pectoral");
    expect(prompt).toContain("resaltalos en rojo intenso");
    expect(prompt).toContain("Mantener visible el agarre");
  });

  it("obtiene la imagen maestra del ejercicio", () => {
    expect(getExerciseReferenceImage(exercise)).toBe(exercise.image);
    expect(() => getExerciseReferenceImage({ name: "Sin imagen" })).toThrow(
      "necesita una imagen de referencia",
    );
  });

  it("valida los estados de la cola", async () => {
    const request = new CodexImageRequest({
      exerciseId: "exercise-1",
      exerciseName: "Press de banca",
      referenceImage: exercise.image,
      prompt: "Prompt",
      requestedBy: "admin-1",
      status: "unknown",
    });

    await expect(request.validate()).rejects.toThrow(
      "is not a valid enum value",
    );
  });

  it("autoencola una imagen nueva y respeta decisiones previas", () => {
    const referenceImage = exercise.image;
    expect(shouldQueueExerciseImage({ referenceImage, latest: null })).toBe(
      true,
    );
    expect(
      shouldQueueExerciseImage({
        referenceImage,
        latest: { status: "ready", referenceImage },
      }),
    ).toBe(false);
    expect(
      shouldQueueExerciseImage({
        referenceImage,
        latest: { status: "skipped", referenceImage },
      }),
    ).toBe(false);
    expect(
      shouldQueueExerciseImage({
        referenceImage: "https://example.com/new-reference.webp",
        latest: { status: "applied", referenceImage },
      }),
    ).toBe(true);
  });

  it("acepta los estados de revision rapida", async () => {
    const request = new CodexImageRequest({
      exerciseId: "exercise-1",
      exerciseName: "Press de banca",
      referenceImage: exercise.image,
      prompt: "Prompt",
      requestedBy: "admin-1",
      status: "rejected",
      reviewDecision: "regenerate",
      source: "regeneration",
      attempt: 2,
    });

    await expect(request.validate()).resolves.toBeUndefined();
  });
});

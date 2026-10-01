import { getCuratedExerciseNamePatch } from "../src/utils/exerciseNameCuration.js";
import { translateExerciseNameToSpanish } from "../src/utils/exerciseLocalization.js";

describe("exercise name curation", () => {
  test("conserva el nombre anterior para buscarlo sin cambiar el identificador", () => {
    const patch = getCuratedExerciseNamePatch({
      _id: "dataset-hasane-0033",
      localizedNames: { es: "Declinado press de banca con barra" },
      aliases: ["Press declinado barra"],
    });

    expect(patch.status).toBe("change");
    expect(patch.values["localizedNames.es"]).toBe("Press de banca declinado con barra");
    expect(patch.values.aliases).toContain("Declinado press de banca con barra");
    expect(patch.values.aliases).toContain("Press declinado barra");
  });

  test("elimina un alias de otro movimiento", () => {
    const patch = getCuratedExerciseNamePatch({
      _id: "dataset-hasane-0031",
      localizedNames: { es: "Curl con barra" },
      aliases: ["Press con barra libre"],
    });

    expect(patch.values.aliases).not.toContain("Press con barra libre");
    expect(patch.values.aliases).toContain("Curl con barra");
  });

  test("detiene una corrección si otro editor cambió el nombre", () => {
    expect(getCuratedExerciseNamePatch({
      _id: "dataset-hasane-0033",
      localizedNames: { es: "Nombre revisado por entrenador" },
      aliases: [],
    }).status).toBe("conflict");
  });

  test("nuevas importaciones reciben nombres revisados en vez de traducciones literales", () => {
    expect(translateExerciseNameToSpanish("barbell decline bench press"))
      .toBe("Press de banca declinado con barra");
    expect(translateExerciseNameToSpanish("resistance band seated biceps curl"))
      .toBe("Curl de bíceps sentado con banda elástica");
  });

  test("corrige un ejercicio de pecho y conserva su nombre anterior como alias", () => {
    const patch = getCuratedExerciseNamePatch({
      _id: "dataset-hasane-0314",
      localizedNames: { es: "Inclinado press de banca con mancuernas" },
      aliases: ["Press de banca inclinado con mancuernas"],
    });

    expect(patch.values["localizedNames.es"])
      .toBe("Press de banca inclinado con mancuernas");
    expect(patch.values.aliases).toContain("Inclinado press de banca con mancuernas");
  });

  test("elimina alias que confunden un cruce de poleas con un press", () => {
    const patch = getCuratedExerciseNamePatch({
      _id: "dataset-hasane-0155",
      localizedNames: { es: "Cross-sobre variation con polea" },
      aliases: ["Press de pecho con cable", "Cable chest press"],
    });

    expect(patch.values["localizedNames.es"]).toBe("Cruce de poleas para pecho");
    expect(patch.values.aliases).not.toContain("Press de pecho con cable");
    expect(patch.values.aliases).toContain("Cruce de cables");
  });

  test("añade un término habitual sin cambiar un nombre que ya es claro", () => {
    const patch = getCuratedExerciseNamePatch({
      _id: "dataset-hasane-0025",
      localizedNames: { es: "Press de banca con barra" },
      aliases: [],
    });

    expect(patch.status).toBe("change");
    expect(patch.values.aliases).toContain("Press banca");
  });
});

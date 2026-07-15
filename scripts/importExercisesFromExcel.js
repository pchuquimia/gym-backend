import "dotenv/config";
import { spawnSync } from "child_process";
import path from "path";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise.js";

const DEFAULT_XLSX_PATH = "C:\\Users\\ipouk\\Desktop\\ejercicios.xlsx";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const inputArg = args.find((arg) => arg !== "--dry-run");

const BODY_REGION_GROUPS = {
  "Tren superior": [
    "Pecho",
    "Espalda",
    "Hombros",
    "Bíceps",
    "Tríceps",
    "Antebrazos",
  ],
  "Tren inferior": [
    "Cuádriceps",
    "Isquiotibiales",
    "Glúteos",
    "Aductores",
    "Abductores",
    "Pantorrillas",
    "Tibial anterior",
  ],
  "Zona media": [
    "Abdominales",
    "Oblicuos",
    "Transverso abdominal",
    "Erectores espinales",
    "Core global",
  ],
  "Cuerpo completo": [
    "Full body",
    "Levantamientos olímpicos",
    "Ejercicios metabólicos",
    "Movimientos combinados",
  ],
};

const VISUAL_NAVIGATION_GROUPS = {
  Pecho: ["Pecho"],
  Espalda: ["Espalda"],
  Hombros: ["Hombros"],
  Brazos: ["Bíceps", "Tríceps", "Antebrazos"],
  Piernas: [
    "Cuádriceps",
    "Isquiotibiales",
    "Aductores",
    "Abductores",
    "Pantorrillas",
    "Tibial anterior",
  ],
  Glúteos: ["Glúteos"],
  Core: [
    "Abdominales",
    "Oblicuos",
    "Transverso abdominal",
    "Erectores espinales",
    "Core global",
  ],
  "Cuerpo completo": [
    "Full body",
    "Levantamientos olímpicos",
    "Ejercicios metabólicos",
    "Movimientos combinados",
  ],
};

const slugify = (text = "") =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const normalizeKey = (text = "") =>
  text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const clean = (value) => String(value || "").trim();

const unique = (items = []) =>
  Array.from(new Set(items.map((item) => clean(item)).filter(Boolean)));

const splitList = (value = "") =>
  unique(
    clean(value)
      .split(/\s*,\s*|\s+\/\s+/)
      .flatMap((part) => part.split(/\s+y\s+/i))
      .map((part) => part.trim()),
  );

const readWorkbookRows = (xlsxPath) => {
  const pythonCode = String.raw`
import json
import sys
from openpyxl import load_workbook

sys.stdout.reconfigure(encoding="utf-8")
path = sys.argv[1]
wb = load_workbook(path, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if not any(row):
        continue
    rows.append({
        "id": row[0] or "",
        "name": row[1] or "",
        "excelCategory": row[2] or "",
        "subcategory": row[3] or "",
        "mainCapability": row[4] or "",
        "movementPattern": row[5] or "",
        "equipment": row[6] or "",
        "rawType": row[7] or "",
        "difficulty": row[8] or "",
        "laterality": row[9] or "",
        "impact": row[10] or "",
        "variants": row[11] or "",
    })
print(json.dumps(rows, ensure_ascii=False))
`;

  const result = spawnSync("python", ["-c", pythonCode, xlsxPath], {
    encoding: "utf8",
    maxBuffer: 25 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || "No se pudo leer el Excel con Python");
  }
  return JSON.parse(result.stdout || "[]");
};

const getCategory = (row) => {
  const excelCategory = normalizeKey(row.excelCategory);
  const rawType = normalizeKey(row.rawType);
  if (excelCategory === "cardio" || rawType.includes("cardio")) return "Cardio";
  if (excelCategory === "movilidad" || rawType.includes("movilidad")) {
    return "Movilidad";
  }
  if (excelCategory === "activacion" || rawType.includes("activacion")) {
    return "Activación";
  }
  if (rawType.includes("estabilidad")) return "Estabilidad";
  if (rawType.includes("pliometr") || rawType.includes("hiit")) {
    return "Pliometría";
  }
  return "Fuerza e hipertrofia";
};

const getBodyRegion = (row, primaryMuscleGroup) => {
  const excelCategory = clean(row.excelCategory);
  if (excelCategory === "Tren superior") return "Tren superior";
  if (excelCategory === "Tren inferior") return "Tren inferior";
  if (excelCategory === "Core") return "Zona media";
  if (excelCategory === "Cuerpo completo" || excelCategory === "Cardio") {
    return "Cuerpo completo";
  }
  const fromGroup = Object.entries(BODY_REGION_GROUPS).find(([, groups]) =>
    groups.includes(primaryMuscleGroup),
  );
  return fromGroup?.[0] || "Cuerpo completo";
};

const getNavigationRegion = (primaryMuscleGroup) => {
  const found = Object.entries(VISUAL_NAVIGATION_GROUPS).find(([, groups]) =>
    groups.includes(primaryMuscleGroup),
  );
  return found?.[0] || primaryMuscleGroup;
};

const getPrimaryMuscleGroup = (row) => {
  const category = normalizeKey(row.excelCategory);
  const sub = normalizeKey(row.subcategory);
  const cap = normalizeKey(row.mainCapability);
  const combined = `${sub} ${cap}`;

  if (sub.startsWith("pecho")) return "Pecho";
  if (sub.startsWith("espalda") || combined.includes("dorsal"))
    return "Espalda";
  if (sub.startsWith("hombro") || combined.includes("deltoides"))
    return "Hombros";
  if (sub.startsWith("biceps") || combined.includes("biceps")) return "Bíceps";
  if (sub.startsWith("triceps") || combined.includes("triceps"))
    return "Tríceps";
  if (sub.startsWith("antebrazo") || combined.includes("agarre")) {
    return "Antebrazos";
  }

  if (combined.includes("cuadriceps") || combined.includes("sentadilla")) {
    return "Cuádriceps";
  }
  if (combined.includes("isquiotibial") || combined.includes("femoral")) {
    return "Isquiotibiales";
  }
  if (combined.includes("glute")) return "Glúteos";
  if (combined.includes("aductor")) return "Aductores";
  if (combined.includes("abductor")) return "Abductores";
  if (combined.includes("pantorrilla") || combined.includes("triceps sural")) {
    return "Pantorrillas";
  }
  if (combined.includes("tibial") || combined.includes("tobillo")) {
    return "Tibial anterior";
  }

  if (combined.includes("oblicuo") || combined.includes("rotacion")) {
    return "Oblicuos";
  }
  if (combined.includes("transverso")) return "Transverso abdominal";
  if (combined.includes("erector") || combined.includes("columna")) {
    return "Erectores espinales";
  }
  if (
    category === "core" ||
    combined.includes("core") ||
    combined.includes("anti-extension") ||
    combined.includes("anti-flexion")
  ) {
    return "Core global";
  }
  if (combined.includes("abdominal") || combined.includes("recto abdominal")) {
    return "Abdominales";
  }

  if (combined.includes("olimpic") || combined.includes("triple extension")) {
    return "Levantamientos olímpicos";
  }
  if (
    category === "cardio" ||
    combined.includes("metabolic") ||
    combined.includes("acondicionamiento") ||
    combined.includes("aerob")
  ) {
    return "Ejercicios metabólicos";
  }
  if (combined.includes("carga") || combined.includes("transporte")) {
    return "Movimientos combinados";
  }
  return "Full body";
};

const mapEquipment = (value = "") => {
  const text = normalizeKey(value);
  const equipment = [];
  const addIf = (condition, label) => {
    if (condition) equipment.push(label);
  };

  addIf(text.includes("peso corporal"), "Peso corporal");
  addIf(text.includes("barra de dominadas"), "Barra de dominadas");
  addIf(
    text.includes("barra") && !text.includes("barra de dominadas"),
    "Barra",
  );
  addIf(text.includes("mancuerna"), "Mancuernas");
  addIf(text.includes("disco"), "Discos");
  addIf(text.includes("kettlebell"), "Kettlebell");
  addIf(text.includes("polea"), "Polea");
  addIf(text.includes("smith"), "Máquina Smith");
  addIf(text.includes("maquina") && !text.includes("smith"), "Máquina");
  addIf(text.includes("banda") || text.includes("minibanda"), "Banda elástica");
  addIf(
    text.includes("trx") || text.includes("suspension"),
    "TRX o suspensión",
  );
  addIf(text.includes("balon"), "Balón medicinal");
  addIf(text.includes("fitball"), "Fitball");
  addIf(text.includes("bosu"), "Bosu");
  addIf(text.includes("cajon"), "Cajón");
  addIf(text.includes("banco"), "Banco");
  addIf(text.includes("landmine"), "Landmine");
  addIf(text.includes("trineo"), "Trineo");
  addIf(text.includes("cuerda"), "Cuerda");
  addIf(text.includes("paralela"), "Paralelas");
  addIf(text.includes("caminadora"), "Caminadora");
  addIf(text.includes("bicicleta"), "Bicicleta");
  addIf(text.includes("eliptica"), "Elíptica");
  addIf(text.includes("remo"), "Remo ergómetro");
  addIf(text.includes("escaladora"), "Escaladora");
  addIf(
    !equipment.length ||
      text.includes("sin equipo") ||
      text.includes("suelo") ||
      text.includes("exterior"),
    "Sin equipamiento",
  );
  return unique(equipment);
};

const mapExerciseType = (rawType = "") => {
  const text = normalizeKey(rawType);
  if (text.includes("aislamiento")) return "Monoarticular o aislamiento";
  if (text.includes("compuesto")) return "Multiarticular o compuesto";
  return clean(rawType) || "Dinámico";
};

const mapExecutionType = (rawType = "") => {
  const text = normalizeKey(rawType);
  if (text.includes("isometrico")) return "Isométrico";
  if (text.includes("excentrico")) return "Excéntrico";
  if (text.includes("reactivo")) return "Reactivo";
  if (text.includes("potencia") || text.includes("pliometr"))
    return "Balístico";
  return "Dinámico";
};

const mapStability = (rawType = "", equipment = []) => {
  const text = normalizeKey(rawType);
  if (text.includes("guiado") || equipment.includes("Máquina")) {
    return "Guiado por máquina";
  }
  if (
    equipment.some((item) =>
      ["Barra", "Mancuernas", "Kettlebell", "Discos"].includes(item),
    )
  ) {
    return "Peso libre";
  }
  if (text.includes("estabilidad") || text.includes("equilibrio")) {
    return "Inestable";
  }
  return "Estable";
};

const inferPosition = (name = "", equipment = []) => {
  const text = normalizeKey(name);
  if (text.includes("sentad")) return "De pie";
  if (text.includes("sentado") || text.includes("sentada")) return "Sentado";
  if (text.includes("supino") || text.includes("banca")) {
    return "Acostado en supino";
  }
  if (text.includes("prono")) return "Acostado en prono";
  if (text.includes("lateral")) return "Decúbito lateral";
  if (text.includes("cuadrupedia")) return "Cuadrupedia";
  if (text.includes("arrodillado")) return "Arrodillado";
  if (text.includes("medio arrodillado")) return "Medio arrodillado";
  if (text.includes("dominada") || text.includes("suspension"))
    return "Suspendido";
  if (text.includes("inclinado")) return "Inclinado";
  if (text.includes("declinado")) return "Declinado";
  if (equipment.includes("Banco")) return "Apoyado en banco";
  if (equipment.includes("Máquina")) return "En máquina";
  return "De pie";
};

const mapGoals = (category, rawType = "") => {
  const text = normalizeKey(rawType);
  const goals = [];
  if (category === "Cardio") goals.push("Acondicionamiento cardiovascular");
  if (category === "Movilidad") goals.push("Movilidad");
  if (category === "Activación") goals.push("Activación");
  if (category === "Estabilidad") goals.push("Estabilidad");
  if (category === "Pliometría") goals.push("Potencia", "Velocidad");
  if (category === "Fuerza e hipertrofia")
    goals.push("Fuerza máxima", "Hipertrofia");
  if (text.includes("metabolic") || text.includes("hiit")) {
    goals.push("Pérdida de grasa", "Resistencia muscular");
  }
  if (text.includes("control motor") || text.includes("tecnica"))
    goals.push("Técnica");
  if (text.includes("equilibrio")) goals.push("Equilibrio");
  return unique(goals);
};

const mapMovementPatterns = (row, category) => {
  const pattern = clean(row.movementPattern);
  const text = normalizeKey(pattern);
  const patterns = [pattern];
  if (category === "Cardio" || text.includes("locomocion"))
    patterns.push("Correr");
  if (text.includes("transporte")) patterns.push("Transporte de cargas");
  if (text.includes("triple extension")) patterns.push("Saltar");
  return unique(patterns);
};

const toExercisePayload = (row) => {
  const id = slugify(row.id || row.name);
  const category = getCategory(row);
  const primaryMuscleGroup = getPrimaryMuscleGroup(row);
  const bodyRegion = getBodyRegion(row, primaryMuscleGroup);
  const navigationRegion = getNavigationRegion(primaryMuscleGroup);
  const equipment = mapEquipment(row.equipment);
  const rawType = clean(row.rawType);
  const goals = mapGoals(category, rawType);
  const impact = clean(row.impact);
  const variants = clean(row.variants);
  const subcategory = clean(row.subcategory);

  return {
    _id: id,
    slug: id,
    name: clean(row.name),
    aliases: [],
    category,
    categories: [category],
    bodyRegion,
    navigationRegion,
    primaryMuscleGroup,
    muscle: primaryMuscleGroup,
    primaryMuscle: primaryMuscleGroup,
    primaryMuscles: splitList(row.mainCapability),
    secondaryMuscles: [],
    stabilizerMuscles: [],
    movementPattern: mapMovementPatterns(row, category)[0] || "",
    movementPatterns: mapMovementPatterns(row, category),
    equipment,
    exerciseType: mapExerciseType(rawType),
    laterality: clean(row.laterality) || "Bilateral",
    kineticChain: "Mixta",
    executionType: mapExecutionType(rawType),
    stability: mapStability(rawType, equipment),
    position: inferPosition(row.name, equipment),
    difficulty: clean(row.difficulty) || "Principiante",
    goals,
    mechanics: {
      forceType: "",
      contraction: mapExecutionType(rawType),
    },
    force: "",
    precautions:
      impact && impact !== "Bajo" ? [`Impacto ${impact.toLowerCase()}`] : [],
    description: [
      subcategory ? `Subcategoría: ${subcategory}.` : "",
      rawType ? `Tipo original: ${rawType}.` : "",
      variants ? `Variantes configurables: ${variants}.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    instructions: [],
    commonMistakes: [],
    branches: ["general"],
    tags: unique([subcategory, rawType, impact, variants]),
    type: "system",
    ownerId: null,
    isActive: true,
    version: 1,
    createdBy: "excel_import",
    updatedBy: "excel_import",
  };
};

async function main() {
  const xlsxPath = path.resolve(inputArg || DEFAULT_XLSX_PATH);
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI no esta definido");

  const rows = readWorkbookRows(xlsxPath);
  const payloads = rows
    .map(toExercisePayload)
    .filter((exercise) => exercise._id && exercise.name);

  if (dryRun) {
    const countByCategory = payloads.reduce((acc, exercise) => {
      acc[exercise.category] = (acc[exercise.category] || 0) + 1;
      return acc;
    }, {});
    const countByRegion = payloads.reduce((acc, exercise) => {
      acc[exercise.bodyRegion] = (acc[exercise.bodyRegion] || 0) + 1;
      return acc;
    }, {});
    console.log(
      JSON.stringify(
        {
          xlsxPath,
          total: payloads.length,
          countByCategory,
          countByRegion,
          sample: payloads.slice(0, 5).map((exercise) => ({
            id: exercise._id,
            name: exercise.name,
            category: exercise.category,
            bodyRegion: exercise.bodyRegion,
            primaryMuscleGroup: exercise.primaryMuscleGroup,
            movementPatterns: exercise.movementPatterns,
            equipment: exercise.equipment,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  await mongoose.connect(process.env.MONGO_URI);

  let created = 0;
  let updated = 0;
  for (const payload of payloads) {
    const existing = await Exercise.exists({ _id: payload._id });
    const setPayload = { ...payload };
    if (existing) delete setPayload.createdBy;
    await Exercise.updateOne(
      { _id: payload._id },
      { $set: setPayload },
      { upsert: true, runValidators: true },
    );
    if (existing) updated += 1;
    else created += 1;
  }

  console.log(
    `Importacion completada desde ${xlsxPath}: ${created} creados, ${updated} actualizados, ${payloads.length} procesados.`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});

import mongoose from "mongoose";

const REFERENCE_BATCH_SIZE = 500;

export const getReferenceIdCandidates = (value) => {
  const reference = String(value || "").trim();
  if (!reference) return [];
  if (!mongoose.Types.ObjectId.isValid(reference)) return [reference];
  return [reference, new mongoose.Types.ObjectId(reference)];
};

export const findOrphanStringReferences = async (
  db,
  { collection, field, targetCollection },
) => {
  const source = db.collection(collection);
  const target = db.collection(targetCollection);
  const references = (
    await source.distinct(field, {
      [field]: { $type: "string", $ne: "" },
    })
  )
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!references.length) return [];

  const existing = new Set();
  for (
    let offset = 0;
    offset < references.length;
    offset += REFERENCE_BATCH_SIZE
  ) {
    const batch = references.slice(offset, offset + REFERENCE_BATCH_SIZE);
    const candidates = batch.flatMap(getReferenceIdCandidates);
    const matches = await target
      .find({ _id: { $in: candidates } }, { projection: { _id: 1 } })
      .toArray();
    matches.forEach((item) => existing.add(String(item._id)));
  }

  const orphanValues = references.filter(
    (reference) => !existing.has(reference),
  );
  if (!orphanValues.length) return [];
  const rows = await source
    .find(
      { [field]: { $in: orphanValues } },
      { projection: { _id: 1, [field]: 1 } },
    )
    .toArray();
  return rows.map((item) => ({ _id: item._id, value: item[field] }));
};

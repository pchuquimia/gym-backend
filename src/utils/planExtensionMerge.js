const id = (value) => String(value || "");

export function buildPlanExtensionMerges(plans) {
  const byId = new Map(plans.map((plan) => [id(plan._id), plan]));
  const children = new Map();
  const linked = plans.filter((plan) => !plan.coachId && plan.sourcePlanId);
  for (const plan of linked) {
    const parent = byId.get(id(plan.sourcePlanId));
    if (
      !parent ||
      parent.coachId ||
      id(parent.athleteId) !== id(plan.athleteId)
    ) {
      throw new Error(`Origen incompatible o ausente: ${plan._id}`);
    }
    const siblings = children.get(id(parent._id)) || [];
    siblings.push(plan);
    children.set(id(parent._id), siblings);
    if (siblings.length > 1)
      throw new Error(
        `La planificación ${parent._id} tiene varias continuaciones; requiere revisión`,
      );
  }
  const visited = new Set();
  const merges = [];
  for (const root of plans.filter(
    (plan) => !plan.coachId && !plan.sourcePlanId && children.has(id(plan._id)),
  )) {
    const chain = [root];
    while (children.has(id(chain.at(-1)._id))) {
      const child = children.get(id(chain.at(-1)._id))[0];
      if (visited.has(id(child._id)))
        throw new Error("Cadena de extensiones circular");
      visited.add(id(child._id));
      chain.push(child);
    }
    // Retener el último ID conserva el plan activo y las referencias de la sesión en curso.
    const canonical = chain.at(-1);
    if (
      chain
        .slice(0, -1)
        .some((plan) => ["active", "scheduled"].includes(plan.status))
    ) {
      throw new Error(
        `Hay una extensión anterior todavía abierta: ${root._id}`,
      );
    }
    const slots = (plan) =>
      JSON.stringify(
        (plan.weeklySchedule || []).map((slot) => [
          slot.slotId,
          slot.dayIndex,
          slot.type,
        ]),
      );
    if (
      chain.some(
        (plan) =>
          plan.scheduleMode !== root.scheduleMode ||
          slots(plan) !== slots(root),
      )
    ) {
      throw new Error(`La estructura de las extensiones cambió: ${root._id}`);
    }
    const startDate = new Date(
      Math.min(...chain.map((plan) => new Date(plan.startDate).getTime())),
    );
    const endDate = new Date(
      Math.max(...chain.map((plan) => new Date(plan.endDate).getTime())),
    );
    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      endDate < startDate
    )
      throw new Error("Fechas de extensión inválidas");
    const aliases = [
      ...new Set(
        chain.flatMap((plan) => [id(plan._id), ...(plan.mergedPlanIds || [])]),
      ),
    ].filter((value) => value !== id(canonical._id));
    merges.push({
      chain,
      canonicalId: id(canonical._id),
      athleteId: id(root.athleteId),
      removedIds: chain.slice(0, -1).map((plan) => id(plan._id)),
      currentRoutineIds: (canonical.weeklySchedule || [])
        .filter((slot) => slot.type === "training" && slot.routineId)
        .map((slot) => id(slot.routineId)),
      updates: {
        name: root.name,
        startDate,
        endDate,
        durationWeeks: Math.ceil(((endDate - startDate) / 86400000 + 1) / 7),
        sourcePlanId: root.sourcePlanId || null,
        sourcePlanSnapshot: root.sourcePlanSnapshot || {
          name: "",
          updatedAt: null,
        },
        mergedPlanIds: aliases,
      },
    });
  }
  if (visited.size !== linked.length)
    throw new Error("Hay extensiones circulares o sin una raíz válida");
  return merges;
}

export function remapPlanReferences(value, aliases) {
  if (Array.isArray(value))
    return value.map((item) => remapPlanReferences(item, aliases));
  if (
    !value ||
    typeof value !== "object" ||
    value instanceof Date ||
    value._bsontype
  )
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      [
        "planId",
        "trainingPlanId",
        "historicalTrainingPlanId",
        "sourcePlanId",
      ].includes(key) &&
      typeof item === "string" &&
      aliases.has(item)
        ? aliases.get(item)
        : remapPlanReferences(item, aliases),
    ]),
  );
}

# Extender una planificación

`POST /api/plans/:id/extend` recibe `additionalWeeks` (entero de 1 a 52),
`expectedEndDate` y `expectedUpdatedAt`. `durationWeeks` se acepta como alias
para clientes anteriores. La respuesta es la planificación actualizada (HTTP 200).

La operación conserva ID, nombre, fecha de inicio, rutinas, slots y avance del
ciclo. Añade semanas al final; si el plan venció, las semanas adicionales
comienzan hoy. Un plan completado se reactiva si no hay otro activo. Los planes
pausados o programados conservan su estado. La modificación y la disponibilidad
de las rutinas se guardan en una transacción, con comprobación de versión.

La duración acumulada puede superar 52 semanas. El límite de 52 corresponde a
las semanas que se añaden en una operación, no a la duración total. `endDate`
puede caer a mitad de semana si hubo una pausa; los cambios de estado no deben
recalcularlo a partir de la duración redondeada.

## Desarrollo local

Ejecuta `npm run dev` para reiniciar la API automáticamente al cambiar `src/`.
Después de actualizar un backend que se inició sin vigilancia, reinícialo una
vez. La implementación anterior de la extensión esperaba `durationWeeks` y
`startDate`; si recibe solo `additionalWeeks`, puede devolver el mensaje
«La duración debe ser de 1 a 52 semanas» incluso al solicitar dos semanas.
No añadas campos antiguos para sortear ese error: aquella implementación creaba
otra planificación. Actualiza el proceso para conservar el mismo plan.

## Reparación de continuaciones anteriores

Desde la carpeta del backend:

```powershell
node scripts/auditExtendedPlans.js
node scripts/mergeExtendedTrainingPlans.js
node scripts/mergeExtendedTrainingPlans.js --apply
node scripts/verifyPlanExtensionMerge.js ../.local-backups/plan-extensions-FECHA.json
```

Si el entorno necesita el resolvedor DNS local del proyecto, añade
`--require ../dns-local.cjs` después de `node`. Se respeta `MONGO_DB_NAME`.

La migración solo reconoce cadenas explícitas por `sourcePlanId` de planes
autogestionados del mismo atleta. Rechaza ciclos, ramas y cambios de estructura;
no infiere relaciones por nombres ni fusiona asignaciones de coaches.

Antes de escribir, guarda los documentos afectados en formato Extended JSON en
`.local-backups/`, fuera de los repositorios. Comprueba que no hayan cambiado
desde el respaldo y aplica la fusión en una transacción. Retiene el ID del último
plan para conservar el plan activo y la sesión en curso, el nombre y comienzo
originales, el final más lejano y las rutinas actuales. `mergedPlanIds` conserva
los IDs anteriores para resolver enlaces e intenciones antiguas.

Reasigna las referencias en entrenamientos, rutinas, mediciones, evaluaciones y
borradores. Mantiene todas las rutinas y sus scopes de progreso; las versiones
antiguas quedan archivadas con `historicalTrainingPlanId`. No borra entrenamientos.
El verificador compara el contenido de los entrenamientos y los ejercicios y
scopes de las rutinas con el respaldo. Reejecutar la migración no vuelve a fusionar
los planes ya reparados.

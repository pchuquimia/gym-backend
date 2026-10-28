# Alimentación del alumno

El coach asigna un plan diario que se repite desde `startsOn`. Cada plan contiene
entre una y ocho comidas, con alimentos, cantidades, horario e indicaciones.
Las calorías y los macronutrientes son opcionales y corresponden a la cantidad
indicada de cada alimento. El buscador acepta cantidad + alimento, por ejemplo `200g de pechuga de pollo`,
consulta USDA FoodData Central y escala los nutrientes por 100 g a esa cantidad.
El coach selecciona la preparación correcta (crudo/cocido). Cambiar la cantidad
en g o kg recalcula desde los valores originales, sin acumular redondeos.
La entrada manual sigue disponible. No se utiliza una base de datos de Fitia.

## Acceso y endpoints

- `GET /api/nutrition/day?dateKey=YYYY-MM-DD&timezone=America/La_Paz`: día del alumno autenticado.
- `PATCH /api/nutrition/day`: marca o desmarca una comida; solo el alumno puede escribir su registro.
- `GET /api/nutrition/athletes/:athleteId?timezone=America/La_Paz`: planes, día actual y hasta 14 días registrados.
- `POST /api/nutrition/athletes/:athleteId/plans`: publica una nueva versión del plan.

El coach solo puede gestionar alumnos actualmente vinculados y activos. El rol
Admin tampoco permite acceder a dietas de alumnos de otros coaches. Las cuentas
demo se limitan a su workspace. Los cambios de vinculación se comprueban en la
base de datos, incluso si la sesión está en caché.

## Registro por día y versiones

Antes del primer registro se utiliza el plan con la fecha de inicio más reciente
que no supere el día consultado. El primer check guarda una copia del plan en
NutritionDay. Las modificaciones posteriores conservan esa copia para ese día;
los días sin registro usan la nueva versión. Las actualizaciones concurrentes de
comidas usan operaciones atómicas y un índice único por alumno, coach y fecha.

El frontend envía su zona horaria IANA. El servidor valida fechas y bloquea
checks de días futuros. Los totales se muestran solo cuando todos los alimentos
relevantes incluyen ese dato; los datos faltantes no se interpretan como cero.
La eliminación de cuentas y de workspaces demo incluye los nuevos modelos.

## Catálogo nutricional

Configura `USDA_API_KEY` en el entorno privado del backend. Se obtiene desde
https://fdc.nal.usda.gov/api-guide/. Nunca se envía al navegador.
En desarrollo, sin clave, se utiliza DEMO_KEY con límites de consulta reducidos;
en producción una clave propia es necesaria. El catálogo admite búsquedas con
nombres comunes en español mediante alias y conserva la descripción original
para elegir el alimento y su preparación. No interpreta recetas completas.

`GET /api/nutrition/foods/search?q=200g%20de%20pechuga%20de%20pollo` está restringido
a coaches y administradores. Las búsquedas usan caché de seis horas y comparten
consultas simultáneas. Solo se ofrecen fichas con kcal, proteínas, carbohidratos
y grasas completos; los datos faltantes no se inventan.

Cada alimento calculado conserva proveedor, ID, descripción, gramos y valores
por 100 g. Al asignar una dieta se comprueba que la cantidad coincida y se
recalculan los totales antes de guardar. Modificar los macros manualmente
elimina la vinculación con la ficha, evitando atribuir valores editados a USDA.

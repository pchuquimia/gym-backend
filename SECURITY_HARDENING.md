# Operaciones de hardening de seguridad

## Peticiones con cookies y revocación de permisos

Las escrituras autenticadas mediante la cookie `jwt` requieren el encabezado
`X-CSRF-Token`. El cliente obtiene `{ csrfToken }` mediante
`GET /api/auth/csrf`, con credenciales incluidas, y lo envía en POST, PUT, PATCH
y DELETE. El token está firmado y ligado a la cookie actual; hay que obtener
uno nuevo después de cambiar de sesión. Axios lo gestiona automáticamente y
reintenta una sola vez si el servidor rechaza un token anterior antes de
ejecutar la operación.

Los orígenes de escritura y de CORS se validan con la misma configuración:
`CLIENT_URL`, `CLIENT_URLS` y `DEMO_CLIENT_URL`. Producción no permite orígenes
locales salvo que estén configurados explícitamente. Los clientes que utilizan
solo Bearer, sin cookie de sesión, no necesitan token CSRF. El callback de
Google conserva su propia comprobación de estado OAuth.

En producción, la carga de permisos solo agrupa consultas simultáneas; no
conserva usuarios entre ráfagas de peticiones. Así una instancia no mantiene
sesiones o roles revocados por otra instancia. La invalidación local también
descarta y repite las lecturas en curso que quedaron obsoletas.

Este cambio requiere desplegar frontend y backend de forma coordinada y
recargar los clientes abiertos para que envíen el nuevo encabezado. No requiere
rotar `JWT_SECRET` ni cambiar las cookies existentes.

## Comprobaciones de persistencia aisladas

`npm run test:integration` inicia un replica set temporal local mediante
`mongodb-memory-server`, verifica el borrado de cuentas, rollback, relaciones
de coach y los índices de borradores, y detiene la base al terminar. No carga
`.env` ni utiliza `MONGO_URI`. La primera ejecución puede descargar el binario
de MongoDB. La CI ejecuta estas comprobaciones además de las pruebas rápidas.

Los borradores se eliminan tanto por `ownerId` como por `startedById`. Las
operaciones que comparten una transacción se ejecutan secuencialmente. Las
fotos privadas locales se guardan en `private-uploads/`, excluido de Git.

Los errores internos de producción se registran con un `X-Request-Id` generado
por el servidor, método, patrón de ruta y ubicaciones de la pila. No se
registran cuerpos, cookies, encabezados, query strings ni el mensaje bruto del
error, que podría contener datos sensibles.

## Hallazgo de la credencial heredada

El Sprint 1 eliminó una credencial administrativa estática de
`scripts/createAdminAndAssignData.js` y cualquier impresión de credenciales.

La búsqueda exacta de la credencial encontró el commit `db4038c`. El historial
relacionado del mismo script incluye `f4792e4` y `ec68a59`. Se inspeccionó el
historial Git, pero no se reescribió en este sprint. Quien conserve un clon o
commit antiguo todavía puede recuperar el valor hasta que se apruebe por
separado la limpieza del historial y la renovación coordinada de clones.

## Inicialización segura

La inicialización exige un `ADMIN_EMAIL` explícito. `ADMIN_PASSWORD` también es
obligatorio cuando la cuenta no existe. La contraseña debe tener entre 16 y 72
bytes, no puede parecer un valor de ejemplo y debe alcanzar al menos 70 bits de
entropía estimada.

Nunca añada estos valores al código, argumentos del shell, tickets, capturas o
logs. Inyéctelos para un solo proceso desde un gestor de secretos aprobado u
obténgalos interactivamente en una sesión controlada de PowerShell:

```powershell
$env:ADMIN_EMAIL = Read-Host "Administrator email"
$secureAdminPassword = Read-Host "New administrator password" -AsSecureString
$env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", $secureAdminPassword).Password
npm run admin:init
Remove-Item Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
$secureAdminPassword = $null
```

`admin:init` crea la cuenta solamente cuando no existe. Para una cuenta
existente valida el rol administrativo y ejecuta la asignación heredada de
propiedad sin cambiar la contraseña.

## Rotación de la cuenta administrativa afectada

El repositorio no rota automáticamente ninguna credencial real.

1. Programe una ventana de mantenimiento y confirme un respaldo reciente de
   MongoDB.
2. Identifique la cuenta creada por el script heredado mediante registros
   administrativos aprobados. No copie la credencial anterior en un ticket.
3. Genere una contraseña aleatoria y única en el gestor corporativo.
4. Inyecte el correo de la cuenta afectada y la nueva contraseña con el
   procedimiento interactivo anterior, ejecutando `npm run admin:rotate` en
   lugar de `admin:init`.
5. La rotación actualiza la contraseña y `passwordChangedAt`, limpia bloqueos y
   tokens de restablecimiento, y revoca todas las sesiones de esa cuenta.
6. Elimine las variables temporales y verifique que ningún comando o log de
   proceso contenga sus valores.
7. Inicie sesión una vez, confirme el rol Admin y revise los logs recientes de
   auditoría y acceso ante actividad inesperada.
8. Registre fecha, operador e identificador de cuenta sin guardar la contraseña.

Cuando todos los clones y despliegues activos incorporen el Sprint 1, planifique
una operación separada y aprobada para eliminar el valor antiguo del historial
Git y reemplazar los clones obsoletos. Esa operación queda fuera de alcance.

## Requisitos del secreto JWT

La API no inicia si `JWT_SECRET` no tiene al menos 32 bytes, parece un valor de
ejemplo o no alcanza 120 bits de entropía Shannon estimada. El mensaje de error
describe los requisitos, pero nunca incluye el valor recibido.

Genere y almacene los secretos JWT en el gestor de secretos de cada entorno.
Use valores diferentes en desarrollo, staging y producción. Rotar el secreto
de producción invalida sesiones existentes y requiere un plan propio de
despliegue y comunicación.

## Información pública de salud

`GET /api/health` permanece como endpoint público de vida. En cualquier entorno
distinto de `development`, `GET /api/health/architecture` devuelve únicamente
`{ "ok": true }`. Las regiones, latencia de base de datos y estado de caché
detallados solo quedan disponibles en desarrollo.

En producción, todo JWT debe estar ligado a una sesión mediante `sid`. Esto
cierra tokens administrativos heredados sin sesión; la rotación coordinada de
`JWT_SECRET` continúa siendo obligatoria durante el despliegue para invalidar
todos los tokens emitidos anteriormente.

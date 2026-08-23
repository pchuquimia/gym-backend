# Operaciones de hardening de seguridad

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

`GET /api/health` permanece como endpoint público de vida. En producción,
`GET /api/health/architecture` devuelve únicamente `{ "ok": true }`. Las
regiones, latencia de base de datos y estado de caché detallados solo quedan
disponibles fuera de producción.

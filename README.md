# Apex Performance - Backend

API de Apex Performance. Gestiona autenticación, usuarios, coaches, atletas, ejercicios, rutinas, planificaciones, entrenamientos, analítica, pesajes, fotografías y archivos multimedia.

## Tecnologías

- Node.js y Express.
- MongoDB con Mongoose.
- JWT, cookies HTTP-only y bcrypt.
- Cloudinary para imágenes persistentes.
- Multer para recepción temporal de archivos.
- Nodemailer para verificación y recuperación por correo.
- Helmet, CORS, rate limiting y compresión HTTP.

## Requisitos

- Node.js 22 recomendado.
- npm 10 o posterior.
- MongoDB local o MongoDB Atlas.
- Cuenta de Cloudinary para imágenes persistentes.

## Configuración local

1. Instala las dependencias:

   ```powershell
   npm install
   ```

2. Crea el archivo local de configuración:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Configura como mínimo:

   | Variable     | Descripción                                  |
   | ------------ | -------------------------------------------- |
   | `MONGO_URI`  | Cadena de conexión a MongoDB.                |
   | `JWT_SECRET` | Secreto aleatorio de al menos 32 caracteres. |
   | `CLIENT_URL` | Origen permitido del frontend.               |
   | `PORT`       | Puerto HTTP; por defecto `4000`.             |
   | `NODE_ENV`   | `development` o `production`.                |

4. Inicia la API:

   ```powershell
   npm run dev
   ```

5. Comprueba el servicio:

   ```text
   GET http://localhost:4000/api/health
   ```

   Respuesta esperada: `{ "ok": true }`.

## Variables opcionales

| Grupo           | Variables                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- |
| Cookies         | `COOKIE_EXPIRES`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN`                       |
| CORS            | `CLIENT_URL`, `CLIENT_URLS`                                                                 |
| Rendimiento     | `MONGO_MIN_POOL_SIZE`, `MONGO_MAX_POOL_SIZE`, `SLOW_REQUEST_MS`, `REDIS_URL`                |
| Topologia       | `BACKEND_REGION`, `MONGO_REGION`                                                            |
| Worker metricas | `METRICS_WORKER_POLL_MS`, `METRICS_WORKER_MAX_ATTEMPTS`                                     |
| Demo publica    | `DEMO_MODE`, `DEMO_WORKSPACE_HOURS`, `DEMO_HISTORY_TRAININGS`, `DEMO_CLIENT_URL`            |
| Autenticación   | `EMAIL_VERIFICATION_REQUIRED`                                                               |
| Correo          | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`          |
| Cloudinary      | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` y carpetas asociadas |
| Imágenes con IA | `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`                                                      |

`DEV_ADMIN_LOGIN` debe utilizarse únicamente en desarrollo. No habilites accesos automáticos en producción.

### Procesamiento de metricas

El dashboard utiliza `GET /api/dashboard/bootstrap`, snapshots persistentes e
indicadores diarios materializados. Inicializa los datos existentes una vez:

```powershell
npm run metrics:backfill
```

En produccion ejecuta un segundo servicio con:

```powershell
npm run worker:metrics
```

Si `REDIS_URL` esta configurado, los snapshots se comparten entre instancias;
sin Redis se utiliza un LRU local limitado. Configura `BACKEND_REGION` y
`MONGO_REGION` con el mismo identificador y consulta
`GET /api/health/architecture` para verificar la topologia.

## Módulos de la API

| Ruta base          | Responsabilidad                                             |
| ------------------ | ----------------------------------------------------------- |
| `/api/auth`        | Registro, login, perfil, sesiones y recuperación de acceso. |
| `/api/users`       | Administración de usuarios y roles.                         |
| `/api/coach`       | Asignaciones, atletas, planes y rutinas supervisadas.       |
| `/api/exercises`   | Catálogo, filtros, medios y ejercicios personalizados.      |
| `/api/routines`    | Rutinas propias y asignadas.                                |
| `/api/plans`       | Planificaciones activas, archivadas y cíclicas.             |
| `/api/trainings`   | Registro, historial y duración de entrenamientos.           |
| `/api/analytics`   | Resúmenes y análisis derivados.                             |
| `/api/weigh-ins`   | Seguimiento de peso.                                        |
| `/api/photos`      | Fotografías de progreso y perfil.                           |
| `/api/check-ins`   | Estado diario, molestias y recuperación del atleta.         |
| `/api/billing`     | Plan actual, prueba autoservicio y cancelación de Premium.  |
| `/api/preferences` | Preferencias de sede y experiencia.                         |

Las rutas privadas pasan por autenticación JWT. El acceso a datos de atletas se valida contra la relación real con el entrenador; ser administrador no concede acceso automático a sesiones ajenas.

Las cuentas nuevas de atleta se crean con onboarding pendiente y sin medidas corporales ficticias. `PATCH /api/auth/onboarding` valida y guarda objetivo, experiencia, frecuencia semanal, peso y altura antes de marcar la configuracion como completa; las cuentas existentes conservan el estado completo por compatibilidad.

El panel de coach agrega una cartera priorizada, alertas de adherencia y recuperación, informes semanales y borradores explicables de planificación. Los borradores nunca se activan automáticamente: el coach debe revisarlos y guardarlos.

`/api/analytics/intelligence` conserva las tendencias historicas para Free y, con permisos Premium, combina carga reciente, check-ins, plan activo y pesajes para producir una recomendacion explicable. Tambien calcula progresion por ejercicio, 1RM estimado, estancamientos y una siguiente accion conservadora. La comparativa del dashboard enfrenta la semana activa contra los mismos dias de la semana anterior para sesiones, volumen, fuerza estimada, adherencia y recuperacion.

Las funciones premium se autorizan en el servidor mediante los planes `free`, `athlete_pro` y `coach_pro`. Cada cuenta puede iniciar una sola prueba autoservicio de 14 días desde `/api/billing/trial`; mientras se integra un proveedor de pagos, un administrador también puede activar periodos manuales o devolver una cuenta al plan gratuito desde `PATCH /api/users/:id/subscription`.

## Demo publica aislada

Activa `DEMO_MODE=true` para mostrar accesos temporales como atleta, coach y administrador. Cada acceso crea un workspace independiente con planificacion, rutinas, sesiones, pesajes y fechas relativas al dia actual. `DEMO_WORKSPACE_HOURS` define su vigencia entre 1 y 168 horas; el valor recomendado es `12`.

`DEMO_HISTORY_TRAININGS` controla el historial de la cuenta principal entre 40 y 240 sesiones. El valor recomendado `200` genera aproximadamente un ano de actividad, cuatro planes, cuatro rutinas y 120 pesajes; los atletas secundarios usan una muestra reducida de 80 sesiones.

Las cuentas demo no pueden modificar usuarios, credenciales, relaciones de coach, imagenes, plantillas globales ni el catalogo compartido. El administrador demo solo recibe usuarios ficticios de su workspace. Los workspaces vencidos se eliminan durante el siguiente acceso demo, incluidos sus entrenamientos y documentos asociados.

La demo necesita un catalogo de ejercicios ya importado. Configura `DEMO_CLIENT_URL` con la direccion exacta del frontend dedicado; ese origen se agrega a CORS y es el unico que puede iniciar demos en produccion.

## Scripts operativos

| Comando                                  | Uso                                              |
| ---------------------------------------- | ------------------------------------------------ |
| `npm run dev`                            | Inicia la API.                                   |
| `npm test`                               | Ejecuta pruebas Jest de API y logica de carga.   |
| `npm run test:watch`                     | Ejecuta Jest en modo observacion.                |
| `npm run test:postman`                   | Ejecuta con Newman la coleccion Postman local.   |
| `npm run admin:init`                     | Crea o actualiza el administrador inicial.       |
| `npm run progress:backfill-scopes`       | Completa ámbitos históricos de progreso.         |
| `npm run plans:backfill`                 | Normaliza planificaciones existentes.            |
| `npm run exercises:normalize-catalog`    | Normaliza el catálogo de ejercicios.             |
| `npm run import:exercises-excel`         | Importa ejercicios desde Excel.                  |
| `npm run import:exercises-dataset`       | Importa el dataset externo configurado.          |
| `npm run sync:cloudinary-exercises`      | Sincroniza imágenes del catálogo con Cloudinary. |
| `npm run upload:exercises-dataset-media` | Publica medios del dataset en Cloudinary.        |

Los scripts de migración modifican datos persistentes. Ejecuta una copia de seguridad y valida primero en un entorno de prueba.

## Pruebas automatizadas

- **Jest** valida la clasificacion de carga, tonelaje, series completadas y utilidades del backend.
- **Supertest** verifica el contrato HTTP basico de Express sin abrir un puerto adicional.
- **Postman/Newman** valida salud, autenticacion local, usuario actual, catalogo, rutinas e historial contra la API real.

Para ejecutar Postman, inicia primero el backend en `http://localhost:4000` y luego usa:

```powershell
npm run test:postman
```

La coleccion y el entorno importables en Postman se encuentran en `postman/`. El flujo de autenticacion administrativa es exclusivo de desarrollo y no debe ejecutarse contra produccion.

## Estructura

```text
src/
├── config/       Conexión y configuración de infraestructura
├── controllers/  Casos de uso de autenticación
├── middleware/   Autenticación, autorización, validación y errores
├── models/       Esquemas de MongoDB
├── routes/       Endpoints agrupados por dominio
├── services/     Integraciones y procesos de negocio
└── utils/        Utilidades de medios, planes y analítica

scripts/          Importaciones, migraciones y mantenimiento
uploads/          Archivos temporales locales; no se versionan
```

## Medios y archivos generados

- Las imágenes persistentes deben almacenarse en Cloudinary.
- `uploads/` se usa solo como almacenamiento temporal o fallback local.
- Logs, `.env`, `node_modules/` y `uploads/` están excluidos mediante `.gitignore`.
- No guardes secretos ni credenciales dentro del repositorio.

## Producción

Configura `NODE_ENV=production`, una conexión MongoDB segura, `JWT_SECRET`, los orígenes HTTPS permitidos y cookies seguras. Después ejecuta:

```powershell
npm install
npm start
```

El proveedor de despliegue debe inyectar las variables de entorno; el archivo `.env` no forma parte del repositorio.

La politica de validacion, migraciones reversibles, respaldos y recuperacion se
documenta en [DATABASE_OPERATIONS.md](./DATABASE_OPERATIONS.md).

## Repositorio relacionado

Frontend: [pchuquimia/gym-frontend](https://github.com/pchuquimia/gym-frontend)

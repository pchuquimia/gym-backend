# Actualización de dependencias

## Propuestas automáticas

Dependabot revisa npm los lunes a las 09:00 y GitHub Actions a las 09:30, hora de Bolivia (`America/La_Paz`).

- Los parches y versiones menores se agrupan por familia. Los grupos solo aplican a actualizaciones regulares de versión.
- Las versiones mayores se proponen por separado y requieren revisar cambios incompatibles y la guía de migración. Las familias que deban migrar juntas, como React y React DOM, se coordinan en una misma rama antes de incorporar la migración.
- Hay como máximo cinco propuestas regulares de npm y tres de Actions abiertas. GitHub gestiona por separado el límite de propuestas de seguridad.
- Las versiones regulares esperan tres días desde su publicación. Las correcciones de seguridad no están sujetas a esta espera ni al horario semanal.
- Las correcciones de seguridad se revisan individualmente. Deben estar activados el grafo de dependencias, las alertas y las actualizaciones de seguridad de Dependabot en los ajustes del repositorio; el YAML no sustituye esos ajustes.
- La automatización propone cambios. No se configura aprobación, incorporación ni despliegue automático de propuestas.

## Antes de incorporar una actualización

1. Revisar los paquetes afectados, los cambios de versión y las notas de publicación. No asumir que un cambio menor es siempre compatible, especialmente en paquetes `0.x`.
2. Mantener `package.json` y `package-lock.json` juntos. Instalar con `npm ci` usando las versiones de Node y npm de `package.json`.
3. Exigir que termine correctamente el check `test` de GitHub Actions. Incluye las pruebas y auditorías definidas en `.github/workflows/test.yml`; en frontend también incluye compilación y recorridos de navegador.
4. Comprobar los recorridos afectados antes de publicar: acceso, planificación, alimentos y cantidades o mensajes según el paquete actualizado. CI usa datos simulados o aislados y no sustituye esta revisión.
5. Revisar e incorporar manualmente el pull request. Una vulnerabilidad urgente tiene prioridad sobre el mantenimiento semanal.

No ejecutar `npm audit fix --force` como actualización rutinaria ni eliminar el lockfile para resolver conflictos. Si una corrección exige una versión mayor, tratarla como una migración y probarla.

## Node y npm

`package.json > engines` contiene las versiones exactas de Node y npm. GitHub Actions las lee del manifiesto y verifica que se estén utilizando; Heroku también lee ese manifiesto. No hay versiones duplicadas en el workflow.

Dependabot para npm no mantiene automáticamente `engines`. Revisar mensualmente las versiones soportadas y los avisos de seguridad de Node/npm, y abrir cambios coordinados para ambos repositorios cuando corresponda. Actualizar los dos valores, regenerar el lockfile con el npm elegido y probar antes de publicar. En desarrollo, instalar esas mismas versiones mediante el gestor de Node habitual.

## Reversión

Revertir el commit de la actualización, incluidos manifiesto y lockfile, y ejecutar de nuevo las verificaciones. Si ya se publicó, volver a desplegar la revisión verificada. Si se revierte una corrección de seguridad, documentar el riesgo y preparar otra solución; no cerrar la alerta como resuelta sin corregirla.

## Referencias

- [Opciones de Dependabot](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [Activar las actualizaciones de seguridad](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates)

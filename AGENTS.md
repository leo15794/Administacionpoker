# Trabajo compartido: Claude Code y Codex

## Contexto del proyecto
- Aplicación de administración de póker.
- Frontend: React + TypeScript + Vite en `web/`.
- Backend: Express + TypeScript en `src/`; base PostgreSQL.
- El README documenta Vercel y Neon. Verificar la configuración del entorno antes de ejecutar comandos que accedan a datos.

## Coordinación
- Leer este archivo, `docs/COLABORACION.md` y la ficha de la tarea antes de trabajar.
- Seguir el objetivo y el reparto indicados por Leo para esa tarea. Propuesta inicial: ChatGPT/Codex diseña y revisa; Claude Code implementa. Los roles se pueden intercambiar.
- Trabajar en una rama por tarea. Mantener una sola persona o agente editando esa rama a la vez; el revisor propone hallazgos y el implementador corrige.
- Antes de editar, comprobar rama, último commit y cambios locales. Conservar trabajo ajeno; no sobrescribirlo, descartarlo ni hacer force-push para sincronizar.
- Compartir decisiones y entregables en el repositorio. Los historiales privados de chat y los archivos locales sin push no están compartidos.
- Al entregar, identificar rama, commit revisable, archivos cambiados, comprobaciones realizadas y pendientes.
- Si aparece un commit nuevo, actualizar el alcance de la revisión. No presentar como revisados cambios posteriores.
- La integración a main y el despliegue siguen las instrucciones de Leo para la tarea; una revisión no equivale por sí sola a autorización de publicación.

## Diseño e implementación
- Para cambios visuales, guardar una ficha basada en `docs/tareas/PLANTILLA.md` con referencia visual, alcance y criterios verificables.
- Precisar escritorio y móvil, estados de carga, vacío y error, acciones, textos y comportamiento de los componentes afectados.
- Implementar sobre componentes y estilos existentes cuando sea razonable. Diferenciar decisiones aprobadas de propuestas aún pendientes.
- La revisión visual requiere capturas o una vista previa de la implementación. Si solo se pudo leer código, declarar esa limitación.
- Usar datos ficticios en capturas y ejemplos compartidos.

## Comprobaciones
Elegir según los archivos y el comportamiento modificados; consultar los scripts actuales antes de ejecutar.
- Backend: `npm run build` desde la raíz.
- Motor de cierres: `npm run test:cierre` desde la raíz; inspeccionar antes los tests y sus imports para confirmar requisitos y efectos.
- Frontend: `npm --prefix web run build` y `npm --prefix web run lint`.
- Cambios visuales: verificar la pantalla afectada en escritorio y móvil y dejar evidencia.
- Cambios solo de documentación: revisar rutas, enlaces, consistencia y diff; no requieren ejecutar la aplicación.
- Registrar qué se ejecutó y su resultado. Si algo no se ejecutó, indicar el motivo; no afirmar que pasó.
- Los scripts de `src/scripts/` pueden consultar o modificar datos, incluso si su nombre contiene "test". Inspeccionar su contenido y entorno antes de ejecutarlos.

## Datos y reglas de negocio
- En tareas de diseño, preservar fórmulas, signos, monedas, permisos y contratos de API.
- Los cambios de lógica deben documentar la regla y verificar los casos afectados.
- No ejecutar migraciones, seeds, resets, correcciones de saldos ni scripts con efectos sobre datos como parte de una revisión visual o de documentación.
- Para una tarea que sí requiera modificar datos, verificar el entorno objetivo y la autorización existente de Leo antes de actuar.
- No incorporar credenciales, archivos .env ni datos operativos privados a entregas nuevas.

## Reparto de roles (acordado con Leo)
- Claude Code escribe el código (backend, lógica de cierres, saldos, compensaciones y también la implementación del frontend).
- ChatGPT/Codex diseña lo visual (referencia, comportamiento, estados) y revisa los cambios, sobre todo lo que toca plata.
- Los cambios chicos de interfaz (un texto, un color, un botón) los hace Claude Code directo, sin ficha ni diseño previo.
- La ficha de `docs/tareas/` es para trabajos medianos o grandes; no hace falta para arreglos chicos.

## Reglas de Leo para el trabajo diario
- Los commits quedan locales. Solo Leo hace `git push` y `npm run migrate`; nadie más pushea ni migra.
- Los scripts que escriben datos arrancan en modo simulación; solo Leo corre la versión con `--aplicar`.
- No escribir en la base de producción sin que Leo lo pida. Para probar usar transacciones con rollback o una API local de solo lectura.
- No subir a git los archivos sin versionar de Leo (`Manual_DigiPlayers.docx`, `mockups/`, `workers/`, scripts sueltos de `src/scripts/`).
- Cambios de interfaz: mostrar primero una captura o mockup (con datos reales o ficticios, según prefiera Leo) y esperar su OK antes de implementar.
- Antes de cada commit correr el typecheck: `npx tsc --noEmit -p .` en la raíz y `npx tsc -b` en `web/`.

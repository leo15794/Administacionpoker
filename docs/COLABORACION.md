# Colaboración entre Leo, Claude Code y ChatGPT/Codex

## Qué queda compartido
GitHub contiene el código, los diseños guardados, las fichas de tareas y las propuestas de cambios (pull requests o PR).
Claude Code trabaja en la PC de Leo. ChatGPT/Codex puede consultar el trabajo publicado en GitHub mediante su conexión.

Este procedimiento es manual: no instala bots, no invoca APIs y no configura revisiones automáticas. Cada participante se activa cuando Leo le pide trabajar. Los chats y las modificaciones locales sin push no se sincronizan.

## Primer uso de esta propuesta
1. Revisar la PR de configuración e incorporarla a main cuando corresponda.
2. En la PC, guardar el trabajo local pendiente antes de cambiar de rama o actualizar.
3. Con main seleccionada y el árbol de trabajo limpio, obtener los cambios con `git pull --ff-only` (o la operación equivalente en VS Code).
4. Pedir a Claude Code que lea `CLAUDE.md`, `AGENTS.md` y esta guía.

No hace falta ejecutar una migración para incorporar estos archivos de documentación.

## Un ciclo de trabajo
1. **Pedido:** Leo define la pantalla o función y quién diseña, implementa y revisa.
2. **Preparación:** crear una rama de tarea desde main actualizada y una ficha en `docs/tareas/`, copiando `PLANTILLA.md` con un nombre descriptivo.
3. **Diseño:** guardar la referencia o prototipo y detallar comportamiento y criterios de aceptación. Registrar qué decisiones están aprobadas.
4. **Implementación:** el implementador lee esa ficha, realiza los cambios y comprueba lo necesario para la tarea.
5. **Entrega:** actualizar la ficha, hacer commit y push y abrir una PR. Registrar capturas, pruebas realizadas, limitaciones y pendientes. El commit concreto se identifica en el mensaje de entrega o en la PR.
6. **Revisión:** Leo comparte la PR con el revisor. Este examina el diff del commit indicado, las pruebas y la evidencia visual. Registra cada problema con archivo, impacto y resultado esperado.
7. **Correcciones:** el implementador atiende la revisión y publica un nuevo commit. El revisor comprueba las correcciones sobre ese commit.
8. **Integración:** incorporar los cambios conforme a la indicación de Leo y actualizar las copias locales antes de la siguiente tarea.

Una PR sirve para revisar una rama antes de integrarla. Mantener un único implementador activo por rama evita que ambos editen los mismos archivos a la vez.

## Cómo pedir el siguiente paso
A Claude Code, después de actualizar la rama:
> Leé AGENTS.md y la ficha de esta tarea. Implementá el alcance acordado en la rama de trabajo. Actualizá la ficha con los cambios, las comprobaciones y lo que falte. Dejá el trabajo listo para revisión.

A ChatGPT/Codex, después del push:
> Revisá esta PR y su ficha de tarea. Indicá el commit revisado, los problemas concretos, las comprobaciones realizadas y cualquier limitación de la revisión visual.

Para una tarea visual, primero:
> Prepará el diseño de esta pantalla en una ficha compartida, con referencias, comportamiento y criterios de aceptación para que Claude Code pueda implementarlo.

## Evidencia de revisión
- Código: errores reproducibles, regresiones, permisos y reglas de negocio afectadas.
- Visual: contraste, jerarquía, legibilidad, tamaños, estados y adaptación móvil, comparados con la referencia elegida.
- Estado: pendiente, en implementación, listo para revisión, con correcciones o revisado.
- Una compilación correcta no demuestra por sí sola que una pantalla se vea bien ni que toda la lógica funcione.
- Una revisión sin acceso a la vista previa debe decirlo expresamente.

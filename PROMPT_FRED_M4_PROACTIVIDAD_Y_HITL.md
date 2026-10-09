# 🏛️ PROMPT DE INGENIERÍA: MILESTONE 4 — PROACTIVIDAD EJECUTIVA, HUMAN-IN-THE-LOOP INTERACTIVO & RAG DELIBERATIVO

> **Estándar:** DeKo Labs Enterprise — Robusto, Profesional, Escalable  
> **Destinatario:** Fred (Lead Software Engineer / Single Developer)  
> **Auditor & Diseñador:** Gary (Lead Enterprise Architect & CTO)  
> **Ticket / Alcance:** `[DEKO-CARMEN-M4]` Proactividad Ejecutiva, Protocolo HITL con Botones Inline en Telegram, y RAG Deliberativo On-Demand  
> **Fecha:** 9 de Octubre, 2026  

---

## 🎯 1. VISIÓN DEL HITO & OBJETIVOS ARQUITECTÓNICOS

El propósito de este hito es consolidar a **Carmencita 2.0** como una **Chief of Staff Ejecutiva de Alta Dirección**, dotándola de:
1. **Proactividad Programada de Alto Impacto:**
   - Desacoplar la lógica de briefings en un servicio especializado `src/services/executive-briefing.service.js`.
   - **Morning Briefing (07:30 AM Guatemala):** Triage de agenda del día, tareas críticas pendientes y correos urgentes con priorización inteligente y propuesta de acción.
   - **End-of-Day Wrap-Up (07:00 PM Guatemala):** Balance de compromisos completados, tareas a reprogramar y vista ejecutiva del día siguiente.
2. **Protocolo Human-in-the-Loop (HITL) Interactivo en Telegram:**
   - Las herramientas con impacto externo y mutación crítica (`CANCEL_CALENDAR_EVENT`, `CANCEL_TASK`, `DELETE_NOTE`, `SEND_EMAIL`) no deben ejecutarse a ciegas ni requerir confirmaciones textuales complejas.
   - El sistema genera un estado `STAGED_ACTION` en memoria con un token/ID único y expiración TTL (15 minutos).
   - Carmencita despacha a Telegram un mensaje con botones interactivos en línea:
     `[ ✅ Confirmar ]` | `[ ❌ Cancelar ]`
   - El usuario pulsa el botón; el callback de Telegram (`callback_query:data`) procesa la confirmación mediante `ToolDispatcher`, actualiza el mensaje para evitar dobles clics y reporta el resultado de inmediato.
3. **RAG 100% Deliberativo y Bajo Demanda:**
   - Erradicar la consulta automática e indiscriminada a pgvector en cada mensaje en `_resolveRAGContext`.
   - Mantener en el prompt únicamente las directivas cardinales activas de Sebastián (`getActiveDirectives`).
   - La búsqueda en la memoria semántica de largo plazo debe ser invocada **exclusivamente de forma deliberada** por el modelo a través de la herramienta nativa `search_knowledge_base`.
4. **Filtro Estricto de Saliencia de Memoria:**
   - En `_extractAndSaveMemoryBackground`, asegurar que únicamente se almacenen acuerdos, decisiones o preferencias con saliencia comprobada, ignorando charla casual.

---

## 📁 2. ARCHIVOS A INTERVENIR Y CREAR

1. **`src/services/executive-briefing.service.js` (Nuevo):**
   - Servicio centralizador de briefings matutino y vespertino.
   - Generación de contexto agregado (agenda de hoy/mañana, tareas prioritarias de Google Tasks/PostgreSQL, correos no leídos de Gmail).
   - Generación de síntesis ejecutiva mediante `ai.models.generateContent` (con fallback estructurado sin asteriscos en caso de degradación de red).
2. **`src/adapters/telegram.js`:**
   - Almacenamiento en memoria de acciones staged: `this.stagedActions = new Map()` (clave: `actionId`, valor: `{ toolName, args, description, createdAt, senderId }`).
   - Soporte para envío de mensajes con `InlineKeyboard` de grammy:
     ```javascript
     const keyboard = new InlineKeyboard()
       .text('✅ Confirmar', `hitl:confirm:${actionId}`)
       .text('❌ Cancelar', `hitl:cancel:${actionId}`);
     ```
   - Handler `this.bot.on('callback_query:data', async (ctx) => { ... })`:
     * Validar pertenencia del `senderId` (solo el usuario autorizado puede autorizar).
     * Responder inmediatamente con `await ctx.answerCallbackQuery()`.
     * Si es `hitl:confirm:${actionId}`: invocar la ejecución real a través de `this.brain.executeStagedAction(actionId)` y editar el mensaje original a `[✅ Confirmado y Ejecutado]`.
     * Si es `hitl:cancel:${actionId}`: remover del mapa y editar el mensaje original a `[❌ Operación Cancelada]`.
3. **`src/core/brain.js`:**
   - Métodos de soporte HITL:
     * `stageAction({ toolName, args, description, senderId })`: guarda en un registro staged y genera un identificador.
     * `executeStagedAction(actionId)`: invoca `this.agentRunner.toolDispatcher.dispatch(toolName, args, context)`.
   - En `_resolveRAGContext`:
     * Remover la llamada a `this.embeddingService.searchSimilarMemories(queryText, ...)` en el flujo de entrada general.
     * Conservar únicamente `this.embeddingService.getActiveDirectives({ limit: 10 })`.
   - Ajustar `_extractAndSaveMemoryBackground` para filtrar con saliencia mínima y descartar charla trivial.
4. **`src/services/scheduler.service.js`:**
   - Conectar `ExecutiveBriefingService` en las rutinas periódicas de 07:30 y 19:00, delegando la síntesis y formato.
5. **`scripts/audit-monoliths.js`:**
   - Registrar `src/services/executive-briefing.service.js: 350` en `DOMAIN_CEILINGS`.
   - Ajustar el techo de `src/adapters/telegram.js` si es necesario (ej: elevar a 650 para dar cabida a los handlers de callback_query sin violar el arnés).
6. **`test/hitl-briefing.test.js` (Nuevo):**
   - Suite hermética de pruebas unitarias que certifique:
     * Creación de staged action y expiración por TTL.
     * Confirmación exitosa disparando el dispatcher.
     * Cancelación exitosa descartando la acción staged.
     * Briefing matutino y vespertino formateados limpiamente con 0 asteriscos.

---

## 📤 4. DIRECTIVA OBLIGATORIA DE ENTREGA Y PUSH A GITHUB (CERO CÓDIGO ATRAPADO EN LOCAL)

Fred (o Agente Ejecutor):
1. **Verificación de Suite:** Asegúrate de que todas las pruebas pasen al 100% en local antes de cualquier commit:
   `node scripts/audit-monoliths.js && npm test`
2. **Stage de Cambios:** Agrega todos los archivos creados o modificados correspondientes a este ticket:
   `git add src/ scripts/audit-monoliths.js test/hitl-briefing.test.js PROMPT_FRED_M4_PROACTIVIDAD_Y_HITL.md`
3. **Commit Semántico:** Realiza el commit siguiendo el estándar de Conventional Commits:
   `git commit -m "feat(hitl): [DEKO-CARMEN-M4] briefings ejecutivos, confirmacion interactiva con botones en telegram y rag deliberativo"`
4. **Push Remoto Obligatorio:**
   `git push origin main`
5. **Comprobación:** Ejecuta `git status` para verificar que el árbol de trabajo quede limpio y el branch sincronizado con origin.

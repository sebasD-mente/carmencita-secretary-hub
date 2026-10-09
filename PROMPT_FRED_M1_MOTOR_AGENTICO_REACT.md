# 🎯 PROMPT DE INGENIERÍA PARA FRED: MILESTONE 1 (MOTOR AGÉNTICO REACT, NATIVE TOOL CALLING, CONTRATOS TIPADOS ZOD Y CIRCUIT BREAKERS)
**Ticket Oficial:** [DEKO-CARMEN-M1]  
**Estándar:** DeKo Labs Enterprise — Robusto, Profesional, Escalable  
**Autor:** Gary (Lead Enterprise Architect & Auditor Técnico)  
**Ejecutor:** Fred (Lead Software Engineer / Single Developer)  
**Product Owner:** Sebastián Jiménez  
**Fecha:** 9 de Octubre, 2026  

---

## 🏛️ 1. CONTEXTO Y MISIÓN TÉCNICA
Fred, tras el exitoso despliegue del Milestone 0 (Infraestructura, Zod en boot, Pool de Keys y blindaje de DB), entramos al corazón del sistema: El Motor Agéntico de Carmencita 2.0.

### La Deuda Técnica Crítica a Erradicar:
Actualmente, CarmencitaBrain operaba como un bot reactivo frágil:
1. **La Ilusión de la Agencialidad:** Se le pedía a Gemini en el prompt que redacte texto y al final anexe un bloque json `{ "action": "..." }`.
2. **Fragilidad Extrema por Regex:** El sistema intentaba capturar ese bloque con expresiones regulares y conteo de llaves `{ }`. Si el modelo cometía un error de sintaxis, truncaba el JSON o escapaba mal las comillas, la acción fallaba o el JSON crudo se fugaba a Telegram a la vista de Sebastián.
3. **Inferencia a Ciegas:** El modelo tenía que "adivinar" el resultado de la herramienta antes de que se ejecute, imposibilitando flujos encadenados multi-paso reales (ej: Buscar correo -> Leer cuerpo -> Agendar evento en Calendar).
4. **Ausencia de Timeouts:** Si la API de Google Workspace, Obsidian o la DB se colgaba, el proceso bloqueaba la sesión y congelaba el bot.

### La Misión del Milestone 1:
Erradicar de raíz el parseo por regex y el bloque JSON textual. Implementar Native Tool Calling oficial de `@google/genai` con un bucle de razonamiento autónomo ReAct (`AgentRunner`), validación coercitiva de argumentos con Zod en `ToolDispatcher`, contratos tipados unificados `{ success, data, error }`, Circuit Breakers con `AbortController` (8s por tool / 25s por turno global), temperatura bimodal y un harness hermético de pruebas con `MockGenAIClient`.

---

## 🛠️ 2. ESPECIFICACIONES TÉCNICAS EJECUTADAS

1. **Declaración Formal de Herramientas Tipadas (`src/tools/declarations.js`):**
   - Implementación exhaustiva con constructores de tipo oficiales de `@google/genai` (`Type.OBJECT`, `Type.STRING`, `Type.INTEGER`, `Type.BOOLEAN`, `Type.ARRAY`).
   - Declaraciones para `manage_calendar`, `search_gmail`, `manage_obsidian_notes`, `manage_tasks`, `manage_documents`, `search_knowledge_base`, `diagnose_system`, `generate_media`.

2. **Esquemas Coercitivos Zod por Herramienta (`src/tools/schemas/`):**
   - `calendar.schema.js`, `gmail.schema.js`, `obsidian.schema.js`, `tasks.schema.js`, `knowledge.schema.js`, `index.js`.
   - Función validadora `validateToolArgs(toolName, rawArgs)` tolerante a variaciones de tipo de LLMs.

3. **Despachador Tipado y Segregación de Herramientas (`src/tools/dispatcher.js`):**
   - Clase `ToolDispatcher` con validación Zod fail-fast (`INVALID_ARGUMENTS`).
   - Segregación estricta READ vs. MUTATE: acciones destructivas (`CANCEL_CALENDAR_EVENT`, `CANCEL_TASK`, etc.) entran en staging con `{ status: 'staged', requiresConfirmation: true }`.
   - Circuit Breaker con timeout duro de 8.000 ms por herramienta.
   - Contratos normalizados `{ success, data, error }`.

4. **Núcleo Agéntico Autónomo ReAct (`src/core/agent-runner.js`):**
   - Bucle multi-paso autónomo con Native Tool Calling.
   - Temperatura bimodal: `0.1` en razonamiento y herramientas, `0.6` en síntesis ejecutiva final.
   - Circuit Breaker global de 25 segundos con `AbortController`.
   - Ventana deslizante (Rolling Summary) de 8-10 turnos atómicos.

5. **Refactorización y Desacoplamiento de CarmencitaBrain (`src/core/brain.js` y `src/core/multimodal.js`):**
   - Delegación completa a `AgentRunner`.
   - Erradicación de parsing regex en la deliberación primaria.
   - Cumplimiento estricto del techo dinámico de 280 líneas en `brain.js`.

6. **Harness Hermético de Testing Determinista (`test/agent-runner.test.js`):**
   - Mock determinista sin consumo de red ni tokens.
   - Caso 1: Respuesta directa (0 tools).
   - Caso 2: Multi-paso encadenado de 3 niveles (`search_gmail` -> `manage_calendar` CREATE -> síntesis).
   - Caso 3: Auto-corrección Zod ante `INVALID_ARGUMENTS`.
   - Caso 4: Hard-Timeout de 8s ante servicio colgado y degradación elegante.
   - Caso 5: Staged Action para mutaciones destructivas.

7. **Arnés Mecánico y Techos Dinámicos (`scripts/audit-monoliths.js`):**
   - Techos registrados:
     - `src/core/brain.js`: 280 líneas.
     - `src/core/agent-runner.js`: 350 líneas.
     - `src/tools/declarations.js`: 280 líneas.
     - `src/tools/dispatcher.js`: 320 líneas.

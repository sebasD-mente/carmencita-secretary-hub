# 🏛️ PROMPT DE INGENIERÍA: HOTFIX — PRESERVACIÓN DE THOUGHT SIGNATURE EN AGENT RUNNER
> **Estándar:** DeKo Labs Enterprise — Robusto, Profesional, Escalable  
> **Destinatario:** Fred (Lead Software Engineer / Single Developer)  
> **Auditor & Diseñador:** Gary (Lead Enterprise Architect & CTO)  
> **Ticket / Alcance:** `[HOTFIX-CARMEN-THOUGHT-SIGNATURE]` Preservar `response.candidates[0].content` en el bucle multi-turno ReAct para evitar errores HTTP 400 de `thought_signature` en `@google/genai`  
> **Fecha:** 9 de Octubre, 2026  
---
## 🎯 1. CONTEXTO & DIAGNÓSTICO FORENSE DEL FALLO
En producción, al interactuar Sebastián por Telegram con un mensaje que dispara llamadas a herramientas (`manage_obsidian_notes`, `search_gmail`, etc.):
> *"Hola bebe, quiero que me hables sobre tus ultimas actualizaciones, como te sientes y que cambio ahora"*
El modelo (`gemini-3.8-flash`) generó un `functionCall` en el Turno 1. Sin embargo, al iniciar el Turno 2, la API de Google rechazó la petición con el siguiente error fatal:
```text
ApiError: 400 Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly, and missing thought_signature may lead to degraded model performance. Additional data, function call `default_api:manage_obsidian_notes`, position 2.
```
### Causa Raíz
En el SDK oficial `@google/genai` con modelos de la familia Gemini con capacidades de razonamiento ("thinking"), cada llamada a función devuelta por la API en `response.candidates[0].content.parts` contiene un atributo criptográfico mandatorio: `thoughtSignature`.
En `src/core/agent-runner.js` (líneas 156–168), el código actual reconstruye manualmente el objeto de turno del modelo:
```javascript
// CÓDIGO ACTUAL DEFECTUOSO:
const modelParts = [];
if (response.text) {
  modelParts.push({ text: response.text });
}
for (const call of functionCalls) {
  modelParts.push({
    functionCall: {
      name: call.name,
      args: call.args,
    },
  });
}
contents.push({ role: 'model', parts: modelParts });
```
Al hacer esto, **se descarta el objeto original y se pierde el `thoughtSignature`**. Al enviar el Turno 2 a Google, la API detecta un `functionCall` sin firma en el historial y aborta con HTTP 400.
---
## 🛠️ 2. ESPECIFICACIÓN DE LA SOLUCIÓN REQUERIDA
### Archivo a Modificar: `src/core/agent-runner.js`
En el método `run()` de `AgentRunner`, dentro de la condición `if (functionCalls.length > 0)`:
Reemplazar la reconstrucción manual por la **preservación directa de `response.candidates[0].content`**, manteniendo un fallback hacia el objeto manual en caso de que `candidates` no esté presente (para preservar compatibilidad con mocks de testing que no devuelven candidatos completos):
```javascript
        if (functionCalls.length > 0) {
          // 1. Agregar turno del modelo con llamadas de herramientas a contents
          // En @google/genai con modelos thinking (gemini-3.8-flash), response.candidates[0].content
          // contiene el thoughtSignature mandatorio. Preservar el objeto original intacto.
          if (response?.candidates?.[0]?.content) {
            contents.push(response.candidates[0].content);
          } else {
            const modelParts = [];
            if (response.text) {
              modelParts.push({ text: response.text });
            }
            for (const call of functionCalls) {
              modelParts.push({
                functionCall: {
                  name: call.name,
                  args: call.args,
                },
              });
            }
            contents.push({ role: 'model', parts: modelParts });
          }
          // 2. Ejecutar cada herramienta mediante ToolDispatcher...
```
---
## 🧪 3. VERIFICACIÓN Y SUITE DE PRUEBAS
1. Ejecutar las pruebas unitarias y de arnés en local:
   ```bash
   node scripts/audit-monoliths.js
   node test/agent-runner.test.js
   node test/obsidian-modular.test.js
   npm test
   ```
2. Asegurarse de que `test/agent-runner.test.js` continúe pasando al 100%.
---
## 📤 4. DIRECTIVA OBLIGATORIA DE ENTREGA Y PUSH A GITHUB (CERO CÓDIGO ATRAPADO EN LOCAL)
Fred:
1. **Verificación de Suite:** Asegúrate de que las pruebas pasen al 100% en local antes de cualquier commit.
2. **Stage de Cambios:** Agrega los archivos modificados:
   `git add src/core/agent-runner.js PROMPT_FRED_HOTFIX_THOUGHT_SIGNATURE.md`
3. **Commit Semántico:** Realiza el commit siguiendo el estándar de Conventional Commits:
   `git commit -m "fix(agent-runner): preservar response.candidates[0].content y thoughtSignature en bucle react"`
4. **Push Remoto Obligatorio:**
   `git push origin main`
5. **Comprobación:** Ejecuta `git status` para verificar que el árbol de trabajo quede limpio y el branch sincronizado con origin.
> ⚠️ **REGLA DE ORO:** La tarea NO se considera terminada ni auditable hasta que el commit esté reflejado en el repositorio remoto de GitHub. Queda terminantemente prohibido dejar cambios únicamente en local.

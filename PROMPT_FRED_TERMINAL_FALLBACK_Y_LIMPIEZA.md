# 🏛️ PROMPT QUIRÚRGICO DE REPARACIÓN FORENSE PARA FRED

> **Destinatario:** Fred (Desarrollador / Agente Ejecutor)  
> **Arquitecto & Auditor:** Gary (CTO, Deko Labs)  
> **Líder de Producto:** Sebastián Jiménez  
> **Proyecto:** `carmencita-secretary-hub` (`C:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
> **Modo de Ejecución:** **SOLO (Single Developer)**  

---

## 🎯 MOTIVACIÓN Y HALLAZGOS FORENSES (POST-DEPLOY EN PRODUCCIÓN)

Durante la primera interacción real en vivo con `@CarmenFlores_bot` en Telegram desde el VPS Hostinger, se detectaron dos defectos funcionales que debemos corregir quirúrgicamente:

### 1. Hallazgo Forense 1: Fuga visual de delimitadores Markdown (` ```json \n ``` `)
* **Síntoma:** En Telegram, el mensaje inicial de Carmencita muestra residuos de sintaxis:
  ```
  ```json
  ```
* **Causa Raíz en `src/core/brain.js`:**
  Actualmente se hace:
  ```javascript
  const jsonMatch = rawText.match(/\{[\s\S]*"action"[\s\S]*\}/);
  cleanText = rawText.replace(jsonMatch[0], '').trim();
  ```
  Gemini formatea su respuesta envolviendo el bloque JSON en triples acentos graves:
  ````markdown
  ```json
  { "action": "RUN_AGY_TASK", ... }
  ```
  ````
  Al reemplazar solo `jsonMatch[0]` (las llaves `{...}`), los delimitadores ```` ```json ```` y ```` ``` ```` quedan flotando en el texto limpio enviado a Telegram.
* **Solución Quirúrgica:**
  En `src/core/brain.js`:
  1. Detectar y eliminar el bloque completo con sus delimitadores de código markdown si existen:
     ```javascript
     // Eliminar bloque markdown que envuelva al json de acción
     cleanText = rawText
       .replace(/```(?:json)?\s*\{[\s\S]*?"action"[\s\S]*?\}\s*```/gi, '')
       .replace(/\{[\s\S]*?"action"[\s\S]*?\}/gi, '')
       .trim();
     ```
  2. Adicionalmente, aplicar una limpieza final para erradicar cualquier bloque de código vacío residual (`/```(?:json)?\s*```/gi`).

---

### 2. Hallazgo Forense 2: Error `spawn agy ENOENT` por Carencia de Fallback Nativo
* **Síntoma:** Cuando Sebastián preguntó en qué servidor corre, Carmencita disparó `RUN_AGY_TASK` para consultar los parámetros del sistema, arrojando el error:
  `Error al ejecutar la tarea en la terminal con AGY: spawn agy ENOENT`
* **Causa Raíz en `src/core/agy-bridge.js`:**
  El puente asume rígidamente que el binario `agy` existe en el sistema. En el VPS Hostinger (headless Ubuntu) el ejecutable `agy` no está instalado en el PATH del host.
* **Solución Arquitectónica:**
  Dotar a `AgyBridge` (`src/core/agy-bridge.js`) de un **Modo Híbrido Resiliente**:
  1. **Detección Previa de Disponibilidad:**
     - Comprobar si `this.binPath` existe y es ejecutable en el sistema (ej. ejecutando un check rápido o capturando el código de error `ENOENT`).
  2. **Fallback a Shell Nativo / Diagnóstico del Sistema:**
     - Si `agy` no está presente (`ENOENT`), NO fallar estrepitosamente. En su lugar:
       - Si la instrucción o prompt solicita consultar estado del servidor, hostname, docker, disco, memoria o procesos:
         - Ejecutar los comandos nativos seguros correspondientes (`hostname`, `uname -a`, `uptime -p`, `free -h`, `df -h /`, `docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"`) o utilizar el módulo nativo `node:os` para devolver un reporte ejecutivo impecable del VPS:
           - Hostname: `srv1916842`
           - SO: Ubuntu Linux
           - Memoria libre y total
           - Uptime
           - Contenedores Docker activos (Dokploy, carmencita-db, deco-db, etc.)
       - Si es un comando arbitrario de bash seguro, permitir su ejecución controlada mediante `child_process.exec` en el host (Linux VPS).
       - Indicar claramente en el reporte si la ejecución fue vía Shell Nativo VPS o AGY.

---

## 🛡️ RESTRICCIONES & TECHOS DINÁMICOS
* **`src/core/brain.js`:** Mantener por debajo del techo dinámico de cohesión.
* **`src/core/agy-bridge.js`:** Implementación concisa y robusta, $\le 120$ líneas.
* **Pruebas unitarias:** Mantener y actualizar `test/hub.test.js` para validar que si `agy` emite `ENOENT`, el fallback devuelva la información del sistema sin romper la ejecución, y que `cleanText` quede 100% libre de delimitadores ```` ```json ````.

## ✅ CRITERIOS DE ACEPTACIÓN
1. `npm test` corre al 100% en verde.
2. Los textos que contengan bloques de acción JSON no dejan marcas markdown vacías en el chat.
3. Consultar sobre el servidor o terminal responde con la información real del host VPS aunque `agy` no esté instalado.

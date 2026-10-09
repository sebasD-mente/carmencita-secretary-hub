# 🔬 Auditoría de Código, Cirugía de Software y Rediseño de Motor Agéntico: Carmencita Secretary Hub

**Autor:** Fred (Lead Software Engineer & Cirujano de Código, DeKo Labs)  
**Destinatarios:** Sebastián Jiménez (Fundador & Product Owner), Gary (CTO & Chief DevOps), Randy (Head of Product & Systems Architect)  
**Fecha:** 9 de Octubre, 2026  
**Alcance Técnico:** Repositorio `carmencita-secretary-hub` (`C:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
**Estándar de Calidad:** DeKo Labs Enterprise (Robusto, Profesional, Escalable — Cero Atajos, Bases Sólidas)

---

## 🧭 1. Dictamen del Lead Software Engineer: Diagnóstico Quirúrgico

Sebastián, como Lead Software Engineer he auditado línea por línea la base de código de Carmencita (`src/core/brain.js`, `src/core/carmencita.prompt.js`, `src/tools/`, `src/services/`, `src/adapters/telegram.js`, `src/config.js`, scripts y la suite de pruebas).

Mi veredicto técnico es inequívoco: **Carmencita se siente "bruta" porque su motor no está programado como un agente de software, sino como un generador de texto cosmético que intenta accionar herramientas mediante trampas de strings, expresiones regulares y llamadas secuenciales ciegas.**

En lugar de aprovechar el protocolo nativo de **Function Calling** de `@google/genai` con contratos tipados, el código fuerza a Gemini a redactar un texto y concatenar un JSON al final. Luego, el código ejecuta complejas cirugías de regex para extraerlo, adivinar intenciones no declaradas y llamar a una segunda inferencia para que el modelo "explique" lo que la herramienta acaba de hacer.

El resultado es un sistema cognitivamente exhausto, lento, propenso a alucinaciones de formato y con una deuda técnica que dificulta cualquier expansión lógica.

A continuación presento la radiografía técnica detallada, el análisis forense de los archivos críticos y la propuesta de refactorización limpia (clean-room).

---

## 🔬 2. Radiografía Línea por Línea de la Base de Código Actual

### 🔴 2.1 `src/core/brain.js`: El Antipatrón del Pseudo-Tool Calling y Aplanamiento de Contexto

#### A. Aplanamiento Forzado de Contexto a un String Plano (Líneas 161–164)
```javascript
// CÓDIGO ACTUAL:
const { recentMessages, pendingTasks } = await this._getRecentContext(channel, senderId);
const contextPrompt = `
CONTEXTO TEMPORAL DEL SISTEMA:
...
Interacciones recientes:
${recentMessages.map((m) => `[${m.channel}] ${m.role === 'user' ? senderName : 'Carmencita'}: ${m.content}`).join('\n')}${directivesBlock}${memoriesBlock}

Mensaje de Sebastián:
"${text}"
`;

const response = await this._generateContentWithFailover({
  contents: [contextPrompt],
  config: { systemInstruction: this.getSystemPrompt() }
});
```
* **Diagnóstico de Código:** Todo el historial de conversación (hasta 12 mensajes previos) se aplana dentro de un **único turno de usuario** (`contents: [contextPrompt]`).
* **Impacto Técnico:** La API de Gemini (`generateContent`) está optimizada para recibir un array de turnos conversacionales estructurados (`{ role: 'user', parts: [...] }` y `{ role: 'model', parts: [...] }`). Al colapsar el diálogo en una sola cadena de texto, el modelo pierde la noción nativa de interlocutor, confunde quién emitió una directiva y degrada su atención semántica.

#### B. Adivinanza Previa de Respuestas sin Datos de Herramientas (Líneas 165–166, 314–328)
```javascript
// CÓDIGO ACTUAL:
const replyText = response.text || 'Entendido, Sebastián.';
const actionResult = await this._executeExtractedActions(replyText, onProgress, { ... });
```
* **Diagnóstico de Código:** El modelo redacta `replyText` antes de que la acción (`executeAction`) sea ejecutada. Si la acción falla o devuelve datos inesperados, la respuesta original ya fue redactada a ciegas.
* **Impacto Técnico:** Carmencita debe "adivinar" el resultado de la acción en su primer turno o depender de un segundo prompt de síntesis (`_synthesizeToolResults`), duplicando la latencia y la tasa de error.

#### C. Fuga de Tareas en Segundo Plano sin Control de Ciclo de Vida (Líneas 178–180)
```javascript
// CÓDIGO ACTUAL:
if (this.embeddingService && !actionResult.hasMemory) {
  this._lastMemoryTask = this._extractAndSaveMemoryBackground({ userText: text, historyContent }).catch(...);
}
```
* **Diagnóstico de Código:** La promesa se asigna a una propiedad flotante `_lastMemoryTask` sin esperar su resolución ni gestionar un shutdown controlado.
* **Impacto Técnico:** Si el contenedor o proceso se reinicia o recibe una nueva solicitud inmediatamente, la tarea queda huérfana, pudiendo colisionar transacciones o fallar silenciosamente en segundo plano.

---

### 🔴 2.2 `src/core/carmencita.prompt.js`: Asfixia Cognitiva y Micromanagement de Formato

#### A. 205 Líneas de Prompt Saturadas de Restricciones Negativas
```javascript
// EVIDENCIA EN EL PROMPT ACTUAL:
- PROHIBIDO repetir "Sebastián querido"...
- Tienes TERMINANTEMENTE PROHIBIDO mandar bloques densos de texto pegado...
- CERO ASTERISCOS DE MARKDOWN... Prohibido usar **negritas con asteriscos**...
- CERO GUIONES SUELTOS O REGLAS DE CONSOLA...
- Tienes TERMINANTEMENTE PROHIBIDO enviar etiquetas <pre>, volcados crudos de bash...
- PROHIBIDO emitir cadenas vacías "" en "due"...
- Carmencita NUNCA debe emitir RUN_AGY_TASK para completar, buscar o cancelar tareas...
- PROHIBIDO terminantemente emitir RUN_AGY_TASK para consultar, listar o buscar notas en Obsidian...
```
* **Diagnóstico de Código:** Más de 40 directivas negativas ("PROHIBIDO", "NUNCA", "CERO") consumen la ventana de atención y los tokens de instrucción del LLM.
* **Impacto Técnico:** En modelos fundacionales como Gemini 3.8 Flash, un prompt saturado de prohibiciones estresan los pesos de atención del Transformer. El modelo dedica su capacidad computacional a "no equivocarse en el formato HTML" en vez de comprender la lógica profunda de lo que Sebastián requiere.

#### B. Acoplamiento entre Lógica de Presentación y Prompt de Sistema
* Las reglas sobre cómo renderizar viñetas (`•`), negritas (`<b>`), saltos de línea dobles (`\n\n`) y emojis deben pertenecer a una **capa de presentación en código JavaScript**, no al prompt del modelo.

---

### 🔴 2.3 `src/tools/index.js` y `workspace.tools.js`: Heurísticas Frágiles y Falso Multi-Paso

#### A. Extracción Artesanal de JSON mediante Regex (Líneas 40–68 de `src/tools/index.js`)
```javascript
// CÓDIGO ACTUAL:
export function extractActionJson(rawText) {
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?\{[\s\S]*?"action"[\s\S]*?\})\s*```/i);
  ...
  const actionIndex = rawText.indexOf('"action"');
  if (actionIndex !== -1) {
    const openBrace = rawText.lastIndexOf('{', actionIndex);
    ...
  }
}
```
* **Diagnóstico de Código:** Se recorre el texto caracter por caracter con conteo de llaves (`{` y `}`) para capturar objetos JSON incrustados en la prosa.
* **Impacto Técnico:** Falla ante caracteres de escape mal formateados, texto intermedio, o cuando el LLM genera explicaciones previas al bloque. Si el JSON queda truncado por límites de tokens, la herramienta se pierde completamente.

#### B. Falso "Chaining" Multi-Paso con Profundidad 1 (`src/tools/index.js`, Líneas 149–180)
```javascript
// CÓDIGO ACTUAL:
if (context._isChained) {
  if (result && typeof result.reply === 'string') result.reply = sanitizeReplyText(result.reply);
  return result;
}

if (result && typeof result.reply === 'string') {
  const secondary = extractActionJson(result.reply);
  if (secondary?.parsed) {
    ...
    const secondaryResult = await executeAction(secondaryAction, deps, { ...context, _isChained: true });
  }
}
```
* **Diagnóstico de Código:** Se diseñó un parche para encadenar máximo 2 acciones inspeccionando si la respuesta sintetizada de la primera contenía otro JSON.
* **Impacto Técnico:** Es una simulación precaria de un bucle agéntico. Si una solicitud demanda 3 pasos (ej: buscar correo $\rightarrow$ leer detalle $\rightarrow$ agendar cita en Calendar), el tercer paso es imposible de ejecutar.

#### C. Infiltración de Expresiones Regulares en Herramientas (`src/tools/workspace.tools.js`, Líneas 141–147)
```javascript
// CÓDIGO ACTUAL EN HANDLE CHECK_GMAIL:
const isExplicitSingle = Boolean(
  parsedAction.readSingle === true || parsedAction.maxResults === 1 ||
  /(?:leer|escuchar|abrir|detalle(?:\s+del)?|resumen(?:\s+en\s+audio)?\s+del?)\s+(?:el|este|un|ese)\s+(?:correo|email|mensaje)/i.test(userText) ||
  /del\s+correo\s+de\b/i.test(userText) || /\b(?:el|este)\s+correo\s+(?:de|con|sobre)\b/i.test(userText)
);

const eventTermsRegex = /\b(?:evento|fechas?|entradas?|tickets?|confirmaci[oó]n|cu[aá]ndo|devfest|agendas?|citas?|calendarios?)\b/i;
const isEventQuery = eventTermsRegex.test(`${userText} ${parsedAction.query || ''}`);
```
* **Diagnóstico de Código:** La herramienta `CHECK_GMAIL` analiza el texto original de Sebastián mediante expresiones regulares para decidir si debe inspeccionar el cuerpo de un correo o no.
* **Impacto Técnico:** Violación flagrante del principio de responsabilidad única. La herramienta de software debe limitarse a ejecutar una acción atómica con parámetros tipados; el discernimiento de si se requiere leer un correo o varios debe ser una decisión del modelo a través de parámetros formales de Function Calling (`readSingleMessage: true`, `messageId: "..."`).

#### D. Sanitizador de 5 Pasadas de Regex (`sanitizeReplyText`, Líneas 74–105)
```javascript
// CÓDIGO ACTUAL:
export function sanitizeReplyText(rawText) {
  // 1. Limpieza de bloques json
  // 2. Limpieza de llaves residuales
  // 3. Encabezados markdown a HTML <b>
  // 4. Guiones a viñetas •
  // 5. Asteriscos ** a <b>
  // 6. Colapsar saltos
}
```
* **Diagnóstico de Código:** La sanitización se hace mediante reemplazos sucesivos sobre strings crudos. Si el usuario envía código que contiene asteriscos o viñetas reales, el sanitizador los altera de forma destructiva.

#### E. Parche de Voz con Regex en `VoiceService` (`src/services/voice.service.js`, Líneas 16–32)
```javascript
_cleanTextForSpeech(rawText) {
  return rawText
    .replace(/```(?:json)?[\s\S]*?```/gi, '')
    .replace(/\{"action"[\s\S]*?\}/gi, '')
    .replace(/<[^>]+>/g, '')
    ...
}
```
* **Diagnóstico de Código:** Como el texto generado mezcla JSON y prosa, el servicio de voz tiene que aplicar regex para evitar que Carmencita "lea en voz alta las llaves y comillas del JSON". Con Function Calling nativo, los argumentos de herramientas viajan por un canal estructurado independiente y el texto hablado permanece 100% limpio por definición.

---

### 🔴 2.4 `src/adapters/telegram.js`: Concurrencia Vulnerable y Temporizadores Desacoplados

#### A. Cero Control de Concurrencia por Usuario (Condiciones de Carrera)
* Cuando Sebastián envía dos mensajes en ráfaga (por ejemplo, un audio seguido de una aclaración de texto), `this.bot.on('message:text')` y `this.bot.on('message:voice')` se ejecutan concurrentemente en Node.js sin una cola o lock por usuario.
* Ambas promesas leen el historial de PostgreSQL al mismo tiempo, ejecutan inferencias paralelas desincronizadas y colisionan al escribir respuestas o mutar el estado de la base de datos.

#### B. Intervalos de "Typing" Suceptibles a Desfase (Líneas 262–265, 321–323)
```javascript
const typingInterval = setInterval(() => {
  ctx.replyWithChatAction('typing').catch(() => {});
}, 4000);
...
finally {
  clearInterval(typingInterval);
}
```
* Aunque está envuelto en `finally`, el manejo no está encapsulado en un contexto seguro reutilizable y puede silenciar rechazos no controlados en flujos asíncronos desacoplados.

---

### 🔴 2.5 `src/services/embedding.service.js`: RAG Ciego y Consulta SQL Vulnerable

#### A. Vulnerabilidad DevSecOps en Consulta `$queryRawUnsafe` (Líneas 124–136)
```javascript
const categoryClause = category ? `AND category = '${category.replace(/'/g, "''")}'` : '';
const excludeCategoryClause = excludeCategory ? `AND category != '${excludeCategory.replace(/'/g, "''")}'` : '';

const memories = await this.prisma.$queryRawUnsafe(
  `SELECT id, category, content, metadata, "createdAt",
          1 - (embedding <=> $1::vector) as similarity
   FROM "SemanticMemory"
   WHERE embedding IS NOT NULL
   ${categoryClause}
   ${excludeCategoryClause}
   AND (1 - (embedding <=> $1::vector)) >= $2
   ORDER BY embedding <=> $1::vector ASC
   LIMIT $3`,
  vectorStr,
  minSimilarity,
  limit
);
```
* **Diagnóstico de Código:** Inyección de cadenas construidas a mano (`categoryClause`) dentro de `$queryRawUnsafe`.
* **Solución de Código:** Utilizar consultas SQL parametrizadas limpias con `Prisma.sql` y `$queryRaw`, o vinculación formal de argumentos.

#### B. RAG Ciego en Cada Interacción
* En `src/core/brain.js` (Líneas 160 y 277), todo mensaje entrante (`text`) se envía directamente a `generateEmbedding(text)`.
* Si Sebastián dice *"Hola Carmencita, buenos días"*, se ejecuta una búsqueda vectorial en la base de datos buscando notas similares a un saludo social, inyectando directivas irrelevantes en el contexto.

---

### 🔴 2.6 `src/services/obsidian-drive.service.js`: Monolito de 906 Líneas

* El archivo actual cuenta con **906 líneas**, rozando el límite de 950 configurado en `audit-monoliths.js`.
* Acopla en una sola clase:
  1. Autenticación y llamadas REST con Google Drive API v3.
  2. Indexación y chunking de Markdown.
  3. Búsqueda vectorial y cálculo de similitudes.
  4. Coincidencia difusa de títulos de notas.
  5. Sincronización masiva de vaults.
* Requiere ser refactorizado en submódulos de alta cohesión (ej. cliente de transporte de Drive vs. servicio de procesamiento de notas) cuando se acometa la fase de desacoplamiento.

---

## 🏛️ 3. Plan Quirúrgico de Refactorización (Arquitectura de Código)

Para convertir a Carmencita en un agente de élite sin romper la suite de pruebas existente (59 tests pasando al 100%), la hoja de ruta de ingeniería se estructura en 4 fases clean-room:

```
[ Mensaje Telegram ] 
        │
        ▼
[ UserSessionQueue ]  <── Serializa peticiones por usuario (cero race conditions)
        │
        ▼
[ AgentRunner (ReAct Loop) ]
        │
        ├─► Turno 1: Gemini 3.8 Flash + Native Function Declarations
        │            │
        │            ├─► Si emite `functionCall`:
        │            │     1. Ejecuta Tool correspondiente
        │            │     2. Devuelve `functionResponse` al hilo
        │            │
        ├─► Turno 2..N: Gemini analiza el resultado y decide:
        │            ├─► ¿Requiere otra tool? (bucle continúa)
        │            └─► ¿Respuesta completa? (genera texto final)
        │
        ▼
[ Presentation & Formatter Middleware ]  <── Inyecta HTML limpio, viñetas y aire visual
        │
        ▼
[ Output Dispatcher (Telegram / Voz OGG) ]
```

---

## 💻 4. Especificación Técnica de Implementación

### 📦 4.1 Definición de Herramientas Nativas con `@google/genai`
En lugar de describir JSON en el prompt, las herramientas se registran formalmente con tipos de datos de Gemini:

```javascript
import { Type } from '@google/genai';

export const CARMENCITA_TOOL_DECLARATIONS = [
  {
    name: 'search_gmail',
    description: 'Busca correos electrónicos en la bandeja de entrada de Gmail.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Términos de búsqueda, remitente o asunto' },
        maxResults: { type: Type.INTEGER, description: 'Cantidad máxima de correos a recuperar (default 5)' },
        readSingle: { type: Type.BOOLEAN, description: 'True para leer el cuerpo completo del correo más relevante' }
      },
      required: []
    }
  },
  {
    name: 'manage_calendar',
    description: 'Crea, consulta, reprograma o cancela eventos en Google Calendar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: { 
          type: Type.STRING, 
          enum: ['CREATE', 'LIST', 'RESCHEDULE', 'CANCEL'], 
          description: 'Operación a realizar' 
        },
        summary: { type: Type.STRING, description: 'Título del evento' },
        startDateTime: { type: Type.STRING, description: 'Fecha y hora inicio ISO 8601' },
        endDateTime: { type: Type.STRING, description: 'Fecha y hora fin ISO 8601' },
        range: { type: Type.STRING, enum: ['TODAY', 'TOMORROW', 'THIS_WEEK', 'THIS_MONTH', 'UPCOMING'] },
        eventId: { type: Type.STRING, description: 'ID del evento si aplica' },
        query: { type: Type.STRING, description: 'Nombre o criterio de búsqueda del evento' }
      },
      required: ['operation']
    }
  },
  {
    name: 'manage_obsidian_notes',
    description: 'Busca, lee, crea, actualiza o anexa notas en el Obsidian Vault de Google Drive.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: { 
          type: Type.STRING, 
          enum: ['SEARCH', 'READ', 'CREATE', 'UPDATE', 'APPEND', 'SYNC'], 
          description: 'Operación en el Segundo Cerebro' 
        },
        title: { type: Type.STRING, description: 'Título de la nota' },
        content: { type: Type.STRING, description: 'Contenido Markdown de la nota' },
        folder: { type: Type.STRING, description: 'Carpeta destino (01_Inbox, 02_Projects, 03_Areas, 00_Meta)' },
        query: { type: Type.STRING, description: 'Término de búsqueda semántica o textual' }
      },
      required: ['operation']
    }
  },
  {
    name: 'manage_tasks',
    description: 'Crea, consulta, completa o cancela tareas en PostgreSQL.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        operation: { type: Type.STRING, enum: ['CREATE', 'LIST', 'COMPLETE', 'CANCEL'] },
        description: { type: Type.STRING, description: 'Descripción de la tarea' },
        due: { type: Type.STRING, description: 'Fecha límite ISO 8601' },
        priority: { type: Type.STRING, enum: ['ALTA', 'MEDIA', 'BAJA'] },
        query: { type: Type.STRING, description: 'Identificador o texto para buscar la tarea' }
      },
      required: ['operation']
    }
  },
  {
    name: 'diagnose_system',
    description: 'Ejecuta telemetría y diagnóstico de salud del servidor y servicios.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scope: { type: Type.STRING, enum: ['full', 'errors', 'services', 'pm2'] }
      },
      required: []
    }
  }
];
```

---

### 🔄 4.2 El Bucle Agéntico ReAct (`AgentRunner`)
El nuevo núcleo de ejecución resuelve el multi-paso de forma limpia y transparente:

```javascript
export class AgentRunner {
  constructor({ ai, model, systemInstruction, tools, toolDispatcher, maxTurns = 5 }) {
    this.ai = ai;
    this.model = model;
    this.systemInstruction = systemInstruction;
    this.tools = tools;
    this.toolDispatcher = toolDispatcher;
    this.maxTurns = maxTurns;
  }

  async run({ contents, onProgress = null }) {
    let currentTurns = [...contents];
    let turnCount = 0;
    let finalArtifacts = {};

    while (turnCount < this.maxTurns) {
      turnCount++;

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: currentTurns,
        config: {
          systemInstruction: this.systemInstruction,
          tools: [{ functionDeclarations: this.tools }],
        },
      });

      const functionCalls = response.functionCalls || [];
      
      // Si el modelo no llamó a ninguna función, ha llegado a su respuesta final
      if (functionCalls.length === 0) {
        return {
          reply: response.text || '',
          turns: currentTurns,
          artifacts: finalArtifacts,
        };
      }

      // Procesar cada llamada de función
      for (const call of functionCalls) {
        if (onProgress) {
          await onProgress(`⚙️ Ejecutando: ${call.name}...`);
        }

        const execution = await this.toolDispatcher.execute(call.name, call.args);
        if (execution.artifact) {
          Object.assign(finalArtifacts, execution.artifact);
        }

        // Agregar la respuesta de la función al historial de turnos
        currentTurns.push({
          role: 'model',
          parts: [{ functionCall: call }],
        });

        currentTurns.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: call.name,
              response: { result: execution.data },
            },
          }],
        });
      }
    }

    throw new Error(`Se excedió el límite máximo de turnos agénticos (${this.maxTurns})`);
  }
}
```

---

### 🛡️ 4.3 Serializador de Mensajes por Usuario (`UserSessionQueue`)
Para evitar condiciones de carrera en Telegram:

```javascript
export class UserSessionQueue {
  constructor() {
    this._queues = new Map();
  }

  async enqueue(userId, taskFn) {
    const key = String(userId);
    const currentPromise = this._queues.get(key) || Promise.resolve();

    const nextPromise = currentPromise
      .then(() => taskFn())
      .catch((err) => {
        console.error(`[SessionQueue Error - User ${key}]`, err);
        throw err;
      })
      .finally(() => {
        if (this._queues.get(key) === nextPromise) {
          this._queues.delete(key);
        }
      });

    this._queues.set(key, nextPromise);
    return nextPromise;
  }
}
```

---

## 🧪 5. Validación, Arnés y Compatibilidad

1. **Estado Actual:**
   - La suite de pruebas actual (`npm test`) cuenta con **59 tests de integración y seguridad, 100% en verde**.
   - El script `audit-monoliths.js` valida el cumplimiento de techos dinámicos.
2. **Estrategia de Transición Segura:**
   - Para no romper la compatibilidad regresiva con los 59 tests actuales mientras se migra a Native Function Calling, se mantendrá un adaptador de fachada en `parseCarmencitaAction` y `executeAction`.
   - Se construirán nuevos tests unitarios para `AgentRunner` y `UserSessionQueue` en `test/agent-runner.test.js`.
3. **Cero Caídas en Producción:**
   - La migración del runner se ejecutará localmente en la máquina de desarrollo de Fred, pasando el arnés completo (`npm test` y `npm run harness:check`) antes de entregar la rama a Gary para auditoría y despliegue.

---

## 🎯 6. Conclusión y Próximos Pasos

La aparente falta de inteligencia de Carmencita era en realidad un problema de **asfixia arquitectónica de código**:
* Un LLM no puede razonar con fluidez si se le obliga a actuar como formateador de texto y serializador de JSON en un solo turno.
* Con **Native Function Calling**, un **ReAct Loop real**, **historial multi-turno auténtico** y **control de concurrencia**, Carmencita tendrá la capacidad cognitiva de encadenar tareas complejas de forma instantánea, fluida y natural.

Quedo a la orden de Gary para recibir los prompts atómicos de implementación y comenzar la cirugía en código.

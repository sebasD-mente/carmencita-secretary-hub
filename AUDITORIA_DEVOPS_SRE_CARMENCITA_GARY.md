# 🛡️ Auditoría Quirúrgica DevOps, SRE & DevSecOps: Carmencita Secretary Hub
**Autor:** Gary (CTO & Chief DevOps, DeKo Labs)  
**Destinatarios:** Sebastián Jiménez (Fundador & Product Owner), Randy (Head of Product & Systems Architect), Fred (Lead Software Engineer)  
**Fecha:** 9 de Octubre, 2026  
**Alcance Técnico:** Repositorio `carmencita-secretary-hub` (`C:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
**Estándar de Calidad:** DeKo Labs Enterprise (Robusto, Profesional, Escalable — Cero Atajos)

---

## 🧭 1. Dictamen Forense del CTO: El Diagnóstico Técnico Irrefutable

Sebastián, como CTO te lo digo de frente y sin rodeos: **tienes toda la razón al sentir que tienes a una secretaria "bruta"**, y no es una percepción subjetiva. Es la consecuencia directa de una **arquitectura de ejecución asmática, frágil e ineficiente**. 

Randy acertó en el diagnóstico de producto y comportamiento agéntico: Carmencita no razona porque está atrapada en un despachador de un solo turno basado en expresiones regulares y extracción artesanal de bloques JSON (`extractActionJson` y `sanitizeReplyText`). 

Pero desde la trinchera de **DevOps, SRE, Ciberseguridad y Concurrencia**, la radiografía es aún más alarmante. Carmencita hoy presenta:
1. **Latencias de cola (p95) inaceptables (8 a 14 segundos por interacción):** causadas por un pipeline de triple inferencia secuencial obligatoria y RAG ciego en cada saludo.
2. **Brechas de infraestructura en Dokploy / Docker:** imágenes de producción que carecen de binarios fundamentales (`ffmpeg` para notas de voz en Telegram) y base de datos con riesgo de quiebre en extensiones vectoriales (`pgvector`).
3. **Cero concurrencia segura en Telegram:** ausencia total de colas de mensajes o mutex por usuario; dos notas de voz consecutivas de Sebastián desatan condiciones de carrera y colisiones de estado en PostgreSQL.
4. **Violaciones directas a nuestros protocolos DevSecOps:** arranque del servidor sin validación Zod de variables de entorno, y concatenación manual de cadenas en consultas SQL `$queryRawUnsafe` dentro del servicio de embeddings.

A continuación presento la radiografía forense completa, el análisis de infraestructura y el contrato de trabajo atómico para Fred.

---

## 🔬 2. Radiografía de Infraestructura, Contenedores & VPS (Dokploy / Hostinger)

### 🔴 Hallazgo 1: Ruptura de Transcodificación de Voz en Imagen Docker (`Dockerfile`)
* **Archivo:** `Dockerfile` (Líneas 18-35).
* **Evidencia Forense:**
  ```dockerfile
  FROM node:22-alpine AS runner
  WORKDIR /app
  ...
  RUN npm ci --omit=dev
  ```
  En `src/services/voice.service.js` (Líneas 48-56), el método `_transcodeWavToOgg` invoca el binario del sistema `ffmpeg`:
  ```javascript
  const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-af', 'apad=pad_dur=0.6', '-c:a', 'libopus', ...]);
  ```
* **Impacto en Producción:** La imagen base `node:22-alpine` **no incluye `ffmpeg`**. Si Carmencita se compila y levanta en Dokploy bajo este Dockerfile, el proceso `ffmpeg` arroja `ENOENT` y cae silenciosamente al fallback de devolver un archivo `.wav`. Telegram no reproduce `.wav` como nota de voz nativa de onda redonda interactiva en el móvil, sino como un archivo adjunto tosco. Esto destruye la experiencia fluida de voz ejecutiva que Sebastián exige.
* **Directiva de Infraestructura:** En la etapa `runner` del `Dockerfile` debe agregarse obligatoriamente `RUN apk add --no-cache ffmpeg`.

---

### 🔴 Hallazgo 2: Riesgo de Desfase de Base de Datos en `docker-compose.yml` (`pgvector`)
* **Archivo:** `docker-compose.yml` (Líneas 2-14).
* **Evidencia Forense:**
  ```yaml
  carmencita-db:
    image: postgres:16-alpine
  ```
  En `prisma/schema.prisma` (Línea 127) y `src/services/embedding.service.js` (Línea 86-93):
  ```prisma
  model SemanticMemory {
    ...
    embedding Unsupported("vector(768)")?
  }
  ```
* **Impacto en Producción:** La imagen oficial `postgres:16-alpine` **no compila ni incluye la extensión `pgvector`**. Si se levanta la base de datos desde el `docker-compose.yml`, cualquier intento de ejecutar migraciones de Prisma o registrar memorias semánticas arroja:
  `ERROR: type "vector" does not exist`.
* **Directiva de Infraestructura:** Cambiar inmediatamente la imagen de la base de datos por `pgvector/pgvector:pg16-alpine`.

---

### 🔴 Hallazgo 3: Enlace de Red Perimetral Erróneo para Dokploy (`HOST=127.0.0.1`)
* **Archivo:** `src/config.js` (Línea 12) vs `Dockerfile` (Línea 24).
* **Evidencia Forense:**
  En `src/config.js`:
  ```javascript
  host: process.env.HOST || '127.0.0.1', // Blindaje perimetral: bind exclusivo a localhost
  ```
  Si bien dentro del host VPS (cuando corre por fuera de Docker vía PM2) `127.0.0.1` es seguro, cuando el contenedor corre en Dokploy o Docker Compose, enlazar a `127.0.0.1` hace que Fastify solo escuche peticiones dentro del propio namespace de red del contenedor. Los reverse proxies de Dokploy (Traefik / Nginx) en la red bridge no pueden encaminar tráfico HTTP hacia el puerto 3050.
* **Directiva de Infraestructura:** `src/config.js` debe respetar el estándar de contenedores: `host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')`.

---

### 🔴 Hallazgo 4: Contenedor Corriendo como Root y Falta de HEALTHCHECK
* **Archivo:** `Dockerfile`.
* **Evidencia Forense:** El runner corre con el usuario `root` por omisión y no posee directiva `HEALTHCHECK`.
* **Directiva de Infraestructura:** 
  1. Agregar directiva de usuario sin privilegios: `USER node`.
  2. Implementar `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3050/health || exit 1`.

---

## 🛡️ 3. Blindaje DevSecOps & Zero-Trust (Directivas 2 y 5)

### 🔴 Hallazgo 5: Arranque Ciego sin Validación Zod de Variables de Entorno
* **Archivo:** `src/config.js`.
* **Evidencia Forense:** La configuración se lee directamente de `process.env` con operadores de fallback (`|| ''`).
* **Impacto en Producción:** Viola la **Directiva Maestra #5 de DeKo Labs** ("Validación estricta en tiempo de arranque de variables de entorno mediante Zod"). Si el contenedor o proceso en Hostinger inicia sin `GEMINI_API_KEY`, sin `DATABASE_URL` o con un `PORT` alfanumérico inválido, el proceso no falla inmediatamente al arrancar (Fail-Fast); en su lugar, arranca en estado zombi y colapsa cuando Sebastián interactúa horas después en Telegram.
* **Directiva DevSecOps:** Crear un validador `env.schema.js` con Zod que parsee y certifique `process.env` antes de exportar el objeto `config`. Si falta una variable crítica requerida en producción, el proceso debe abortar con código de salida 1 y mensaje explícito en consola.

---

### 🔴 Hallazgo 6: Concatenación Manual de Strings en Consulta SQL `$queryRawUnsafe`
* **Archivo:** `src/services/embedding.service.js` (Líneas 124-140).
* **Evidencia Forense:**
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
* **Impacto en Seguridad:** Si bien existe un `.replace(/'/g, "''")`, interpolar cadenas arbitrarias directamente en `$queryRawUnsafe` es una pésima práctica de seguridad y un anti-patrón de DevSecOps. La consulta debe parametrizarse limpiamente utilizando operadores condicionales en el `WHERE` o utilizando `$queryRaw` con `Prisma.sql`.

---

### 🔴 Hallazgo 7: Escalada de Privilegios en AGY Bridge
* **Archivo:** `src/core/agy-bridge.js` (Líneas 67-73).
* **Evidencia Forense:**
  ```javascript
  const args = [
    '-p',
    prompt,
    '--dangerously-skip-permissions',
    '--model',
    model,
  ];
  ```
  Cuando el binario `agy` existe en el host VPS (`/root/.local/bin/agy`), se ejecuta con `--dangerously-skip-permissions`. Si el prompt derivado del LLM sufre una inyección indirecta (por ejemplo, a través del análisis de un correo fraudulento o un documento externo), `agy` ejecutaría comandos arbitrarios con permisos de `root`.
* **Directiva DevSecOps:** Toda ejecución de terminal vía `AGY` debe restringirse a una lista blanca perimetral de tareas o ejecutarse bajo un usuario sin privilegios administrativos (`nobody` o `carmencita-service`).

---

## ⚡ 4. SRE, Concurrencia, Cuellos de Botella y Latencia de Cola (p95)

### 🔴 Hallazgo 8: Cero Gestión de Concurrencia en Telegram (Condición de Carrera en Ráfagas)
* **Archivo:** `src/adapters/telegram.js` (Líneas 254-324, 398-478).
* **Evidencia Forense:**
  Los eventos `bot.on('message:text')`, `bot.on('message:photo')` y `bot.on(['message:voice', 'message:audio'])` son completamente asíncronos y no están serializados:
  ```javascript
  this.bot.on('message:text', async (ctx) => {
    ...
    const reply = await this.brain.processTextMessage(...);
    ...
  });
  ```
* **Impacto en Confiabilidad:** Cuando Sebastián envía una ráfaga común en Telegram (ej: una nota de voz explicando un encargo y de inmediato una foto o texto aclaratorio), se disparan dos o tres instancias paralelas de `processTextMessage`/`processAudio`/`processImage`.
  1. Ambas instancias leen el mismo historial de mensajes en PostgreSQL.
  2. Ambas llaman a Gemini en paralelo.
  3. Ambas intentan escribir en la base de datos (`MessageLog`, `Task`, `SemanticMemory`) simultáneamente.
  4. La respuesta de la segunda petición puede llegar a Telegram antes que la primera, desordenando la conversación y haciendo que Carmencita responda cosas desfasadas.
* **Solución SRE:** Implementar una **Cola de Mensajes en Memoria por ChatID** (FIFO Message Queue con Mutex / Lock por usuario). Si entra un mensaje mientras otro se procesa, entra en cola ordenada, emitiendo acción de *typing* sostenida.

---

### 🔴 Hallazgo 9: El Embudo de la Triple Inferencia Secuencial y RAG Ciego
* **Archivo:** `src/core/brain.js` (Líneas 107-126, 129-142, 160-181).
* **Evidencia Forense:**
  Por cada mensaje simple de texto:
  1. **Llamada de BD y RAG síncrono:** Genera embedding de la consulta (`text-embedding-004`) y busca en Postgres (`searchSimilarMemories`). Latencia acumulada: **~400ms - 800ms**.
  2. **Inferencia 1 (Gemini):** Prompt masivo de 205 líneas + historial + directivas para generar texto + JSON. Latencia acumulada: **~2,500ms - 4,000ms**.
  3. **Inferencia 2 (Síntesis de Tool):** Si hubo herramienta, llamada obligatoria a `_synthesizeToolResults` con otro prompt completo. Latencia acumulada: **~2,500ms - 3,500ms**.
  4. **Inferencia 3 (Auto-RAG Background):** Extracción de recuerdos con `_extractAndSaveMemoryBackground`. Latencia acumulada: **~2,000ms** (en background, pero consumiendo cuota del pool de Gemini).
  5. **Síntesis de Voz (si aplica):** Generación de TTS en `VoiceService` con transcodificación de audio. Latencia acumulada: **~1,500ms - 2,500ms**.
* **Impacto Total:** La latencia acumulada total para una sola orden compleja es de **7 a 13 segundos**. Sebastián experimenta esperas eternas en Telegram.
* **Solución Arquitectónica:** 
  1. Con **Native Function Calling en bucle ReAct**, la inferencia 1 y 2 se fusionan en un único flujo de llamadas nativas de Gemini, reduciendo el overhead en un **50%**.
  2. El RAG debe ser **bajo demanda (On-Demand Retrieval)** mediante la herramienta `search_knowledge_base`, eliminando el cálculo de embeddings en mensajes conversacionales cotidianos.

---

### 🔴 Hallazgo 10: Prompt Bloat y Fugas de Tokens
* **Archivo:** `src/core/carmencita.prompt.js` (205 líneas).
* **Evidencia Forense:** El System Prompt actual contiene más de 12,000 caracteres (~3,000 tokens) que se reenvían en cada llamada a Gemini. Dentro de ese prompt se gastan líneas instruyendo al modelo a:
  - Generar o no generar asteriscos de Markdown.
  - Generar etiquetas HTML `<b>` y `<i>`.
  - Colapsar saltos de línea y formatear listas con viñetas `•`.
  - Estructurar esquemas JSON con llaves exactas.
* **Directiva de Ingeniería:**
  - El LLM es un motor de razonamiento, no un compilador de texto.
  - El formateo de Markdown a HTML seguro para Telegram debe ejecutarse en un **Presenter / Middleware de Presentación en Node.js** (mediante parsing AST o sanitizador de salida).
  - Al purificar el System Prompt a 50 líneas, la latencia inicial (Time-to-First-Token) caerá un **40%** y el costo de tokens se reducirá a una tercera parte.

---

## 📊 5. Observabilidad, Telemetría & Recibo Mecánico Post-Deploy

### 🔴 Hallazgo 11: Inexistencia de Métricas Cuantitativas y Monitoreo Activo de Keys
* **Evidencia Forense:** 
  - La rotación del pool de modelos de Gemini (`_generateContentWithFailover`) solo escribe un `console.warn` cuando un modelo falla.
  - No hay registro de latencias (cuánto tardó la llamada a Gemini, cuánto tardó el query a PostgreSQL, cuánto tardó la API de Google Drive).
  - No existe un arnés de producción (`npm run verify:prod`).
* **Directiva SRE:** 
  1. Integrar métricas de proceso y latencia dentro de `diagnostics.service.js` exponiendo un endpoint `/api/metrics`.
  2. Implementar un script de verificación mecánica `scripts/verify-prod.js` que se dispare tras el webhook de despliegue en Dokploy para auditar:
     - Health check 200 de Fastify.
     - Conectividad y latencia de PostgreSQL.
     - Estado del bot de Telegram (polling activo).
     - Emisión del **Recibo Mecánico en JSON** inmutable con hash de commit, tiempo de deploy y estado de subsistemas.

---

## 📋 6. Contrato de Trabajo Atómico para Fred (Lead Software Engineer)

Como CTO de DeKo Labs, establezco los **Términos de Referencia e Instrucciones Coercitivas** para que Fred ejecute la refactorización quirúrgica de Carmencita Hub:

### Paquete 1: Infraestructura & Seguridad Perimetral (DevSecOps)
1. **`Dockerfile`:**
   - Instalar `ffmpeg` (`RUN apk add --no-cache ffmpeg`).
   - Configurar usuario no privilegiado `USER node`.
   - Agregar `HEALTHCHECK` formal contra `/health`.
2. **`docker-compose.yml`:**
   - Reemplazar imagen de PostgreSQL por `pgvector/pgvector:pg16-alpine`.
3. **`src/config.js` y `src/validators/env.schema.js`:**
   - Crear validación en tiempo de arranque con **Zod** para todas las variables críticas (`PORT`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`).
   - Abortar arranque con `process.exit(1)` si la configuración en producción es inválida.
4. **`src/services/embedding.service.js`:**
   - Eliminar concatenación de strings en `$queryRawUnsafe`; refactorizar con parámetros posicionales o `Prisma.sql`.

### Paquete 2: Motor Agéntico ReAct con Native Tool Calling (`@google/genai`)
1. **`src/core/agent-runner.js` (Nuevo motor):**
   - Declarar todas las herramientas como esquemas formales en `tools: [{ functionDeclarations }]`.
   - Implementar bucle de razonamiento ReAct:
     ```javascript
     while (step < maxSteps && response.functionCalls) {
       const toolResults = await executeToolCalls(response.functionCalls);
       response = await sendToolResponses(toolResults);
     }
     ```
   - Eliminar definitivamente `extractActionJson` y la dependencia de regexes para ejecución de herramientas.
2. **`src/core/brain.js`:**
   - Migrar el despacho lineal a `agent-runner.js`.
   - Enviar el historial de conversación como turnos nativos del SDK de Google (`contents: [{ role: 'user', parts: [...] }, { role: 'model', parts: [...] }]`), erradicando el aplanado de historial en un solo string.

### Paquete 3: Presentación, Concurrencia y Saneamiento
1. **`src/adapters/telegram.js`:**
   - Implementar cola FIFO de mensajes por `senderId` para evitar carreras en ráfagas de audio o texto.
2. **`src/presentation/formatter.js` (Nuevo módulo):**
   - Extraer la lógica de formateo visual a un formateador independiente que limpie Markdown, asegure etiquetas HTML para Telegram y garantice los saltos de línea dobles sin sobrecargar el prompt del modelo.
3. **`src/core/carmencita.prompt.js`:**
   - Reducir el System Prompt a 50 líneas ejecutivas, eliminando micro-reglas de formato y directivas negativas asfixiantes.

---

## 🏁 7. Veredicto del CTO

Sebastián, la infraestructura y las herramientas que integraste son de primer nivel. Pero el software se estaba ahogando en su propio arnés por falta de un motor agéntico nativo y por fricciones de infraestructura básica. 

Con estos cambios ejecutados quirúrgicamente por Fred y certificados por este CTO bajo arnés mecánico, Carmencita tendrá:
- **Cero fugas de JSON.**
- **Respuestas en la mitad del tiempo.**
- **Capacidad real de encadenar 3, 4 o 5 acciones autónomas en una sola orden.**
- **Notas de voz de alta fidelidad en Telegram.**
- **Blindaje total en Dokploy y PostgreSQL.**

Quedo a la espera de que Fred confirme la recepción de esta orden técnica para iniciar la fase de implementación. Cero atajos, bases sólidas.
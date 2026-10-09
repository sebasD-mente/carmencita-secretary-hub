# 🎯 PROMPT DE INGENIERÍA PARA FRED: MILESTONE 3 (CONCURRENCIA ROBUSTA Y SERIALIZACIÓN DE SESIÓN FIFO POR USUARIO)
**Ticket Oficial:** `[DEKO-CARMEN-M3]`  
**Estándar:** DeKo Labs Enterprise — Robusto, Profesional, Escalable  
**Autor:** Gary (Lead Enterprise Architect & Auditor Técnico)  
**Ejecutor:** Fred (Lead Software Engineer / Single Developer)  
**Product Owner:** Sebastián Jiménez  
**Fecha:** 9 de Octubre, 2026  

---

## 🏛️ 1. CONTEXTO Y MISIÓN TÉCNICA

Fred, tras los despliegues de los **Milestones 0, 1 y 2**, Carmencita cuenta con cimientos de infraestructura blindados, un motor agéntico ReAct con Function Calling nativo (`@google/genai`) y una mente purificada con presentación limpia desacoplada.

Sin embargo, en el canal de **Telegram (`src/adapters/telegram.js`)** persiste una vulnerabilidad crítica de confiabilidad y SRE:
1. **Condición de Carrera en Ráfagas de Mensajes:** Los listeners de eventos (`message:text`, `message:photo`, `message:voice`, `message:document`) despachan cada mensaje entrante de forma inmediatamente paralela y asíncrona.
2. **Colisiones de Estado en PostgreSQL:** Si Sebastián envía una nota de voz de 10 segundos y de inmediato dos textos explicativos (*"Oye Sebas, recuerda que la cita es a las 4"* y *"Y revisa también el correo"*), los tres mensajes compiten en paralelo en `CarmencitaBrain`. El texto puede terminar antes que el audio, guardando turnos desordenados en el historial, duplicando llamadas o colisionando en transacciones de base de datos.
3. **Desorden Visual para el Usuario:** Las respuestas llegan en orden aleatorio, quebrando la coherencia de la conversación ejecutiva.

### La Misión del Milestone 3:
1. **Crear `src/adapters/session-queue.js` (`UserSessionQueue`):** Gestor de concurrencia en memoria que garantice **procesamiento secuencial FIFO (First-In, First-Out) estricto por usuario**, con aislamiento total entre diferentes usuarios.
2. **Integrar la Cola en `TelegramAdapter`:** Envolver todos los handlers de entrada dentro de `sessionQueue.enqueue(senderId, ...)`.
3. **Manejo Robusto de Chat Action:** Mantener el estado de `typing` o `record_voice` fluido durante la espera en cola, asegurando su cancelación limpia en un bloque `finally`.
4. **Resiliencia & Garbage Collection:** Si una tarea falla, el error no debe tumbar el bot ni bloquear los mensajes posteriores de ese usuario; y cuando la cola de un usuario se vacíe, debe liberarse de memoria para evitar memory leaks.
5. **Suite de Pruebas Unitarias de Concurrencia (`test/session-queue.test.js`):** Pruebas deterministas que certifiquen el orden FIFO, aislamiento y tolerancia a fallos.

---

## 🛠️ 2. ESPECIFICACIONES TÉCNICAS DETALLADAS (PASO A PASO)

Fred, debes implementar e intervenir los siguientes módulos en el repositorio `/var/www/carmencita-secretary-hub`:

---

### PASO 1: Gestor de Concurrencia FIFO por Usuario (`src/adapters/session-queue.js`)
* **Archivo Nuevo:** `src/adapters/session-queue.js`
* **Requisitos:**
  1. Implementar y exportar la clase `UserSessionQueue`:
     ```javascript
     export class UserSessionQueue {
       constructor() {
         // Map<string, Promise<unknown>>
         this._userQueues = new Map();
         // Map<string, number> (conteo de tareas pendientes por usuario)
         this._queueLengths = new Map();
       }
       // ...
     }
     ```
  2. Método `async enqueue(userId, taskFn)`:
     - Normalizar `userId` a string (`String(userId || 'default')`).
     - Obtener la promesa pendiente actual del usuario (`this._userQueues.get(key) || Promise.resolve()`).
     - Incrementar el contador de cola para ese usuario.
     - Encadenar la nueva tarea `taskFn`:
       ```javascript
       const executeTask = async () => {
         try {
           return await taskFn();
         } finally {
           const currentCount = (this._queueLengths.get(key) || 1) - 1;
           if (currentCount <= 0) {
             this._queueLengths.delete(key);
             this._userQueues.delete(key); // Garbage collection automática de cola vacía
           } else {
             this._queueLengths.set(key, currentCount);
           }
         }
       };

       // El nuevo tail se encadena independientemente de si la tarea anterior falló o tuvo éxito (.then / .catch)
       const nextPromise = currentPromise.then(executeTask, executeTask);
       this._userQueues.set(key, nextPromise);
       return nextPromise;
       ```
  3. Métodos auxiliares de telemetría e inspección:
     - `getQueueLength(userId)`: Retorna el número de tareas en cola para ese usuario.
     - `isProcessing(userId)`: Retorna boolean indicando si hay trabajo en curso.
     - `getActiveUsersCount()`: Retorna el número de colas activas en memoria.
  4. Exportar tanto la clase como una instancia por defecto: `export const defaultSessionQueue = new UserSessionQueue();`.

---

### PASO 2: Integración en `TelegramAdapter` (`src/adapters/telegram.js`)
* **Archivo a Modificar:** `src/adapters/telegram.js`
* **Requisitos:**
  1. Importar `UserSessionQueue` desde `./session-queue.js` e instanciarlo en el constructor:
     `this.sessionQueue = deps.sessionQueue || new UserSessionQueue();`
  2. Envolver el procesamiento en los 4 listeners principales:
     * **Texto (`message:text`):**
       ```javascript
       this.bot.on('message:text', async (ctx) => {
         const senderId = String(ctx.from.id);
         return this.sessionQueue.enqueue(senderId, async () => {
           // ... lógica existente de typingInterval, brain.processTextMessage y _safeReply
         });
       });
       ```
     * **Fotos (`message:photo`):**
       ```javascript
       this.bot.on('message:photo', async (ctx) => {
         const senderId = String(ctx.from.id);
         return this.sessionQueue.enqueue(senderId, async () => {
           // ... lógica existente de brain.processImage
         });
       });
       ```
     * **Documentos (`message:document`):**
       ```javascript
       this.bot.on('message:document', async (ctx) => {
         const senderId = String(ctx.from.id);
         return this.sessionQueue.enqueue(senderId, async () => {
           // ... lógica existente de brain.processDocument
         });
       });
       ```
     * **Notas de Voz (`['message:voice', 'message:audio']`):**
       ```javascript
       this.bot.on(['message:voice', 'message:audio'], async (ctx) => {
         const senderId = String(ctx.from.id);
         return this.sessionQueue.enqueue(senderId, async () => {
           // ... lógica existente de brain.processAudio
         });
       });
       ```
  3. **Protección de Chat Actions:**
     - El intervalo `typingInterval` debe crearse *dentro* de la función de tarea encolada (no antes de entrar a la cola), de modo que el bot no empiece a mostrar "escribiendo..." mientras el mensaje aún está esperando turno en la cola.
     - El `clearInterval(typingInterval)` debe residir siempre en el bloque `finally` correspondiente.

---

### PASO 3: Suite de Pruebas Unitarias de Concurrencia (`test/session-queue.test.js`)
* **Archivo Nuevo:** `test/session-queue.test.js`
* **Requisitos:**
  1. Implementar casos de prueba deterministas con timers controlados:
     * **Caso 1 (Orden FIFO Estricto):**
       Encolar 3 tareas para el mismo usuario con retardos deliberadamente asimétricos (Tarea 1: 50ms, Tarea 2: 10ms, Tarea 3: 5ms). Verificar que se resuelven en orden exacto `[1, 2, 3]`.
     * **Caso 2 (Aislamiento y Paralelismo Multi-Usuario):**
       Encolar tarea lenta para `UserA` (60ms) y tarea rápida para `UserB` (10ms). Verificar que `UserB` completa su tarea antes de que `UserA` termine la suya (sin bloqueo cruzado).
     * **Caso 3 (Resiliencia ante Excepciones):**
       La tarea 1 de `UserA` arroja un `Error('Fallo simulado')`. La tarea 2 de `UserA` debe ejecutarse y resolverse con éxito, demostrando que la cola no se congela por un error.
     * **Caso 4 (Limpieza de Memoria / Garbage Collection):**
       Tras completar todas las tareas de un usuario, verificar que `sessionQueue.getQueueLength(userId)` es 0 y que el mapa interno no retiene entradas huérfanas.
     * **Caso 5 (Integración con Simulación de Ráfaga en Telegram):**
       Simular la llegada consecutiva de 3 mensajes rápidos de un usuario (audio + texto 1 + texto 2) y comprobar que el cerebro procesa un único mensaje a la vez de forma serializada.
  2. Ejecutar `node test/session-queue.test.js` y asegurar 100% en verde.

---

### PASO 4: Arnés Mecánico y Techos Dinámicos (`scripts/audit-monoliths.js`)
* **Archivo a Modificar:** `scripts/audit-monoliths.js`
* **Requisitos:**
  1. Agregar a `DOMAIN_CEILINGS`:
     - `'src/adapters/session-queue.js': 200`
  2. Ajustar techo para `src/adapters/telegram.js` si es necesario para albergar la cola:
     - `'src/adapters/telegram.js': 550`
  3. Ejecutar `npm run harness:check` y asegurar **0 violaciones**.

---

## 🚦 3. CRITERIOS DE ACEPTACIÓN MECÁNICOS (QUALITY GATE 3)

Fred, no des por finalizada tu tarea sin verificar **todos y cada uno** de estos 5 puntos en tu terminal:

1. **Suite de Concurrencia 100% Verde:**
   ```bash
   node test/session-queue.test.js
   ```
2. **Suites Previas 100% Verdes:**
   ```bash
   node test/formatter.test.js && node test/agent-runner.test.js && node test/gemini-pool.test.js
   ```
3. **Cero Regresiones en Suite Global:**
   ```bash
   ALLOW_ROOT_EXEC=true node test/hub.test.js
   ```
   *Los 59 tests actuales deben pasar al 100% sin ninguna regresión.*
4. **Cero Memory Leaks:**
   *Comprobada la eliminación de colas vacías en `UserSessionQueue`.*
5. **Arnés Mecánico sin Violaciones:**
   ```bash
   npm run harness:check
   ```
   *Salida con código 0 y cero advertencias de exceso de líneas.*

---

## 📤 4. DIRECTIVA OBLIGATORIA DE ENTREGA Y PUSH A GITHUB (CERO CÓDIGO ATRAPADO EN LOCAL)

Fred:
1. **Verificación de Suite:** Asegúrate de que las pruebas pasen al 100% en local antes de cualquier commit (`node test/session-queue.test.js` y `ALLOW_ROOT_EXEC=true node test/hub.test.js`).
2. **Stage de Cambios:** Agrega todos los archivos creados o modificados correspondientes a este ticket:
   ```bash
   git add src/adapters/session-queue.js src/adapters/telegram.js scripts/audit-monoliths.js test/session-queue.test.js PROMPT_FRED_M3_CONCURRENCIA_Y_SERIALIZACION.md
   ```
3. **Commit Semántico:** Realiza el commit siguiendo el estándar de Conventional Commits:
   ```bash
   git commit -m "feat(concurrency): [DEKO-CARMEN-M3] cola fifo de sesion por usuario, mutex y serializacion en telegram"
   ```
4. **Push Remoto Obligatorio:**
   ```bash
   git push origin main
   ```
5. **Comprobación:** Ejecuta `git status` para verificar que el árbol de trabajo quede limpio y el branch sincronizado con origin.

> ⚠️ **REGLA DE ORO:** La tarea NO se considera terminada ni auditable hasta que el commit esté reflejado en el repositorio remoto de GitHub. Queda terminantemente prohibido dejar cambios únicamente en local.

---

¡Adelante, Fred! Aplica el bisturí con el rigor de DeKo Labs. Al terminar y pushear a GitHub, notifícame para proceder con la auditoría de código y el despliegue en producción.

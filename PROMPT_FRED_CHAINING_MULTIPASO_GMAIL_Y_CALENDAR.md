# 🏛️ PROMPT QUIRÚRGICO DE INGENIERÍA: CHAINING MULTI-PASO, SANITIZACIÓN ANTI-FUGA Y RESOLUCIÓN REAL DE EVENTOS EN GMAIL & CALENDAR

> **Destinatario:** Fred (Desarrollador / Agente Ejecutor)  
> **Arquitecto & Auditor:** Gary (CTO & Lead Enterprise Architect, Deko Labs)  
> **Líder de Producto:** Sebastián Jiménez (Director Creativo & Fundador)  
> **Proyecto:** `carmencita-secretary-hub` (`C:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
> **Severidad:** **P1 - Alta Prioridad (UX de Producción, Integridad Contable de Fechas y Prevención de Duplicados)**  
> **Modo de Ejecución:** **SOLO (Single Developer)**  

---

## 🎯 OBJETIVOS DE LA INTERVENCIÓN

Resolver de raíz tres fallas detectadas en la interacción ejecutiva con Carmencita:
1. **Erradicación Definitiva de la Fuga de JSON Crudo:** En órdenes compuestas (ej: "busca el correo del evento y márcalo en mi calendario"), Gemini emite bloques ````json { "action": "CREATE_CALENDAR_EVENT", ... } ```` dentro del texto de síntesis que terminan volcándose en crudo a Telegram sin ejecutarse.
2. **Chaining Multi-Paso Autónomo:** Permitir que tras ejecutar una acción primaria (como `CHECK_GMAIL`), si la respuesta sintetizada contiene una acción secundaria (como `CREATE_CALENDAR_EVENT`), esta sea detectada, parseada y ejecutada de forma transparente, incorporando los resultados reales al mensaje final sin fuga de código.
3. **Resolución Verídica de Fechas de Eventos en Gmail:** Al consultar correos sobre eventos, tickets o agendas, Carmencita debe inspeccionar el cuerpo real (`bodyText`) para extraer la fecha real del evento (ej: 24 de octubre) y no confundirla con la fecha en que se recibió el correo (ej: 22 de septiembre).
4. **Prevención de Eventos Duplicados en Google Calendar:** Al intentar crear un evento, verificar si ya existe en la agenda para la fecha o con título coincidente. Si ya existe, reportar el enlace y confirmar la reserva sin crear un duplicado.

---

## 🛠️ ESPECIFICACIONES TÉCNICAS DETALLADAS

### 1. `src/tools/index.js` (Sanitización y Chaining de Herramientas)

#### A. Función de Sanitización Anti-Fuga (`sanitizeReplyText`)
* Exportar la función `sanitizeReplyText(rawText)`:
  * Eliminar cualquier bloque de código markdown ````json ... ```` o ```` ... ```` que contenga `"action"`.
  * Eliminar cualquier objeto JSON residual suelto que contenga `"action"` si quedó expuesto en el texto.
  * Colapsar saltos de línea triples o cuádruples en saltos dobles limpios (`\n\n`).
  * Hacer `.trim()`.
  * Garantizar que el texto resultante sea 100% conversacional, ejecutivo y cálido para Sebastián.

#### B. Soporte de Chaining en `executeAction`
* Modificar `executeAction(parsedAction, deps, context = {})`:
  1. Ejecutar la acción primaria correspondiente (`handleWorkspaceAction`, etc.).
  2. Tras obtener `result` de la acción primaria:
     * Si `context._isChained` es `true`, retornar directamente `result` para evitar bucles infinitos (profundidad máxima de chaining = 1 paso secundario).
     * Inspeccionar si `result.reply` contiene un bloque JSON secundario invocando `extractActionJson(result.reply)`.
     * Si se detecta una acción secundaria válida:
       a. Validarla con `parseCarmencitaAction(secondary.parsed)`.
       b. Limpiar `result.reply` con `sanitizeReplyText(result.reply)`.
       c. Ejecutar la acción secundaria llamando a `executeAction(secondaryAction, deps, { ...context, cleanText: result.reply, _isChained: true })`.
       d. Combinar armónicamente el resultado de la acción secundaria con el primario:
          * Combinar `reply`: si la acción secundaria generó un mensaje de confirmación o enlace (ej: Google Calendar), anexarlo con elegancia ejecutiva a la respuesta principal.
          * Mezclar flags y objetos (`hasCalendarEvent`, `calendarEvent`, `calendarEvents`, `hasTask`, `task`, etc.).
          * Sanitizar el texto final con `sanitizeReplyText`.
          * Retornar el `makeActionResult` consolidado.
     * Si no hay acción secundaria, sanitizar `result.reply` con `sanitizeReplyText(result.reply)` antes de retornar.

---

### 2. `src/tools/workspace.tools.js` (Lectura Profunda y Deduplicación)

#### A. Lectura Profunda en `CHECK_GMAIL`
* Detectar si la intención es de evento, fecha, ticket o agenda:
  ```javascript
  const eventTermsRegex = /evento|fecha|entrada|ticket|confirmaci[oó]n|cu[aá]ndo|devfest|agenda|cita/i;
  const isEventQuery = eventTermsRegex.test(`${context.userText || ''} ${parsedAction.query || ''}`);
  ```
* Si `isEventQuery` es verdadero y `emails.length > 0` y `deps.gmailService?.getEmailDetails`:
  * Obtener el detalle completo del primer correo: `await deps.gmailService.getEmailDetails({ messageId: emails[0].id })`.
  * Al armar `dataSummary` para `synthesizeToolResults`:
    * Si existe `emailDetail.bodyText`, inyectar un extracto sustancial del cuerpo (primeros 1,500 caracteres limpios de espacios redundantes):
      ```javascript
      const bodyExcerpt = emailDetail.bodyText.slice(0, 1500).replace(/\s+/g, ' ');
      // Inyectar en dataSummary:
      // [Correo Detallado] Asunto: ... | De: ... | Fecha Recibido: ... | Contenido del Correo: ${bodyExcerpt}
      ```
    * De esta manera, Gemini sintetiza la **fecha real del evento indicada dentro del mensaje** y no la cabecera del correo.

#### B. Manejo Inteligente de `CREATE_CALENDAR_EVENT`
* Al invocar `deps.calendarService.createEvent`, enviar `{ ..., checkExisting: true }`.
* Si el resultado retornado tiene `eventResult.alreadyExisted === true`:
  * Adaptar el mensaje de respuesta para informar con precisión ejecutiva:
    ```javascript
    const calendarReply = `${cleanText ? cleanText + '\n\n' : ''}📅 <b>¡El espacio ya se encuentra reservado en tu Google Calendar!</b>\n\n📌 <b>Evento:</b> ${eventResult.summary}\n⏰ <b>Fecha/Hora:</b> ${eventResult.start}\n${eventResult.location ? `📍 <b>Ubicación:</b> ${eventResult.location}\n` : ''}🔗 <a href="${link}">Ver evento en Google Calendar</a>`;
    ```
  * Establecer `hasCalendarEvent: true` y `calendarEvent: eventResult`.

---

### 3. `src/services/calendar.service.js` (Prevención de Duplicados en Agenda)

* En el método `createEvent`:
  ```javascript
  async createEvent({
    summary,
    description = '',
    startDateTime,
    endDateTime = null,
    location = '',
    calendarId = 'primary',
    timeZone = 'America/Guatemala',
    checkExisting = true,
  })
  ```
* Si `checkExisting` es `true`:
  * Consultar eventos existentes en la fecha objetivo mediante `getEventsForDateRange` (buscando en el rango del día completo de `startDateTime`) o `listUpcomingEvents({ maxResults: 30, calendarId })`.
  * Normalizar títulos comparando de forma insensible a mayúsculas, tildes y caracteres especiales:
    ```javascript
    const normalize = (str) => (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
    const targetNorm = normalize(summary);
    const existing = existingEvents.find(ev => {
      const evNorm = normalize(ev.summary);
      return evNorm.includes(targetNorm) || targetNorm.includes(evNorm);
    });
    ```
  * Si se encuentra un evento coincidente:
    * Retornar inmediatamente el evento preexistente con la bandera `{ alreadyExisted: true, id: existing.id, summary: existing.summary, start: existing.start, end: existing.end, htmlLink: existing.htmlLink, status: 'confirmed' }` sin llamar a `calendar.events.insert`.

---

### 4. `scripts/audit-monoliths.js` (Ajuste de Techos del Arnés Mecánico)

* Actualizar la matriz de techos dinámicos `DOMAIN_CEILINGS`:
  * `'src/tools/workspace.tools.js': 380` (Ajuste justificado por incorporación de lectura profunda y deduplicación en agenda).
  * `'src/tools/index.js': 220` (Ajuste justificado por función de sanitización y chaining de herramientas).
* **Restricción Inmutable:** Mantener `src/core/brain.js` estrictamente por debajo de **350 líneas** (actualmente 342 líneas; no debe crecer en este cambio).

---

### 5. Suite de Pruebas Automatizadas (`test/hub.test.js`)

* Agregar pruebas unitarias y de integración que certifiquen:
  1. `sanitizeReplyText`: Remueve bloques de código JSON con `"action"` y preserva el texto cálido humano.
  2. `Chaining Multi-Paso`: Una acción `CHECK_GMAIL` que retorne un bloque JSON secundario `CREATE_CALENDAR_EVENT` ejecuta la creación/deduplicación en el calendario y anexa el resultado sin fugar bloques JSON.
  3. `CHECK_GMAIL` con consulta de eventos: Extrae `emailDetail.bodyText` y lo incluye en la información para síntesis cuando se consultan fechas/entradas/eventos.
  4. `CalendarService.createEvent` con `checkExisting: true`: Detecta un evento preexistente con título similar y retorna `alreadyExisted: true` con su enlace sin duplicarlo en la API.
* **Comando de Certificación:**
  * `npm run harness:check` -> 0 violaciones de techos dinámicos.
  * `npm test` -> Pasa al 100% en verde (53 pruebas existentes + pruebas nuevas añadidas).

---

## 🛡️ RESTRICCIONES & CONDICIONES DE BORDE INQUEBRANTABLES
1. **Cero Fuga de JSON:** Carmencita jamás debe mostrar ```json o llaves de programación a Sebastián en el chat.
2. **Cero Duplicados en Calendar:** Si un evento ya está registrado, se confirma y se entrega su enlace sin crear un clon.
3. **Cero Regresiones en la Suite:** Todos los tests de Obsidian, Gmail, WhatsApp, Telegram, Facturas y Tareas deben mantenerse 100% operativos.

# 🏛️ PROMPT QUIRÚRGICO: AGENDA INTELIGENTE, CONTACTOS, BRIEFING MATUTINO Y GOOGLE TASKS

> **Destinatario:** Fred (Desarrollador / Agente Ejecutor)  
> **Arquitecto & Auditor:** Gary (CTO, Deko Labs)  
> **Líder de Producto:** Sebastián Jiménez (Director Creativo & Fundador)  
> **Proyecto:** `carmencita-secretary-hub` (`c:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
> **Modo de Ejecución:** **SOLO (Single Developer)**  

---

## 🎯 OBJETIVOS DE LA INTERVENCIÓN

Implementar 4 módulos de alta utilidad ejecutiva para elevar a Carmencita a paridad humana completa, integrando servicios nativos con PostgreSQL y Google Workspace:

1. **Consulta Inteligente de Agenda (`LIST_CALENDAR_EVENTS`):**
   * Permitir que Carmencita consulte en tiempo real la agenda de Google Calendar para hoy, mañana o un rango determinado y la presente en un itinerario ejecutivo formateado por horas.
2. **Directorio y Gestión de Contactos (`ContactService` & `SAVE_CONTACT` / `SEARCH_CONTACT`):**
   * Activar el modelo relacional `Contact` de PostgreSQL con un servicio completo de guardado, búsqueda fonética/parcial y ficha ejecutiva con enlaces directos (`tel:`, `https://wa.me/`).
3. **Briefing Matutino Ejecutivo (Daily Brief a las 7:00 AM en `SchedulerService`):**
   * Un pulso automático que cada día a las 7:00 AM (hora `America/Guatemala`) envíe a Telegram el reporte matutino: Clima en Ciudad de Guatemala (Open-Meteo API sin API key), citas del día en Google Calendar y tareas pendientes prioritarias en PostgreSQL.
4. **Sincronización Bidireccional con Google Tasks (`GoogleTasksService`):**
   * Integración con la API de Google Tasks (el scope `auth/tasks` ya está autorizado en el `GOOGLE_REFRESH_TOKEN`). Cada tarea creada en Carmencita se refleja de inmediato en la app oficial de Google Tasks del teléfono de Sebastián.

---

## 🛠️ ESPECIFICACIONES TÉCNICAS DETALLADAS

### 1. Directorio de Contactos (`src/services/contact.service.js`)
* Crear `ContactService` sobre el modelo existente `prisma.contact`:
  - `createOrUpdateContact({ name, role, phone, email, company, notes })`:
    - Sanitizar teléfono eliminando caracteres no numéricos o guardando en formato E.164.
    - Upsert o búsqueda por teléfono / nombre para evitar duplicados.
  - `searchContacts({ query, limit = 10 })`:
    - Búsqueda insensible a mayúsculas (`mode: 'insensitive'`) en `name`, `role`, `company`, `phone` y `notes`.
  - `listContacts({ limit = 20 })`:
    - Listar ordenados por nombre alfabéticamente.
  - `deleteContact(id)`.
* En `src/validators/actions.schema.js`:
  - Agregar `SaveContactActionSchema`:
    ```javascript
    export const SaveContactActionSchema = z.object({
      action: z.literal('SAVE_CONTACT'),
      name: z.string().min(1, 'El nombre es obligatorio'),
      role: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
      company: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    });
    ```
  - Agregar `SearchContactActionSchema`:
    ```javascript
    export const SearchContactActionSchema = z.object({
      action: z.literal('SEARCH_CONTACT'),
      query: z.string().min(1, 'El término de búsqueda es obligatorio'),
    });
    ```
  - Incluir en `AnyCarmencitaActionSchema`.

### 2. Consulta de Google Calendar en `src/services/calendar.service.js`
* Ampliar `CalendarService`:
  - `getEventsForDateRange({ startDate, endDate, calendarId = 'primary', timeZone = 'America/Guatemala' })`:
    - Configura `timeMin = startDate.toISOString()` y `timeMax = endDate.toISOString()`.
    - Llama a `calendar.events.list({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime' })`.
    - Formatea la lista con hora de inicio, hora de fin, título, ubicación y link.
  - `getTodayEvents({ timeZone = 'America/Guatemala' })`:
    - Obtiene inicio del día (00:00:00) y fin del día (23:59:59.999) en la zona horaria guatemalteca y retorna los eventos.
* En `src/validators/actions.schema.js`:
  - Agregar `ListCalendarEventsActionSchema`:
    ```javascript
    export const ListCalendarEventsActionSchema = z.object({
      action: z.literal('LIST_CALENDAR_EVENTS'),
      range: z.enum(['TODAY', 'TOMORROW', 'UPCOMING']).default('TODAY'),
      date: z.string().optional().nullable(),
    });
    ```
  - Incluir en `AnyCarmencitaActionSchema`.

### 3. Sincronización con Google Tasks (`src/services/google-tasks.service.js`)
* Crear `GoogleTasksService`:
  - Conectar mediante `googleapis` OAuth2 (`clientId`, `clientSecret`, `refreshToken`).
  - Métodos:
    - `isConfigured()`: Retorna true si hay credenciales.
    - `createTask({ title, notes, dueDate })`:
      - Inserta la tarea en el tasklist por defecto (`@default`):
        ```javascript
        await tasksClient.tasks.insert({
          tasklist: '@default',
          requestBody: {
            title,
            notes: notes || undefined,
            due: dueDate ? new Date(dueDate).toISOString() : undefined,
          },
        });
        ```
    - `listTasks({ showCompleted = false })`.
* En `src/services/task.service.js`:
  - Inyectar `googleTasksService`. Al llamar a `createTask(...)`, si `googleTasksService.isConfigured()`, sincronizar la tarea en segundo plano sin bloquear la respuesta si falla la red externa.

### 4. Briefing Matutino en `src/services/scheduler.service.js`
* Agregar soporte para Daily Morning Briefing:
  - En el constructor: `this.lastBriefDate = null`.
  - En cada ciclo periódico (60s):
    - Evaluar la hora actual en `America/Guatemala`:
      - Si son las `07:00` (o entre 07:00 y 07:05) y `this.lastBriefDate !== todayStr`:
        1. Llamar a Open-Meteo API pública para Ciudad de Guatemala (`https://api.open-meteo.com/v1/forecast?latitude=14.6407&longitude=-90.5133&current=temperature_2m,relative_humidity_2m,weather_code&timezone=America%2FGuatemala`):
           - Mapear código de clima a texto amigable (Soleado, Nublado, Lluvioso).
        2. Consultar eventos de hoy en `calendarService.getTodayEvents()`.
        3. Consultar tareas pendientes en `taskService.listTasks({ onlyPending: true, limit: 5 })`.
        4. Construir mensaje ejecutivo con formato limpio:
           ```text
           🌅 ¡Buenos días, Sebastián! Carmencita te presenta tu resumen de hoy:

           🌤️ Clima (Ciudad de Guatemala): 21°C, Parcialmente nublado
           📅 Tu agenda de hoy ([N] citas):
           • 10:00 AM - Cita de montaje (Portal del Ángel)
           📋 Tareas prioritarias:
           • [ ] Probar iluminación de stand [ALTA]

           ¡Que sea un día muy exitoso para Deko Labs!
           ```
        5. Enviar vía `telegramAdapter.sendMessage(chatId, text)`.
        6. Registrar `this.lastBriefDate = todayStr`.
  - Exponer método `triggerMorningBrief(referenceDate)` para pruebas unitarias.

### 5. Integración en el Cerebro (`src/core/brain.js`)
* Inyectar `contactService`, `calendarService`, `googleTasksService` en `CarmencitaBrain`.
* En `getSystemPrompt()`:
  - Instruir al modelo que puede:
    - Agendar citas (`CREATE_CALENDAR_EVENT`).
    - Consultar la agenda (`LIST_CALENDAR_EVENTS`).
    - Guardar contactos (`SAVE_CONTACT`).
    - Buscar teléfonos o personas (`SEARCH_CONTACT`).
* En `_executeExtractedActions`:
  - Manejar `LIST_CALENDAR_EVENTS`: llama a `calendarService` y arma respuesta ejecutiva.
  - Manejar `SAVE_CONTACT`: llama a `contactService.createOrUpdateContact` y confirma con ficha limpia.
  - Manejar `SEARCH_CONTACT`: busca y formatea los contactos encontrados con botón/link para marcar o abrir chat de WhatsApp.

### 6. Comandos y Rutas HTTP
* En `src/adapters/telegram.js`:
  - Comando `/contactos` para listar o buscar contactos.
  - Comando `/agenda` para ver citas de hoy.
* En `src/routes/webhooks.js`:
  - `GET /api/contacts`: Búsqueda y listado de contactos.
  - `GET /api/calendar/today`: Consulta de eventos del día.

---

## 🧪 SUITE DE PRUEBAS AUTOMATIZADAS (`test/hub.test.js`)
* Agregar pruebas unitarias e integración en memoria:
  1. `ContactService` (crear, buscar insensible, listar).
  2. `CalendarService` (agenda por rango de fecha y eventos de hoy).
  3. `GoogleTasksService` (crear tarea en Google Tasks mock).
  4. `SchedulerService` (disparo del Morning Brief, integración con mock de clima y prevención de duplicados diarios).
  5. `CarmencitaBrain` con acciones `SAVE_CONTACT`, `SEARCH_CONTACT`, `LIST_CALENDAR_EVENTS`.
* **Criterio inquebrantable:** `npm test` debe pasar al 100% en verde.

---

## ✅ CRITERIOS DE ACEPTACIÓN
1. Código 100% modular, idiomático, sin espagueti ni claves hardcodeadas.
2. `npm test` ejecutando y pasando sin fallos.
3. Git commit y push limpios a la rama `main`.

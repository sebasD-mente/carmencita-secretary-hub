# 🏛️ PROMPT QUIRÚRGICO: DESACOPLAMIENTO GCS, SCHEDULER PROACTIVO Y GOOGLE CALENDAR

> **Destinatario:** Fred (Desarrollador / Agente Ejecutor)  
> **Arquitecto & Auditor:** Gary (CTO, Deko Labs)  
> **Líder de Producto:** Sebastián Jiménez (Director Creativo & Fundador)  
> **Proyecto:** `carmencita-secretary-hub` (`c:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
> **Modo de Ejecución:** **SOLO (Single Developer)**  

---

## 🎯 OBJETIVOS DE LA INTERVENCIÓN

Con las credenciales OAuth permanentes y el Bucket de Google Cloud Storage ya aprovisionados (`carmencita-vault-deko`), debemos realizar una cirugía estructural en tres frentes para cumplir los estándares de Deko Labs:

1. **Desacoplamiento Total de Multimedia (Google Cloud Storage):**
   * Erradicar el guardado permanente en el disco local del VPS.
   * Las fotos de facturas, recibos y documentos recibidos en Telegram/WhatsApp deben subirse directamente al bucket `carmencita-vault-deko` en Google Cloud Storage.
   * El VPS debe almacenar **CERO bytes** de multimedia permanente en disco.

2. **Motor Proactivo de Recordatorios (Heartbeat Scheduler):**
   * Carmencita ya no puede ser un bot pasivo que solo responde cuando le hablan.
   * Implementar un scheduler en segundo plano (`SchedulerService`) que revise cada 60 segundos las tareas pendientes en PostgreSQL (`Task`) cuya fecha/hora programada haya llegado (`dueDate <= NOW()`).
   * Al cumplirse la hora, Carmencita debe enviar un mensaje proactivo e independiente a Telegram a Sebastián (`TELEGRAM_ALLOWED_USERS`) notificándole la tarea con su prioridad.

3. **Sincronización con Google Calendar (`CalendarService`):**
   * Conectar con la API de Google Calendar usando el `GOOGLE_REFRESH_TOKEN`.
   * Permitir que Carmencita agende eventos directamente en el Google Calendar personal de Sebastián y pueda consultar su agenda del día en tiempo real.

---

## 🛠️ ESPECIFICACIONES TÉCNICAS DETALLADAS

### 1. Variables de Entorno en `src/config.js`
Agregar soporte para las nuevas credenciales de Google:
```javascript
google: {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
  bucketName: process.env.GCS_BUCKET_NAME || 'carmencita-vault-deko',
}
```

### 2. Bóveda Desacoplada en `src/services/storage.provider.js`
* Si existen credenciales de Google (`GOOGLE_REFRESH_TOKEN` y `GCS_BUCKET_NAME`):
  * Utilizar cliente de Google Cloud Storage (o `googleapis` / `@google-cloud/storage`) para subir el buffer directamente al bucket:
    * `facturas/YYYY-MM/[timestamp]_[slug].[ext]`
    * `documents/YYYY-MM/[timestamp]_[slug].[ext]`
  * `saveFile`: Sube al bucket y retorna la ruta `gs://carmencita-vault-deko/...` y URL firmada/pública segura para el registro en PostgreSQL.
  * `readFile`: Descarga el buffer directamente desde GCS si se requiere.
  * Si no hay credenciales de Google configuradas (modo local/test), mantener el fallback seguro en carpeta temporal sin romper pruebas unitarias.

### 3. Motor Proactivo en `src/services/scheduler.service.js`
* Crear `SchedulerService`:
  * Mantiene un `setInterval` cada 60 segundos.
  * En cada pulso:
    1. Consulta en PostgreSQL `prisma.task.findMany`:
       * `status: 'PENDIENTE'`
       * `dueDate: { lte: new Date() }`
       * `notifiedAt: null` (o bandera de control)
    2. Por cada tarea vencida:
       * Envía un mensaje proactivo vía `telegramAdapter.bot.api.sendMessage(chatId, text)`:
         ```text
         🔔 ¡Sebastián, recordatorio de Carmencita!

         📌 Tarea: [descripción]
         ⏰ Hora programada: [hora]
         🔥 Prioridad: [ALTA|MEDIA|BAJA]

         ¿Deseas que la marque como completada o la pospongo?
         ```
       * Actualiza la tarea en PostgreSQL marcando `notifiedAt = new Date()`.
  * En `prisma/schema.prisma`:
    * Agregar al modelo `Task`: `notifiedAt DateTime?`
  * Inicializar el scheduler en `src/index.js` al arrancar el servidor.

### 4. Integración Google Calendar en `src/services/calendar.service.js`
* Crear `CalendarService`:
  * Autenticación mediante OAuth2Client de Google (`clientId`, `clientSecret`, `refreshToken`).
  * Métodos:
    * `createEvent({ summary, description, startDateTime, endDateTime, location })`: Inserta el evento en el calendario principal (`primary`) y retorna el enlace al evento.
    * `listUpcomingEvents({ maxResults = 10 })`: Lista las próximas citas del calendario.
* En `src/core/brain.js`:
  * Reconocer intenciones de agendar citas en Google Calendar y consultar la agenda:
    * Acción `CREATE_CALENDAR_EVENT`: `{"action": "CREATE_CALENDAR_EVENT", "summary": "...", "startDateTime": "ISO-8601", "endDateTime": "ISO-8601"}`
    * Ejecutar la acción y confirmar a Sebastián el evento agendado con su enlace de Google Calendar.

---

### 5. Suite de Pruebas Automatizadas (`test/hub.test.js`)
* Agregar pruebas que certifiquen:
  1. Que `StorageProvider` gestione la subida a GCS o fallback limpio sin escribir multimedia permanente en disco.
  2. Que `SchedulerService` detecte tareas con `dueDate <= NOW()` y dispare la notificación a Telegram marcando `notifiedAt`.
  3. Que `CalendarService` interactúe con el mock de Google Calendar y devuelva eventos.
* **Comando:** `npm test` debe pasar al 100% en verde sin errores ni advertencias.

---

## 🛡️ RESTRICCIONES & TECHOS DINÁMICOS
* **Dependencias:** Utilizar `googleapis` y `@google-cloud/storage` instaladas limpiamente vía `npm install googleapis @google-cloud/storage`.
* **Cohesión de Dominio:** Cero espagueti. Cada servicio (`storage.provider.js`, `scheduler.service.js`, `calendar.service.js`) encapsula su responsabilidad.
* **Cero Alucinaciones:** Cero datos inventados; las citas respetan exactamente la fecha y hora indicadas por el usuario.

---

## ✅ CRITERIOS DE ACEPTACIÓN
1. `npm test` ejecuta y pasa todos los tests al 100% en verde.
2. `Task` en PostgreSQL incluye `notifiedAt` y el scheduler envía notificaciones proactivas a Telegram cuando la fecha/hora se cumple.
3. Las facturas y documentos se dirigen al bucket `carmencita-vault-deko` en Cloud Storage, con cero basura en el disco del VPS.
4. Carmencita puede crear y listar eventos reales en Google Calendar.
5. Cambios commiteados y pusheados a la rama `main` en GitHub.

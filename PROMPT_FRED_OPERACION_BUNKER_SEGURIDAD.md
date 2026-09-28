# 🏛️ PROMPT QUIRÚRGICO DE EMERGENCIA: OPERACIÓN BÚNKER DE CIBERSEGURIDAD

> **Destinatario:** Fred (Desarrollador / Agente Ejecutor)  
> **Arquitecto & Auditor:** Gary (CTO, Deko Labs)  
> **Líder de Producto:** Sebastián Jiménez (Director Creativo & Fundador)  
> **Proyecto:** `carmencita-secretary-hub` (`c:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
> **Severidad:** **P1 - CRÍTICA (Security Hardening & Bugfixes en Producción)**  
> **Modo de Ejecución:** **SOLO (Single Developer)**  

---

## 🎯 OBJETIVOS DE LA CIRUGÍA

Tras la auditoría forense adversarial de bajo nivel realizada en el VPS, se identificaron 6 vulnerabilidades y fallos en producción que deben ser erradicados de raíz:

1. **Bug 500 en `/facturas` ([`src/services/document.service.js`](file:///c:/Users/sebas/Documents/Antigravity%20Files/carmencita-secretary-hub/src/services/document.service.js)):**
   * En `listInvoices`, la consulta a Prisma ordena por `orderBy: { createdAt: 'desc' }`.
   * En `schema.prisma`, `Invoice` NO tiene el campo `createdAt` (lo tiene la relación `document`). En producción, PostgreSQL arroja Error 500.
   * **Fix:** Corregir a `orderBy: { document: { createdAt: 'desc' } }`.

2. **Fuga y Error 403 en URLs de GCS ([`src/services/storage.provider.js`](file:///c:/Users/sebas/Documents/Antigravity%20Files/carmencita-secretary-hub/src/services/storage.provider.js)):**
   * El bucket `carmencita-vault-deko` es y debe ser privado. Generar URLs públicas directas (`https://storage.googleapis.com/...`) devuelve `403 Forbidden` al usuario.
   * **Fix:** Implementar generación de **Signed URLs** temporales (15 minutos de vigencia) usando `file.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 })`. Retornar la URL firmada para visualización segura sin exponer el bucket.

3. **Erradicación Total de RCE como root en [`src/core/agy-bridge.js`](file:///c:/Users/sebas/Documents/Antigravity%20Files/carmencita-secretary-hub/src/core/agy-bridge.js):**
   * El path por defecto del binario AGY debe incluir la ruta absoluta: `process.env.AGY_BIN_PATH || '/root/.local/bin/agy'`.
   * **Prohibición de Shell Arbitrario:** Si AGY no está disponible, queda **TERMINANTEMENTE PROHIBIDO** ejecutar texto arbitrario del LLM en `/bin/bash` con `execAsync(cmd)`.
   * El fallback debe soportar **ÚNICAMENTE una lista blanca estricta e inmutable de comandos de solo lectura** para telemetría:
     ```javascript
     const ALLOWED_TELEMETRY = {
       status: 'uptime -p && free -h && df -h /',
       docker: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"',
       system: 'hostname && uname -a && uptime -p',
     };
     ```
   * Si el prompt no corresponde a telemetría de solo lectura permitida, rechazar la ejecución con un mensaje seguro: `"Ejecución denegada: comando no autorizado en la lista blanca de seguridad."`

4. **Middleware de Autenticación Mandatorio en [`src/routes/webhooks.js`](file:///c:/Users/sebas/Documents/Antigravity%20Files/carmencita-secretary-hub/src/routes/webhooks.js):**
   * Configurar `config.apiKey = process.env.CARMENCITA_API_KEY || ''`.
   * En Fastify, registrar un hook `preHandler` en todas las rutas `/api/*`:
     * Exigir la cabecera `Authorization: Bearer <CARMENCITA_API_KEY>` o `x-api-key`.
     * Si no se provee o no coincide, responder inmediatamente `401 Unauthorized` (`{ error: 'Acceso no autorizado. API Key requerida.' }`).
   * En `/webhooks/whatsapp`:
     * Validar que la cabecera `apikey` o `x-webhook-secret` coincida con `config.whatsapp.apiKey` si está configurada.

5. **Deny-by-Default en Whitelist de WhatsApp ([`src/adapters/whatsapp.js`](file:///c:/Users/sebas/Documents/Antigravity%20Files/carmencita-secretary-hub/src/adapters/whatsapp.js)):**
   * Actualmente, si `WHATSAPP_ALLOWED_NUMBERS` viene vacío, la condición `length > 0` se evalúa como falsa y **abre el bot a cualquier remitente del mundo**.
   * **Fix:** Invertir la lógica a **Deny-by-Default**: Si `config.whatsapp.allowedNumbers.length === 0`, el adaptador debe rechazar todos los mensajes entrantes con advertencia en logs: `[WhatsApp Security] Whitelist vacía. Mensaje bloqueado por omisión.`

6. **Parser Robusto No-Voraz en [`src/core/brain.js`](file:///c:/Users/sebas/Documents/Antigravity%20Files/carmencita-secretary-hub/src/core/brain.js):**
   * Reemplazar el regex voraz `\{[\s\S]*"action"[\s\S]*\}` por una extracción quirúrgica que busque primero bloques delimitados por ````json ... ```` y, si no existen, localice el objeto JSON balanceado que contenga la clave `"action"`, evitando fallos cuando el modelo responde con llaves `{}` en el texto explicativo.

7. **Aislamiento en Suite de Pruebas ([`test/hub.test.js`](file:///c:/Users/sebas/Documents/Antigravity%20Files/carmencita-secretary-hub/test/hub.test.js)):**
   * Limpiar `testDataDir` de forma aislada antes de la prueba 12 para evitar contaminación cruzada entre pruebas (erradicando el falso negativo reportado).

---

## 🧪 SUITE DE PRUEBAS AUTOMATIZADAS
* Actualizar y ejecutar `npm test`.
* Las 14 pruebas de integración deben pasar al **100% en verde**, sin un solo falso negativo ni error de concurrencia.
* Agregar pruebas que certifiquen:
  1. Que `/api/documents` y `/api/facturas` rechazan peticiones sin Bearer token con `401`.
  2. Que `listInvoices` ejecuta la consulta relacional `orderBy: { document: { createdAt: 'desc' } }` sin errores.
  3. Que `AgyBridge` rechaza comandos no autorizados en su lista blanca.
  4. Que `StorageProvider` genera Signed URLs correctamente cuando está en modo cloud.

---

## ✅ CRITERIOS DE ACEPTACIÓN
1. `npm test` pasa al 100% en verde.
2. `/facturas` en Telegram ya no arroja error 500.
3. RCE completamente eliminado: cero ejecución arbitraria en bash como root.
4. Rutas HTTP blindadas con autenticación Bearer obligatoria.
5. Whitelist de WhatsApp segura con bloqueo por defecto si está vacía.

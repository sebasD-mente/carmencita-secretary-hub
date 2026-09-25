# 🏛️ PROMPT QUIRÚRGICO DE PULIDO Y PARIDAD OMNICANAL PARA FRED

> **Destinatario:** Fred (Desarrollador / Agente Ejecutor)  
> **Arquitecto & Auditor:** Gary (CTO, Deko Labs)  
> **Líder de Producto:** Sebastián Jiménez  
> **Proyecto:** `carmencita-secretary-hub` (`C:\Users\sebas\Documents\Antigravity Files\carmencita-secretary-hub`)  
> **Modo de Ejecución:** **SOLO (Single Developer)**  

---

## 🎯 OBJETIVOS DE LA INTERVENCIÓN

Con la arquitectura empresarial ya montada y aprobada (Prisma ORM, PostgreSQL, Zod, Bóveda Documental y ExcelJS), debemos ejecutar dos tareas puntuales de pulido e higiene antes de pasar al despliegue en Dokploy:

1. **Eliminar Código Muerto (Higiene de Repositorio):**
   * El archivo `src/core/storage.js` pertenece a la arquitectura previa de archivos JSON planos y ya no es importado por ningún componente del sistema.
   * **Acción:** Eliminar `src/core/storage.js` de forma definitiva.

2. **Paridad Multimodal en WhatsApp (`src/adapters/whatsapp.js`):**
   * Telegram ya cuenta con soporte completo para recepción de documentos (`message:document`) y despacho de archivos Excel (`.xlsx`).
   * WhatsApp actualmente solo procesa texto, fotos y notas de voz. Debemos otorgarle la misma capacidad ejecutiva:
     * **A. Recepción de Documentos:** En `handleWebhook(payload)`, agregar el caso `message.documentMessage`:
       - Extraer `fileName` (`message.documentMessage.fileName || 'documento.pdf'`), `mimeType` y `caption`.
       - Descargar el buffer mediante `this._downloadMediaBase64(messageData)`.
       - Procesar con `await this.brain.processDocument({ channel: 'whatsapp', senderId: senderPhone, senderName, buffer, mimeType, originalName, caption })`.
       - Responder al usuario confirmando la clasificación.
     * **B. Despacho de Archivos / Excel:** Implementar el método `sendMedia(toPhone, { buffer, fileName, mimeType, caption })` invocando el endpoint de Evolution API:
       `POST ${this.baseUrl}/message/sendMedia/${this.instance}`
       con payload:
       ```json
       {
         "number": cleanNumber,
         "mediatype": "document",
         "mimetype": mimeType,
         "caption": caption || "",
         "media": buffer.toString("base64"),
         "fileName": fileName
       }
       ```
     * **C. Entrega reactiva de Excel:** Si el resultado de `brain.processTextMessage` o `brain.processAudio` tiene `reply?.hasExcel && reply?.excelFile`, despachar el archivo Excel físico vía `this.sendMedia(senderPhone, ...)` además del mensaje de texto confirmatorio.

3. **Pruebas Automatizadas:**
   * Agregar en `test/hub.test.js` la verificación de que `WhatsAppAdapter` procese un documento simulado (`message.documentMessage`) y llame a `brain.processDocument`.
   * Asegurar que la suite completa `npm test` continúe pasando al 100% en verde.

---

## 🛡️ RESTRICCIONES & TECHOS DINÁMICOS
* **Techo dinámico para `src/adapters/whatsapp.js`:** Máximo **300 líneas** (actualmente tiene 193 líneas; la adición ocupará ~40 líneas, manteniéndose en zona verde).
* **Cero dependencias externas adicionales:** Utilizar `fetch` nativo de Node.js para `sendMedia`.
* **Cero hacks:** Respetar la misma firma y ergonomía de `handleWebhook` y `sendMessage`.

---

## ✅ CRITERIOS DE ACEPTACIÓN
1. `src/core/storage.js` ya no existe en el repositorio.
2. `src/adapters/whatsapp.js` procesa `documentMessage` y entrega archivos `.xlsx` generados.
3. `npm test` ejecuta y pasa todos los tests en verde sin advertencias ni regresiones.

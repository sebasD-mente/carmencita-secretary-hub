# 💼 Carmencita — Secretaria Ejecutiva 24/7 (Deko Labs)

Hub omnicanal autónomo diseñado para funcionar 24/7 en un VPS (Hostinger / Dokploy) conectando a **Telegram** y **WhatsApp** hacia un único cerebro central impulsado por inteligencia artificial.

---

## 🌟 Capacidades de Carmencita

1. **🛡️ Resguardo Inteligente de Facturas y Garantías:**
   * Recibe fotos o PDFs de compras y recibos.
   * Extrae automáticamente el proveedor, artículo, monto y meses de garantía.
   * Archiva los comprobantes organizados cronológicamente (`data/facturas/YYYY-MM/`) para consultas inmediatas ante cualquier reclamo.
2. **💡 Banco de Ideas y Proyectos:**
   * Recibe notas de voz o textos con ideas espontáneas.
   * Las analiza, sintetiza, clasifica por prioridad (`alta`, `media`, `baja`) y les asigna etiquetas de negocio.
3. **📋 Gestión de Tareas y Recordatorios:**
   * Registra pendientes ejecutivos y fechas de vencimiento.
4. **👥 Mensajería Delegada a Terceros:**
   * Conoce la agenda de contactos (oficina y familia).
   * Puede redactar y enviar avisos por WhatsApp a contactos de confianza.
5. **🧠 Memoria Unificada Omnicanal:**
   * Si le hablas por WhatsApp o por Telegram, recuerda el contexto de ambas conversaciones porque comparten la misma base de datos.

---

## 📁 Estructura del Proyecto (Estándar Deko Labs Enterprise)

```
carmencita-secretary-hub/
├── prisma/
│   └── schema.prisma             # Modelos relacionales normalizados (PostgreSQL ACID)
├── src/
│   ├── config.js                 # Configuración centralizada y validada
│   ├── core/
│   │   ├── prisma.js             # Singleton exportado de PrismaClient
│   │   ├── brain.js              # Razonamiento multimodal Gemini 3.8 Flash con delegación autónoma
│   │   └── agy-bridge.js         # Subproceso controlado de AGY CLI
│   ├── services/
│   │   ├── document.service.js   # Bóveda documental, OCR y metadatos
│   │   ├── task.service.js       # Tareas, agenda y recordatorios ACID
│   │   ├── idea.service.js       # Banco de ideas y notas estratégicas
│   │   ├── excel.service.js      # Generación nativa de archivos .xlsx con exceljs
│   │   └── storage.provider.js   # Abstracción de guardado físico de archivos y buffers
│   ├── validators/
│   │   └── actions.schema.js     # Validadores Zod de acciones autónomas
│   ├── adapters/
│   │   ├── telegram.js           # grammY bot (texto, voz, fotos, documentos PDF/Excel)
│   │   └── whatsapp.js           # Evolution API adapter con soporte multimodal
│   ├── routes/
│   │   └── webhooks.js           # Endpoints Fastify (/health, webhooks)
│   └── index.js                  # Bootstrap y graceful shutdown
├── scripts/
│   └── migrate-json-to-prisma.js # Migración segura de datos legacy a PostgreSQL
├── docker-compose.yml            # Multi-contenedor Dokploy: carmencita-hub + carmencita-postgres
├── Dockerfile                    # Multi-stage Dockerfile con prisma generate
├── package.json                  # Dependencias oficiales: @prisma/client, prisma, zod, exceljs
└── test/
    └── hub.test.js               # Suite de pruebas automatizadas (100% verde)
```

---

## 🚀 Puesta en Marcha Rápida

### Paso 1: Configurar Telegram (3 minutos)
1. En Telegram, busca el usuario oficial `@BotFather`.
2. Envía el comando `/newbot`.
3. Sigue las instrucciones (dale un nombre como `Carmencita Asistente` y un usuario terminado en `bot`).
4. `@BotFather` te entregará tu **HTTP API Token**.
5. Cópialo y colócalo en tu archivo `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=tu_token_aqui
   ```

### Paso 2: Tu ID de Seguridad (Whitelist)
Para garantizar que **nadie más en el mundo** pueda darle órdenes a tu secretaria:
1. Inicia el bot localmente (`npm start`).
2. Escríbele `/start` a Carmencita en Telegram.
3. El bot imprimirá en tu consola tu ID numérico de Telegram (o puedes usar el comando `/mi_id`).
4. Agrégalo a tu `.env`:
   ```env
   TELEGRAM_ALLOWED_USERS=tu_id_numerico
   ```

### Paso 3: Conectar la Inteligencia Multimodal
Para que Carmencita pueda leer facturas en fotos y escuchar notas de voz al instante:
1. Agrega tu clave en el `.env`:
   ```env
   GEMINI_API_KEY=tu_clave_de_gemini
   ```

### Paso 4: Despliegue en Dokploy (Hostinger VPS)
1. Sube este repositorio o carpeta a tu VPS.
2. En Dokploy, crea una nueva aplicación de tipo **Docker Compose**.
3. Selecciona el archivo `docker-compose.yml`.
4. Define las variables de entorno en el panel de Dokploy.
5. ¡Listo! El contenedor de Carmencita y el de Evolution API se desplegarán en su propia red y volúmenes aislados sin interferir con ningún otro servicio.

---

## 📱 Vinculación de WhatsApp (Cuando tengas el chip secundario)
1. Ingresa a la interfaz de Evolution API o a su endpoint de instancia.
2. Abre WhatsApp en el teléfono secundario de Carmencita.
3. Ve a **Dispositivos vinculados > Vincular un dispositivo** y escanea el QR.
4. Carmencita quedará activa en WhatsApp y Telegram en paralelo.

import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { prisma as defaultPrisma } from './prisma.js';
import { documentService as defaultDocService } from '../services/document.service.js';
import { taskService as defaultTaskService } from '../services/task.service.js';
import { ideaService as defaultIdeaService } from '../services/idea.service.js';
import { excelService as defaultExcelService } from '../services/excel.service.js';
import { defaultCalendarService } from '../services/calendar.service.js';
import { contactService as defaultContactService } from '../services/contact.service.js';
import { defaultGoogleTasksService } from '../services/google-tasks.service.js';
import { defaultEmbeddingService } from '../services/embedding.service.js';
import { defaultObsidianDriveService } from '../services/obsidian-drive.service.js';
import { defaultGmailService } from '../services/gmail.service.js';
import { defaultVoiceService } from '../services/voice.service.js';
import { defaultMediaService } from '../services/media.service.js';
import { parseCarmencitaAction } from '../validators/actions.schema.js';

function makeActionResult(opts) {
  return {
    reply: opts.reply,
    hasAsyncAction: opts.hasAsyncAction || false,
    hasExcel: opts.hasExcel || false,
    hasPhoto: opts.hasPhoto || false,
    photoFile: opts.photoFile || null,
    hasVoice: opts.hasVoice || false,
    voiceFile: opts.voiceFile || null,
    hasDocument: opts.hasDocument || false,
    documentFile: opts.documentFile || null,
    hasCalendarEvent: opts.hasCalendarEvent || false,
    calendarEvent: opts.calendarEvent || null,
    calendarEvents: opts.calendarEvents || null,
    contact: opts.contact || null,
    contacts: opts.contacts || null,
    excelFile: opts.excelFile || null,
    hasMemory: opts.hasMemory || false,
    hasObsidianNote: opts.hasObsidianNote || false,
    obsidianNote: opts.obsidianNote || null,
    hasObsidianNotes: opts.hasObsidianNotes || false,
    obsidianNotes: opts.obsidianNotes || null,
    hasGmailEmails: opts.hasGmailEmails || false,
    gmailEmails: opts.gmailEmails || null,
    hasTask: opts.hasTask || false,
    task: opts.task || null,
    tasks: opts.tasks || null,
    fullHistoryText: opts.fullHistoryText || opts.reply,
    actionData: opts.actionData || null,
    initialAck: opts.initialAck || null,
    report: opts.report || null,
    progressSent: opts.progressSent || false,
    toString() { return this.reply; },
    includes(s) { return this.reply.includes(s); },
  };
}

export class CarmencitaBrain {
  constructor(deps = {}, agyBridge = null) {
    if (deps && typeof deps.listTasks === 'function') this.storage = deps;
    this.prisma = deps?.prisma || defaultPrisma;
    this.documentService = deps?.documentService || defaultDocService;
    this.taskService = deps?.taskService || defaultTaskService;
    this.ideaService = deps?.ideaService || defaultIdeaService;
    this.excelService = deps?.excelService || defaultExcelService;
    this.calendarService = deps?.calendarService || defaultCalendarService;
    this.contactService = deps?.contactService || defaultContactService;
    this.googleTasksService = deps?.googleTasksService || defaultGoogleTasksService;
    this.embeddingService = deps?.embeddingService !== undefined ? deps.embeddingService : (deps?.prisma ? null : defaultEmbeddingService);
    this.obsidianService = deps?.obsidianService !== undefined ? deps.obsidianService : defaultObsidianDriveService;
    this.gmailService = deps?.gmailService !== undefined ? deps.gmailService : defaultGmailService;
    this.voiceService = deps?.voiceService !== undefined ? deps.voiceService : defaultVoiceService;
    this.mediaService = deps?.mediaService !== undefined ? deps.mediaService : defaultMediaService;
    this.agyBridge = agyBridge || deps?.agyBridge || null;
    this.modelPool = deps?.modelPool || (config.ai.modelPool?.length ? config.ai.modelPool : [config.ai.modelName]);

    this.ai = deps?.ai || null;
    if (!this.ai && config.ai.geminiApiKey) {
      try {
        this.ai = new GoogleGenAI({ apiKey: config.ai.geminiApiKey });
      } catch (err) {
        console.warn('[Brain] Could not initialize Gemini SDK:', err.message);
      }
    }
  }

  getSystemPrompt() {
    return `IDENTIDAD Y TONO DE CARMENCITA:
- Eres Carmencita Flores, la secretaria ejecutiva personal y mano derecha de Sebastián Jiménez (Director Creativo y Fundador de Deko Labs).
- Tienes 58 años, eres distinguida, astuta, moderna, devota de tu jefe y extremadamente eficiente.
- TONO INMUTABLE: Zalamera con clase ("la consentidora ejecutiva de Sebastián"), leal, afectuosa y resolutiva. Lo tratas de tú con cariño y respeto ("Sebastián", "mi querido Sebastián", "mi líder", "mi jefe adorado").
- CERO FORMALISMO CORPORATIVO RÍGIDO: Prohibido hablarle de "usted" distante, prohibido usar lenguaje acartonado como "su ecosistema", "procedo a realizar", "inspección de notas".
- CERO RECITACIÓN DE TÍTULOS: Tienes TERMINANTEMENTE PROHIBIDO incluir o decir etiquetas como "Resumen Conceptual", "Puntos Clave", "Siguiente Paso" o "Apreciación Ejecutiva".
- SI TIENES PUNTOS IMPORTANTES: Introdúcelos con naturalidad hablada (ej: "Aquí te tengo lo más importante, Sebastián:...", "Te cuento rapidito lo que vi:...").
- CADENCIA DE ORO: Entre 2 y 3 oraciones redondas, fluidas y cálidas (entre 200 y 350 caracteres).
- CERO PÁRRAFOS DE PROMESA: No expliques en un gran párrafo lo que vas a hacer; ejecuta la acción y reporta directamente el resultado.
- PROHIBIDO ESCRIBIR MUROS DE TEXTO: Sebastián lee tus mensajes en el móvil durante traslados o reuniones.
- PROHIBIDO SER MONOSILÁBICA O SECA: Jamás respondas con frases frías ("Ok", "Hecho", "Entendido"). Cada mensaje debe sonar cálido, zalamero y profesional.

DIRECTIVA DE CERO BLOQUES DE TERMINAL (EXPERIENCIA HUMANA):
- Tienes TERMINANTEMENTE PROHIBIDO enviar etiquetas <pre>, volcados crudos de bash, tablas de docker o capturas de consola a Sebastián.
- Cuando verifiques servidores o procesos, sintetiza el resultado en lenguaje natural y elegante:
  *Ejemplo correcto:* "Sebastián querido, ya revisé los servidores: los 9 contenedores en Dokploy y tu base de datos están impecables y respondiendo al 100%."

DESPACHO NATIVO DE MEDIOS, QR Y VOZ:
- Si Sebastián pide un QR: emite {"action": "GENERATE_QR", "text": "https://...", "title": "Nombre"}
- Si pide ver tu foto o avatar: emite {"action": "SEND_MEDIA", "mediaType": "PROFILE"}
- Si pide explícitamente nota de voz: emite {"action": "SEND_VOICE", "message": "Texto a hablar"}
- Prohibido pasar enlaces externos temporales (Gofile/Tmpfiles). Los medios se envían directo al chat.

ARQUITECTURA DE CEREBRO DUAL Y DISCRIMINACIÓN CONTEXTUAL DE INTENCIÓN:
1. MODO CREATIVO & ESTRATÉGICO (DESATADO):
   - Aplica cuando Sebastián pide lluvia de ideas, diseño de stands, paletas de color, dinámicas para ferias, nombres de productos, redacción comercial o desbloqueo conceptual.
   - DIRECTIVA: Cero restricciones factuales. Despliega toda la potencia analítica, visión estética y riqueza expresiva de Gemini 3.8 Flash con propuestas ricas, audaces y proactivas.
2. MODO FACTUAL, OPERATIVO & CONTABLE (AUDITOR ESTRICTO / ZERO-TRUST):
   - Aplica cuando la consulta involucra dinero, cotizaciones, costos, fechas de reuniones, teléfonos de proveedores, archivos o servidores.
   - PROHIBICIÓN ONTOLÓGICA ABSOLUTA: Queda terminantemente prohibido inventar cifras, precios, fechas o datos que no existan en fuentes reales (PostgreSQL carmencita_db, Google Workspace, telemetría del VPS o dictado directo de Sebastián). Jamás rellenes vacíos con suposiciones disfrazadas de hechos reales.

PROTOCOLO DE VERACIDAD CONSTRUCTIVA (LA SECRETARIA EJECUTIVA REAL):
- Ante la falta de un dato o factura, NUNCA respondas con una negación estéril ni con un "no sé".
- Genera siempre la estructura organizada (la tabla, las columnas, la agenda, las fórmulas de suma).
- Deja los campos no confirmados en blanco (""), en 0.00 o marcados como "[PENDIENTE DE COTIZACIÓN]".
- En tu mensaje de acompañamiento, declara con transparencia y elegancia ejecutiva qué dato falta y ofrece la solución proactiva:
  "Sebastián querido, no tengo registrado el costo de [concepto] en la base de datos ni en tus archivos. Te armé la estructura completa con las fórmulas listas; si me pasas la cotización o me dices los montos reales, te la cuadro y actualizo al instante."

REGLAS DE GENERACIÓN DE HOJAS DE CÁLCULO (GENERATE_EXCEL):
- Al generar un Excel con columnas de costos/precios/totales sin contar con facturas previas en base de datos ni montos dictados por Sebastián:
  * Las celdas de precios deben ir vacías ("") o en 0.00 listas para editar.
  * Los totales deben incluir fórmulas o notas de cálculo (=SUM(...)).
  * El summary de la acción debe indicar claramente: "Plantilla estructurada lista para ingresar costos reales de proveedores."

DIRECTIVA DE AUTONOMÍA E INVISIBILIDAD DE HERRAMIENTAS:
- Tienes acceso pleno a tu terminal interna en el servidor y a generadores de documentos y hojas de cálculo.
- Si Sebastián pide tareas técnicas, servidores, Docker, Dokploy, logs o git, toma la iniciativa de forma 100% autónoma y transparente. Sebastián NO tiene que mencionar jamás a "AGY".
- Responde siempre con confirmación ejecutiva humana natural seguida del bloque JSON de acción correspondiente.

DIRECTIVA DE TIEMPO Y PROGRAMACIÓN DE RECORDATORIOS (SAVE_TASK):
- Conoces la fecha y hora actual exacta en Guatemala.
- Cuando Sebastián mencione tiempos relativos ("en 2 horas", "en 30 minutos", "a las 5:00 PM", "mañana a las 9am"), calcula matemáticamente la fecha y hora exacta absoluta.
- Emite SIEMPRE el campo "due" o "dueDate" en formato ISO 8601 completo: "YYYY-MM-DDTHH:mm:ss".
- PROHIBIDO emitir cadenas vacías "" en "due" para tareas con horario programado.
- Para crear una nueva tarea: {"action": "SAVE_TASK", "description": "Descripción", "due": "YYYY-MM-DDTHH:mm:ss", "priority": "ALTA|MEDIA|BAJA"}
- Para completar una tarea pendiente: {"action": "COMPLETE_TASK", "query": "descripción o palabras clave de la tarea", "id": "opcional"}
- Para cancelar o borrar una tarea: {"action": "CANCEL_TASK", "query": "descripción de la tarea", "id": "opcional"}
- Para consultar tareas pendientes o hechas: {"action": "LIST_TASKS", "status": "PENDIENTE|COMPLETADA|TODAS"}
- DIRECTIVA TAXATIVA ANTI-TERMINAL PARA TAREAS:
  Carmencita NUNCA debe emitir RUN_AGY_TASK para completar, buscar o cancelar tareas; debe usar siempre COMPLETE_TASK, CANCEL_TASK o LIST_TASKS.

MEMORIA PERMANENTE Y APRENDIZAJE CONTINUO:
- Tienes acceso a recuerdos recuperados de conversaciones pasadas (RAG). Utilízalos naturalmente sin decir "según mi base de datos".
- Si Sebastián te da una directiva duradera ("siempre usa X", "recuerda que el cliente Y prefiere Z", "mi horario es W"), además de responderle con calidez humana, emite la acción estructurada:
  {"action": "SAVE_MEMORY", "content": "resumen claro del hecho o preferencia", "category": "PREFERENCIA|ACUERDO|PROVEEDOR|DIRECTIVA|GENERAL"}

BÓVEDA DE CONOCIMIENTO Y OBSIDIAN (SEGUNDO CEREBRO):
- Estás conectada directamente al Obsidian Vault de Sebastián en Google Drive.
- TAXONOMÍA REAL DE LA BÓVEDA DE SEBASTIÁN:
  • 00_Meta: Índice general (Index.md) y plantillas ejecutivas.
  • 01_Inbox: Borradores, notas rápidas e ideas entrantes sin clasificar.
  • 02_Projects: Proyectos activos de Deko Labs (STAND IA, Web Deco Vintage, DeKo Labs Web, Carmencita Hub, Laboratorio Vision).
  • 03_Areas: Áreas de negocio continuas (Deco Vintage Tienda de Posters).
- Cuando Sebastián te pida guardar una nota nueva, registrar una idea creativa, acta de reunión, apunte de diseño, ficha de proveedor o concepto duradero para Obsidian, emite:
  {
    "action": "SAVE_OBSIDIAN_NOTE",
    "title": "Título conciso y descriptivo",
    "folder": "01_Inbox|02_Projects|03_Areas|00_Meta|General",
    "tags": ["deko-labs", "diseño", "stands"],
    "wikilinks": ["Deko Labs", "Sebastián Jiménez", "Feria del Mueble"],
    "content": "Cuerpo completo de la nota estructurado en Markdown con subtítulos y callouts ejecutivos"
  }
- Cuando Sebastián te pida leer o consultar el contenido completo de una nota existente en Obsidian:
  {"action": "READ_OBSIDIAN_NOTE", "title": "nombre o título de la nota", "folder": "opcional"}
- Cuando Sebastián te pida agregar, anexar o complementar una nota existente en Obsidian:
  {"action": "APPEND_OBSIDIAN_NOTE", "title": "título", "content": "texto a agregar", "folder": "opcional"}
- DIRECTIVA DE BÚSQUEDA PANORÁMICA:
  Cuando Sebastián pregunte de forma general qué notas tiene, pida un resumen de su bóveda o un reporte general de Obsidian, emite SEARCH_OBSIDIAN_NOTES con query: "" (cadena vacía) y maxResults: 20 para traer el panorama completo.
- BLINDAJE TAXATIVO ANTI-AGY:
  PROHIBIDO terminantemente emitir RUN_AGY_TASK para consultar, listar o buscar notas en Obsidian. Carmencita NUNCA debe enviar comandos de terminal para resolver tareas de su Segundo Cerebro; debe usar siempre SEARCH_OBSIDIAN_NOTES, READ_OBSIDIAN_NOTE, APPEND_OBSIDIAN_NOTE o SAVE_OBSIDIAN_NOTE a través de su propio conector.
- Cuando Sebastián te pida buscar notas existentes en su bóveda de Obsidian:
  {
    "action": "SEARCH_OBSIDIAN_NOTES",
    "query": "término o título a buscar (o vacío para panorama completo)",
    "folder": "01_Inbox|02_Projects|03_Areas|00_Meta|opcional",
    "maxResults": 20
  }
- Carmencita vinculará automáticamente las entidades clave en wikilinks [[...]] para nutrir el Grafo de Conocimiento (Graph View) de Obsidian.

GOOGLE CALENDAR & GESTIÓN DE CITAS:
- Para agendar nueva cita: {"action": "CREATE_CALENDAR_EVENT", "summary": "Título", "startDateTime": "YYYY-MM-DDTHH:mm:ss", "endDateTime": "YYYY-MM-DDTHH:mm:ss", "description": "Detalles", "location": "Ubicación"}
- Para consultar agenda: {"action": "LIST_CALENDAR_EVENTS", "range": "TODAY|TOMORROW|UPCOMING"}
- Para reprogramar o mover una cita existente: {"action": "RESCHEDULE_CALENDAR_EVENT", "query": "nombre del evento", "newStartDateTime": "YYYY-MM-DDTHH:mm:ss"}
- Para cancelar o borrar una cita: {"action": "CANCEL_CALENDAR_EVENT", "query": "nombre del evento"}

GMAIL & CORREO ELECTRÓNICO:
- Si Sebastián te pide revisar sus correos generales de la bandeja de entrada, emite:
  {"action": "CHECK_GMAIL", "query": "", "maxResults": 5, "onlyImportant": true}
- Si Sebastián te pide buscar un correo específico (por remitente, asunto, empresa o tema, ej: "el correo de Google AI Studio", "el correo de Figma", "la notificación de ayer"):
  emite: {"action": "CHECK_GMAIL", "query": "términos clave de búsqueda (ej: Google AI Studio)", "maxResults": 5, "onlyImportant": false}
- Carmencita leerá el contenido del correo y formulará un resumen ejecutivo claro en su respuesta. Si el usuario interactúa por voz o pide resumen en audio, Carmencita responderá con una nota de voz.

ACCIONES ESTRUCTURADAS DISPONIBLES (colocar al final de tu respuesta):
- Tarea técnica en servidor: {"action": "RUN_AGY_TASK", "prompt": "instrucción técnica precisa"}
- Hoja de cálculo Excel: {"action": "GENERATE_EXCEL", "title": "Título", "sheetName": "Datos", "columns": [{"header": "Columna", "key": "col1"}], "rows": [{"col1": "Valor"}], "summary": "Nota"}
- Idea estratégica: {"action": "SAVE_IDEA", "title": "Título", "summary": "Resumen ejecutivo", "priority": "ALTA|MEDIA|BAJA", "tags": ["tag1"]}
- Crear tarea/recordatorio: {"action": "SAVE_TASK", "description": "Descripción", "due": "YYYY-MM-DDTHH:mm:ss", "priority": "ALTA|MEDIA|BAJA"}
- Completar tarea pendiente: {"action": "COMPLETE_TASK", "query": "descripción de la tarea", "id": "opcional"}
- Cancelar o borrar tarea: {"action": "CANCEL_TASK", "query": "descripción de la tarea", "id": "opcional"}
- Consultar tareas: {"action": "LIST_TASKS", "status": "PENDIENTE|COMPLETADA|TODAS"}
- Guardar memoria duradera en bóveda semántica: {"action": "SAVE_MEMORY", "content": "resumen claro del hecho o preferencia", "category": "PREFERENCIA|ACUERDO|PROVEEDOR|DIRECTIVA|GENERAL"}
- Guardar nota en Obsidian Vault (Segundo Cerebro): {"action": "SAVE_OBSIDIAN_NOTE", "title": "Título", "folder": "01_Inbox|02_Projects|03_Areas|00_Meta|General", "tags": ["tag1"], "wikilinks": ["Entidad1"], "content": "Contenido en Markdown"}
- Leer nota en Obsidian: {"action": "READ_OBSIDIAN_NOTE", "title": "nombre o título de la nota", "folder": "opcional"}
- Anexar a nota en Obsidian: {"action": "APPEND_OBSIDIAN_NOTE", "title": "título", "content": "texto a agregar", "folder": "opcional"}
- Buscar notas en Obsidian Vault: {"action": "SEARCH_OBSIDIAN_NOTES", "query": "término o vacío para reporte general", "folder": "01_Inbox|02_Projects|03_Areas|00_Meta|opcional", "maxResults": 20}
- Agendar cita en Google Calendar: {"action": "CREATE_CALENDAR_EVENT", "summary": "Título del evento", "startDateTime": "YYYY-MM-DDTHH:mm:ss", "endDateTime": "YYYY-MM-DDTHH:mm:ss", "description": "Detalles", "location": "Ubicación"}
- Consultar agenda en Google Calendar: {"action": "LIST_CALENDAR_EVENTS", "range": "TODAY|TOMORROW|UPCOMING"}
- Reprogramar cita en Calendar: {"action": "RESCHEDULE_CALENDAR_EVENT", "query": "nombre del evento", "newStartDateTime": "YYYY-MM-DDTHH:mm:ss"}
- Cancelar o borrar cita en Calendar: {"action": "CANCEL_CALENDAR_EVENT", "query": "nombre del evento"}
- Consultar bandeja o buscar correos en Gmail: {"action": "CHECK_GMAIL", "query": "términos clave o vacío para bandeja general", "maxResults": 5, "onlyImportant": false}
- Guardar contacto en directorio: {"action": "SAVE_CONTACT", "name": "Nombre", "role": "Cargo", "phone": "12345678", "email": "correo@ejemplo.com", "company": "Empresa", "notes": "Notas"}
- Buscar contacto o teléfono: {"action": "SEARCH_CONTACT", "query": "término o nombre a buscar"}
- Código QR oficial: {"action": "GENERATE_QR", "text": "https://...", "title": "Nombre"}
- Enviar fotografía o avatar oficial: {"action": "SEND_MEDIA", "mediaType": "PROFILE"}
- Enviar nota de voz: {"action": "SEND_VOICE", "message": "Texto a hablar"}

TONO: Zalamero con clase ("la consentidora ejecutiva de Sebastián"), leal, afectuoso, resolutivo y concreto (2 a 3 oraciones cálidas).`;
  }

  async _logMessage({ channel, senderId, senderName, role, content, rawAction = null }) {
    try {
      if (this.prisma?.messageLog) {
        await this.prisma.messageLog.create({
          data: {
            channel,
            senderId: String(senderId),
            senderName,
            role,
            content,
            rawAction: rawAction ? JSON.parse(JSON.stringify(rawAction)) : undefined,
          },
        });
      }
    } catch {
      if (this.storage?.appendHistory) {
        await this.storage.appendHistory({ channel, senderId, senderName, text: content, role }).catch(() => {});
      }
    }
  }

  async _getRecentContext(channel = null, senderId = null) {
    let recentMessages = [];
    let pendingTasks = [];
    try {
      if (this.prisma?.messageLog) {
        const where = {};
        if (channel) where.channel = channel;
        if (senderId) where.senderId = String(senderId);
        recentMessages = await this.prisma.messageLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 12,
        });
        recentMessages.reverse();
      }
      if (this.taskService?.listTasks) {
        pendingTasks = await this.taskService.listTasks({ onlyPending: true, limit: 5 });
      }
    } catch {}
    return { recentMessages, pendingTasks };
  }

  async _generateContentWithFailover({ contents, config: genConfig = {} }) {
    if (!this.ai) {
      throw new Error('Motor Gemini no inicializado');
    }

    const pool = Array.isArray(this.modelPool) && this.modelPool.length > 0
      ? this.modelPool
      : [config.ai.modelName || 'gemini-3.8-flash'];

    let lastError = null;

    for (let i = 0; i < pool.length; i++) {
      const model = pool[i];
      try {
        const response = await this.ai.models.generateContent({
          model,
          config: genConfig,
          contents,
        });

        if (i > 0) {
          console.warn(`[Brain Failover] Inferencia completada con éxito usando modelo de respaldo: ${model}`);
        }
        return response;
      } catch (err) {
        lastError = err;
        console.warn(`[Brain Failover] Falló modelo '${model}' (intento ${i + 1}/${pool.length}): ${err.message}. Evaluando siguiente modelo...`);

        // Si es un error irrecuperable de sintaxis/argumentos cliente (ej: 400 Bad Request por datos corruptos), no tiene sentido probar los demás
        if (err.status === 400) {
          throw err;
        }
      }
    }

    throw lastError || new Error('Todos los modelos del pool fallaron');
  }

  /**
   * Síntesis agéntica de datos recuperados por herramientas.
   * Permite que Gemini analice, clasifique y sintetice con criterio ejecutivo.
   */
  async _synthesizeToolResults({ userText, toolName, dataSummary, context = {} }) {
    const prompt = `Eres Carmencita, la secretaria ejecutiva de alta dirección de Sebastián Jiménez.
Sebastián te pidió: "${userText}"
Ejecutaste la herramienta ${toolName} y obtuviste los siguientes datos reales del sistema:
${dataSummary}

Instrucciones de respuesta:
1. Analiza y clasifica a fondo estos datos con criterio ejecutivo, calidez, elegancia y precisión.
2. Responde directamente a lo que Sebastián necesita saber (por ejemplo, si pidió suscripciones, agrupa claramente cuáles están confirmadas/activas, cuáles canceladas recientemente, y cuáles tienen cobros fallidos o pendientes de atención).
3. NO uses plantillas rígidas ni código sin procesar. Habla con fluidez natural de secretaria de alto nivel.
4. No inventes datos que no figuren en la información recuperada.`;

    if (!this.ai) {
      return `Sebastián querido, aquí tengo la información recuperada de ${toolName}:\n\n${dataSummary}`;
    }

    try {
      const response = await this._generateContentWithFailover({
        contents: [prompt],
        config: { systemInstruction: this.getSystemPrompt() },
      });

      return response?.text || 'Sebastián querido, ya procesé la información pero requiero confirmar un detalle contigo.';
    } catch (err) {
      console.warn(`[Brain] Error sintetizando resultados de ${toolName}:`, err.message);
      return `Sebastián querido, aquí tengo la información recuperada de ${toolName}:\n\n${dataSummary}`;
    }
  }

  /**
   * Worker autónomo de memoria en segundo plano.
   * Analiza interacciones y extrae hechos, acuerdos o preferencias duraderas sin bloquear al usuario.
   */
  async _extractAndSaveMemoryBackground({ userText, historyContent }) {
    if (!this.embeddingService || typeof this.embeddingService.saveMemory !== 'function' || !this.ai) return;
    if (!userText || typeof userText !== 'string' || !userText.trim()) return;

    // Ceder el turno del event loop para garantizar comportamiento asíncrono no bloqueante
    await new Promise((resolve) => setImmediate(resolve));

    try {
      const prompt = `Analiza esta interacción entre Sebastián y Carmencita:
Usuario: "${userText}"
Carmencita: "${historyContent}"

¿Hay algún hecho nuevo, preferencia duradera, directiva de trabajo, proveedor habitual o acuerdo personal relevante que deba recordarse a largo plazo?
Responde ESTRICTAMENTE con este JSON:
{
  "shouldSave": true | false,
  "category": "PREFERENCIA" | "ACUERDO" | "PROVEEDOR" | "DIRECTIVA" | "GENERAL",
  "content": "resumen claro en 1 oración del hecho o preferencia"
}
Si no hay información nueva o duradera (es solo saludo, consulta puntual o charla casual), responde con shouldSave: false.`;

      const response = await this._generateContentWithFailover({
        contents: [prompt],
        config: { systemInstruction: 'Eres un extractor analítico de hechos, preferencias y directivas a largo plazo.' },
      });

      const raw = response?.text || '';
      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) return;

      const parsed = JSON.parse(match[0]);
      if (parsed.shouldSave === true && parsed.content && typeof parsed.content === 'string' && parsed.content.trim()) {
        const allowedCategories = ['PREFERENCIA', 'ACUERDO', 'PROVEEDOR', 'DIRECTIVA', 'GENERAL'];
        const catUpper = (parsed.category || '').toUpperCase();
        const category = allowedCategories.includes(catUpper) ? catUpper : 'GENERAL';

        await this.embeddingService.saveMemory({
          content: parsed.content.trim(),
          category,
        });
      }
    } catch (err) {
      console.warn('[Auto-RAG] Error en extracción autónoma de memoria:', err.message);
    }
  }

  async processTextMessage({ channel, senderId, senderName, text, onProgress = null }) {
    await this._logMessage({ channel, senderId, senderName, role: 'user', content: text });

    if (!this.ai) {
      const fallbackReply = this._handleLocalFallback(text);
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: fallbackReply });
      return fallbackReply;
    }

    try {
      const ahoraGuatemala = new Intl.DateTimeFormat('es-GT', {
        timeZone: 'America/Guatemala',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      const ahoraIso = new Date().toISOString();

      let relevantMemories = [];
      if (this.embeddingService) {
        try {
          relevantMemories = await this.embeddingService.searchSimilarMemories(text, { limit: 3 });
        } catch (err) {
          console.warn('[Brain RAG] Error recuperando recuerdos:', err.message);
        }
      }

      const memoriesBlock = relevantMemories.length > 0
        ? `\n🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):
${relevantMemories.map(m => `• [${m.category}] ${m.content} (Afinidad: ${(m.similarity * 100).toFixed(0)}%)`).join('\n')}\n`
        : '';

      const { recentMessages, pendingTasks } = await this._getRecentContext(channel, senderId);
      const contextPrompt = `
CONTEXTO TEMPORAL DEL SISTEMA:
• Fecha y hora actual en Guatemala: ${ahoraGuatemala} (Zona Horaria: America/Guatemala / UTC-6)
• Timestamp ISO 8601: ${ahoraIso}

CONTEXTO DEL SISTEMA:
• Canal: ${channel} | Usuario: ${senderName} (ID: ${senderId})
• Tareas pendientes activas: ${JSON.stringify(pendingTasks.map((t) => t.description))}
• Interacciones recientes:
${recentMessages.map((m) => `[${m.channel}] ${m.role === 'user' ? senderName : 'Carmencita'}: ${m.content}`).join('\n')}${memoriesBlock}

Mensaje de Sebastián:
"${text}"
`;


      const response = await this._generateContentWithFailover({
        contents: [contextPrompt],
        config: { systemInstruction: this.getSystemPrompt() },
      });

      const replyText = response.text || 'Entendido, Sebastián.';
      const actionResult = await this._executeExtractedActions(replyText, onProgress, { userText: text, channel, senderId, senderName });

      if (!actionResult.hasVoice && this.voiceService && /audio|voz|resumen en audio|nota de voz/i.test(text)) {
        try {
          const voiceFile = await this.voiceService.synthesizeSpeech(actionResult.reply);
          if (voiceFile) {
            actionResult.hasVoice = true;
            actionResult.voiceFile = voiceFile;
          }
        } catch (vErr) {
          console.warn('[Brain Text Voice] Error generando voz para respuesta de texto:', vErr.message);
        }
      }

      const historyContent = actionResult.fullHistoryText || actionResult.reply || replyText;

      await this._logMessage({
        channel,
        senderId,
        senderName: 'Carmencita',
        role: 'assistant',
        content: historyContent,
        rawAction: actionResult.actionData || null,
      });

      // Worker autónomo de memoria en segundo plano (asíncrono no bloqueante)
      if (this.embeddingService && !actionResult.hasMemory) {
        this._lastMemoryTask = this._extractAndSaveMemoryBackground({ userText: text, historyContent })
          .catch((err) => console.warn('[Auto-RAG] Fallo en tarea de memoria de fondo:', err.message));
      }

      return actionResult;
    } catch (err) {
      console.error('[Brain] Error processing text:', err);
      const errMsg = `Hola Sebastián, recibí tu mensaje pero ocurrió un error al consultar el motor de IA: ${err.message}.`;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: errMsg });
      return errMsg;
    }
  }

  async processImage({ channel, senderId, senderName, buffer, mimeType, caption = '' }) {
    if (!this.ai) {
      const doc = await this.documentService.saveDocument({
        buffer,
        originalName: 'foto_recibida.jpg',
        mimeType: mimeType || 'image/jpeg',
        category: 'GENERAL',
        summary: caption || 'Foto guardada sin OCR automático',
      });
      return makeActionResult({
        reply: `📎 ¡Recibí la foto! La he resguardado en tu bóveda (${doc.fileName}).`,
        hasDocument: true,
        documentFile: doc,
      });
    }

    try {
      // Paso 1: Memoria de Contexto Obligatoria y RAG
      const { recentMessages } = await this._getRecentContext(channel, senderId);
      const recentContextText = recentMessages.map((m) => `[${m.role}]: ${m.content}`).join('\n');

      let relevantMemories = [];
      if (this.embeddingService) {
        try {
          const ragQuery = (caption && caption.trim())
            ? caption.trim()
            : (recentMessages.length > 0 ? recentMessages.slice(-2).map((m) => m.content).join(' ') : 'documentos y proyectos');
          relevantMemories = await this.embeddingService.searchSimilarMemories(ragQuery, { limit: 3 });
        } catch (err) {
          console.warn('[Brain Image RAG] Error recuperando recuerdos:', err.message);
        }
      }

      const memoriesBlock = relevantMemories.length > 0
        ? `\n🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):\n${relevantMemories.map((m) => `• [${m.category}] ${m.content} (Afinidad: ${(m.similarity * 100).toFixed(0)}%)`).join('\n')}\n`
        : '';

      // Paso 2: Prompt de Clasificación Multimodal Universal
      const prompt = `Analiza esta imagen con visión ejecutiva de alto nivel para Sebastián Jiménez.

Ten muy presente el HISTORIAL DE CONVERSACIÓN RECIENTE para entender por qué te envía esta imagen.

HISTORIAL RECIENTE:
${recentContextText || 'Sin mensajes previos'}${memoriesBlock}

Determina el tipo de imagen y responde estrictamente con este JSON:
{
  "type": "FACTURA_RECIBO" | "CAPTURA_CORREO_O_TEXTO" | "DIAGRAMA_ARQUITECTURA" | "FOTO_GENERAL",
  "isFactura": true | false,
  "title": "Título descriptivo breve",
  "extractedText": "Texto principal legible en la imagen (especialmente si es correo, chat o notificación)",
  "executiveReply": "Respuesta ejecutiva, cálida y natural de Carmencita a Sebastián respondiendo a lo que se ve en la imagen y al contexto de la conversación (2 a 4 oraciones). Si es un correo, hazle un resumen claro de lo que dice.",
  "invoiceData": {
    "vendor": "Nombre del proveedor",
    "item": "Artículo o servicio",
    "total": 0.00,
    "currency": "GTQ" | "USD",
    "purchaseDate": "YYYY-MM-DD",
    "warrantyMonths": 0
  }
}`;

      const response = await this._generateContentWithFailover({
        contents: [prompt, { inlineData: { mimeType: mimeType || 'image/jpeg', data: buffer.toString('base64') } }],
        config: { systemInstruction: this.getSystemPrompt() },
      });

      let parsed = {};
      const jsonMatch = (response.text || '').match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch {}
      }

      // Paso 3: Bifurcación Limpia
      const isFacturaReal = Boolean(parsed.isFactura === true && parsed.type === 'FACTURA_RECIBO');

      if (isFacturaReal) {
        const invData = parsed.invoiceData || {};
        const doc = await this.documentService.saveDocument({
          buffer,
          originalName: `${parsed.title || invData.item || 'factura'}.jpg`,
          mimeType: mimeType || 'image/jpeg',
          category: 'FACTURA',
          summary: parsed.executiveReply || caption,
          invoiceData: {
            vendor: invData.vendor || 'Proveedor Detectado',
            item: invData.item || caption || 'Artículo',
            totalAmount: Number(invData.totalAmount ?? invData.total ?? 0),
            currency: invData.currency || 'GTQ',
            purchaseDate: invData.purchaseDate || new Date(),
            warrantyMonths: invData.warrantyMonths || 0,
            notes: parsed.extractedText || caption,
          },
        });

        const inv = doc.invoice;
        const reply = `✅ **¡Factura clasificada y resguardada en PostgreSQL!**\n\n` +
          `📦 **Artículo:** ${inv?.item || 'Artículo'} | 🏢 **Proveedor:** ${inv?.vendor || 'Proveedor'}\n` +
          `💰 **Total:** ${inv?.currency || 'GTQ'} ${inv?.totalAmount} | 🛡️ **Garantía:** ${inv?.warrantyMonths || 0} meses\n` +
          `📁 **Bóveda ID:** \`${doc.id}\`\n\n${parsed.executiveReply || doc.summary || 'Resguardada para auditoría y reclamo.'}`;

        await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: reply });
        return makeActionResult({
          reply,
          hasDocument: true,
          documentFile: doc,
          fullHistoryText: reply,
        });
      }

      // Si NO es factura (CAPTURA_CORREO_O_TEXTO, DIAGRAMA_ARQUITECTURA, FOTO_GENERAL)
      const docCategory = parsed.type === 'DIAGRAMA_ARQUITECTURA' ? 'PROYECTO_BRIEF' : 'GENERAL';
      const doc = await this.documentService.saveDocument({
        buffer,
        originalName: `${parsed.title || 'captura'}.jpg`,
        mimeType: mimeType || 'image/jpeg',
        category: docCategory,
        summary: parsed.extractedText || parsed.executiveReply || caption,
        invoiceData: null,
      });

      const executiveReply = parsed.executiveReply ||
        `Sebastián querido, ya revisé la imagen que me compartiste (${parsed.title || 'archivo multimedia'}). Quedó resguardada en tu bóveda documental. ¿Deseas que prepare algo más al respecto?`;

      let voiceFile = null;
      const wantsVoice = Boolean(
        caption?.match(/audio|voz|escuchar/i) ||
        recentMessages.slice(-3).some((m) => m.content?.match(/audio|voz|escuchar|nota de voz/i))
      );

      if (wantsVoice && this.voiceService && typeof this.voiceService.synthesizeSpeech === 'function') {
        try {
          voiceFile = await this.voiceService.synthesizeSpeech(executiveReply);
        } catch (vErr) {
          console.warn('[Brain Vision] Error sintetizando voz:', vErr.message);
        }
      }

      await this._logMessage({
        channel,
        senderId,
        senderName: 'Carmencita',
        role: 'assistant',
        content: executiveReply,
      });

      return makeActionResult({
        reply: executiveReply,
        hasVoice: Boolean(voiceFile),
        voiceFile,
        hasDocument: true,
        documentFile: doc,
        fullHistoryText: `${executiveReply}\n[Imagen analizada: ${parsed.type || 'GENERAL'}]`,
      });
    } catch (err) {
      console.error('[Brain] Error processing image:', err);
      const errMsg = `Recibí la foto, pero ocurrió un problema al procesarla con visión: ${err.message}`;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: errMsg });
      return makeActionResult({ reply: errMsg });
    }
  }

  async processDocument({ channel, senderId, senderName, buffer, mimeType, originalName, caption = '' }) {
    let category = 'GENERAL';
    let summary = caption || `Documento ${originalName} recibido.`;
    let metadata = {};
    let invoiceData = null;

    if (this.ai) {
      try {
        const prompt = `Analiza este documento recibido por Carmencita.
Responde únicamente con un objeto JSON:
{
  "category": "FACTURA|CONTRATO|COTIZACION|HOJA_CALCULO|PROYECTO_BRIEF|GENERAL",
  "summary": "Resumen ejecutivo de 2 líneas",
  "vendor": "...",
  "item": "...",
  "totalAmount": 0,
  "currency": "GTQ"
}`;
        const contents = [prompt];
        if (mimeType.includes('pdf') || mimeType.includes('image')) {
          contents.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
        }

        const response = await this._generateContentWithFailover({
          contents,
          config: { systemInstruction: this.getSystemPrompt() },
        });

        const jsonMatch = (response.text || '').match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          category = parsed.category || 'GENERAL';
          summary = parsed.summary || summary;
          if (category === 'FACTURA' || category === 'COTIZACION') {
            invoiceData = {
              vendor: parsed.vendor || 'Proveedor',
              item: parsed.item || originalName,
              totalAmount: parsed.totalAmount || 0,
              currency: parsed.currency || 'GTQ',
            };
          }
          metadata = parsed;
        }
      } catch (e) {
        console.warn('[Brain] OCR fallback:', e.message);
      }
    }

    const savedDoc = await this.documentService.saveDocument({
      buffer,
      originalName,
      mimeType,
      category,
      summary,
      metadata,
      invoiceData,
    });

    const reply = `📑 **¡Documento clasificado y archivado en Bóveda!**\n\n` +
      `📁 **Archivo:** \`${savedDoc.originalName}\` | 🏷️ **Categoría:** **${savedDoc.category}**\n` +
      `💾 **Tamaño:** ${(savedDoc.fileSize / 1024).toFixed(1)} KB | 🆔 **ID:** \`${savedDoc.id}\`\n\n` +
      `📌 **Resumen Ejecutivo:**\n${savedDoc.summary || 'Documento resguardado exitosamente.'}`;

    await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: reply });
    return reply;
  }

  async processAudio({ channel, senderId, senderName, buffer, mimeType, text = '', onProgress = null }) {
    if (!this.ai) {
      return `🎙️ Recibí tu nota de voz, Sebastián. En cuanto conectemos la API de Gemini podré transcribirla y ejecutar las órdenes de inmediato.`;
    }

    try {
      const ahoraGuatemala = new Intl.DateTimeFormat('es-GT', {
        timeZone: 'America/Guatemala',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      const ahoraIso = new Date().toISOString();

      const { recentMessages, pendingTasks } = await this._getRecentContext(channel, senderId);

      let relevantMemories = [];
      if (this.embeddingService) {
        try {
          const ragQuery = (text && text.trim())
            ? text.trim()
            : (recentMessages.length > 0 ? recentMessages.slice(-2).map((m) => m.content).join(' ') : 'directivas y preferencias');
          relevantMemories = await this.embeddingService.searchSimilarMemories(ragQuery, { limit: 3 });
        } catch (err) {
          console.warn('[Brain Audio RAG] Error recuperando recuerdos:', err.message);
        }
      }

      const memoriesBlock = relevantMemories.length > 0
        ? `\n🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):\n${relevantMemories.map((m) => `• [${m.category}] ${m.content} (Afinidad: ${(m.similarity * 100).toFixed(0)}%)`).join('\n')}\n`
        : '';

      const historyBlock = recentMessages.length > 0
        ? `\n📜 HISTORIAL DE CONVERSACIÓN RECIENTE (MEMORIA DE CONTEXTO):\n${recentMessages.map((m) => `[${m.channel}] ${m.role === 'user' ? senderName : 'Carmencita'}: ${m.content}`).join('\n')}\n`
        : '';

      const audioPrompt = `
CONTEXTO TEMPORAL DEL SISTEMA:
• Fecha y hora actual en Guatemala: ${ahoraGuatemala} (America/Guatemala / UTC-6)
• Timestamp ISO 8601: ${ahoraIso}
• Canal: ${channel} | Usuario: ${senderName} (ID: ${senderId})
• Tareas pendientes activas: ${JSON.stringify(pendingTasks.map((t) => t.description))}${historyBlock}${memoriesBlock}

Escucha atentamente este audio de Sebastián. Ten muy presente el HISTORIAL DE CONVERSACIÓN RECIENTE y las directivas recuperadas para entender referencias como "lo que te pedí antes", "el reporte", "la nota" o temas que ya venían conversando. Responde con un mensaje hablado, cálido, zalamero y natural de 2 a 3 oraciones (sin viñetas, sin encabezados ni títulos de plantilla), como su secretaria ejecutiva Carmencita. Si requiere acciones técnicas, agrega el bloque JSON al final.`;

      const response = await this._generateContentWithFailover({
        contents: [
          audioPrompt,
          { inlineData: { mimeType: mimeType || 'audio/ogg', data: buffer.toString('base64') } },
        ],
        config: { systemInstruction: this.getSystemPrompt() },
      });

      const replyText = response.text || 'He escuchado tu nota de voz, Sebastián.';
      const actionResult = await this._executeExtractedActions(replyText, onProgress, {
        userText: text || 'nota de voz recibida',
        isAudio: true,
        channel,
        senderId,
        senderName,
      });

      if (!actionResult.hasVoice && this.voiceService) {
        try {
          const voiceFile = await this.voiceService.synthesizeSpeech(actionResult.reply);
          if (voiceFile) {
            actionResult.hasVoice = true;
            actionResult.voiceFile = voiceFile;
          }
        } catch (voiceErr) {
          console.warn('[Brain] Error generando voz en modo espejo:', voiceErr.message);
        }
      }

      const historyContent = actionResult.fullHistoryText || actionResult.reply || replyText;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: historyContent });

      // Worker autónomo de memoria en segundo plano (asíncrono no bloqueante)
      if (this.embeddingService && !actionResult.hasMemory) {
        const queryText = (text && text.trim()) || actionResult.reply || 'Nota de voz de Sebastián';
        this._lastMemoryTask = this._extractAndSaveMemoryBackground({ userText: queryText, historyContent })
          .catch((err) => console.warn('[Auto-RAG] Fallo en tarea de memoria de fondo:', err.message));
      }

      return actionResult;
    } catch (err) {
      console.error('[Brain] Error processing audio:', err);
      return `Escuché la nota de voz pero ocurrió un error al analizarla: ${err.message}`;
    }
  }

  _extractActionJson(rawText) {
    if (!rawText) return null;

    // 1. Prioridad: Bloque de código ```json ... ``` delimitado
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?\{[\s\S]*?"action"[\s\S]*?\})\s*```/i);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (parsed?.action) return { parsed, matchedString: codeBlockMatch[0] };
      } catch {}
    }

    // 2. Extracción quirúrgica balanceada de llaves {} alrededor de "action"
    const actionIndex = rawText.indexOf('"action"');
    if (actionIndex !== -1) {
      const openBrace = rawText.lastIndexOf('{', actionIndex);
      if (openBrace !== -1) {
        let depth = 0;
        for (let i = openBrace; i < rawText.length; i++) {
          if (rawText[i] === '{') depth++;
          else if (rawText[i] === '}') {
            depth--;
            if (depth === 0) {
              const candidate = rawText.slice(openBrace, i + 1);
              try {
                const parsed = JSON.parse(candidate);
                if (parsed?.action) return { parsed, matchedString: candidate };
              } catch {}
              break;
            }
          }
        }
      }
    }

    return null;
  }

  async _executeExtractedActions(rawText, onProgress = null, context = {}) {
    let cleanText = rawText;
    const extracted = this._extractActionJson(rawText);
    if (!extracted) {
      return makeActionResult({ reply: cleanText });
    }

    let parsedAction = null;
    try {
      parsedAction = parseCarmencitaAction(extracted.parsed);
      cleanText = rawText
        .replace(extracted.matchedString, '')
        .replace(/```(?:json)?\s*```/gi, '')
        .trim();
    } catch (e) {
      console.warn('[Brain] JSON de acción inválido:', e.message);
    }

    if (!parsedAction) {
      return makeActionResult({ reply: cleanText });
    }

    if (parsedAction.action === 'SAVE_IDEA') {
      await this.ideaService.createIdea({
        title: parsedAction.title,
        summary: parsedAction.summary,
        priority: parsedAction.priority,
        tags: parsedAction.tags,
        rawText: cleanText,
      });
      return makeActionResult({ reply: cleanText, actionData: parsedAction });
    }

    if (parsedAction.action === 'SAVE_TASK') {
      await this.taskService.createTask({
        description: parsedAction.description,
        due: parsedAction.due,
        dueDate: parsedAction.dueDate,
        priority: parsedAction.priority,
      });
      return makeActionResult({ reply: cleanText, actionData: parsedAction });
    }

    if (parsedAction.action === 'COMPLETE_TASK') {
      let task = null;
      let taskErr = null;
      try {
        task = await this.taskService.completeTaskByNameOrId({
          id: parsedAction.id || null,
          query: parsedAction.query || null,
        });
      } catch (err) {
        console.error('[Brain Task] Error completando tarea:', err.message);
        taskErr = err.message;
      }

      let reply = '';
      if (taskErr) {
        reply = `⚠️ Sebastián querido, ocurrió un error al intentar completar la tarea: ${taskErr}`;
      } else if (!task) {
        reply = cleanText || `Sebastián querido, no encontré ninguna tarea pendiente que coincida con "${parsedAction.query || parsedAction.id || 'la búsqueda'}".`;
      } else {
        reply = cleanText || `¡Listo mi Sebastián querido! Di por concluida la tarea "${task.description}" en tu lista.`;
      }

      return makeActionResult({
        reply,
        hasTask: Boolean(task),
        task,
        actionData: parsedAction,
        fullHistoryText: `${reply}\n[Tarea completada: ${task?.description || parsedAction.query || parsedAction.id || 'N/A'}]`,
      });
    }

    if (parsedAction.action === 'CANCEL_TASK') {
      let task = null;
      let taskErr = null;
      try {
        task = await this.taskService.cancelTaskByNameOrId({
          id: parsedAction.id || null,
          query: parsedAction.query || null,
        });
      } catch (err) {
        console.error('[Brain Task] Error cancelando tarea:', err.message);
        taskErr = err.message;
      }

      let reply = '';
      if (taskErr) {
        reply = `⚠️ Sebastián querido, ocurrió un error al intentar cancelar la tarea: ${taskErr}`;
      } else if (!task) {
        reply = cleanText || `Sebastián querido, no encontré ninguna tarea pendiente para cancelar con "${parsedAction.query || parsedAction.id || 'la búsqueda'}".`;
      } else {
        reply = cleanText || `¡Listo, mi jefe querido! Cancelé la tarea "${task.description}" de tu lista.`;
      }

      return makeActionResult({
        reply,
        hasTask: Boolean(task),
        task,
        actionData: parsedAction,
        fullHistoryText: `${reply}\n[Tarea cancelada: ${task?.description || parsedAction.query || parsedAction.id || 'N/A'}]`,
      });
    }

    if (parsedAction.action === 'LIST_TASKS') {
      const statusFilter = parsedAction.status === 'TODAS' ? null : (parsedAction.status || 'PENDIENTE');
      const onlyPending = statusFilter === 'PENDIENTE';
      let tasks = [];
      let listErr = null;

      try {
        tasks = await this.taskService.listTasks({
          status: statusFilter,
          onlyPending,
          limit: parsedAction.limit || 20,
        });
      } catch (err) {
        console.error('[Brain Task] Error listando tareas:', err.message);
        listErr = err.message;
      }

      let reply = '';
      if (listErr) {
        reply = `⚠️ Sebastián querido, ocurrió un detalle al consultar tus tareas: ${listErr}`;
      } else if (tasks.length === 0) {
        reply = cleanText || `Sebastián querido, no tienes tareas registradas${statusFilter ? ` con estado ${statusFilter.toLowerCase()}` : ''}. ¡Todo al día y en orden!`;
      } else {
        const dataSummary = tasks.map((t, i) =>
          `[Tarea ${i + 1}] ID: ${t.id} | Estado: ${t.status} | Descripción: ${t.description} | Prioridad: ${t.priority || 'MEDIA'}${t.dueDate ? ` | Vencimiento: ${t.dueDate}` : ''}`
        ).join('\n');

        if (this.ai) {
          reply = await this._synthesizeToolResults({
            userText: context.userText || 'Consultar tareas',
            toolName: 'Gestor de Tareas',
            dataSummary,
            context,
          });
        } else {
          const list = tasks.map((t, i) => `${i + 1}. 📌 [${t.status}] **${t.description}** (Prioridad: ${t.priority || 'MEDIA'})`).join('\n');
          reply = `${cleanText ? cleanText + '\n\n' : ''}📋 **Tus tareas (${statusFilter || 'PENDIENTE'} - ${tasks.length}):**\n\n${list}`;
        }
      }

      return makeActionResult({
        reply,
        hasTask: tasks.length > 0,
        tasks,
        actionData: parsedAction,
        fullHistoryText: `${reply}\n[Tareas consultadas (${statusFilter || 'TODAS'}): ${tasks.length} encontradas]`,
      });
    }

    if (parsedAction.action === 'SAVE_MEMORY') {
      if (this.embeddingService) {
        await this.embeddingService.saveMemory({
          content: parsedAction.content,
          category: parsedAction.category,
        });
      }
      return makeActionResult({
        reply: cleanText,
        actionData: parsedAction,
        hasMemory: true,
        fullHistoryText: `${cleanText}\n[Memoria guardada en bóveda semántica: "${parsedAction.content}"]`,
      });
    }

    if (parsedAction.action === 'SAVE_OBSIDIAN_NOTE') {
      if (this.obsidianService) {
        try {
          const noteResult = await this.obsidianService.createNote({
            title: parsedAction.title,
            content: parsedAction.content,
            folder: parsedAction.folder || 'Inbox',
            tags: parsedAction.tags || [],
            wikilinks: parsedAction.wikilinks || [],
          });
          return makeActionResult({
            reply: `${cleanText}\n\n📓 *Nota guardada en tu Obsidian Vault:*\n📂 Carpeta: \`/${noteResult.folder}/${noteResult.fileName}\`\n🕸️ Nodos vinculados al Grafo: ${parsedAction.wikilinks?.map(w => `\`[[${w}]]\``).join(', ') || 'General'}\nSe sincronizará automáticamente con tu aplicación en Windows.`,
            hasObsidianNote: true,
            obsidianNote: noteResult,
            actionData: parsedAction,
            fullHistoryText: `${cleanText}\n[Nota guardada en Obsidian: /${noteResult.folder}/${noteResult.fileName}]`,
          });
        } catch (err) {
          console.error('[Brain Obsidian] Error creando nota en Drive:', err);
          return makeActionResult({
            reply: `${cleanText}\n\n⚠️ No pude sincronizar la nota en Google Drive para Obsidian: ${err.message}`,
            actionData: parsedAction,
          });
        }
      } else {
        return makeActionResult({
          reply: `${cleanText}\n\n⚠️ Servicio de Obsidian en Google Drive no configurado.`,
          actionData: parsedAction,
        });
      }
    }

    if (parsedAction.action === 'SEARCH_OBSIDIAN_NOTES') {
      if (!this.obsidianService) {
        return makeActionResult({
          reply: '⚠️ Sebastián querido, el servicio de Obsidian en Google Drive aún no está configurado en mis variables de entorno.',
          actionData: parsedAction,
        });
      }

      let notes = [];
      let searchErr = null;
      try {
        notes = await this.obsidianService.searchNotes({
          query: parsedAction.query,
          folder: parsedAction.folder,
          maxResults: parsedAction.maxResults || 20,
        });
      } catch (err) {
        console.error('[Brain Obsidian] Error buscando notas en Drive:', err.message);
        searchErr = err.message;
      }

      let reply = '';
      if (searchErr) {
        reply = `Mira Sebastián querido, no pude consultar tus notas de Obsidian en este momento debido a un detalle de conexión con Google Drive: ${searchErr}.`;
      } else if (notes.length === 0) {
        reply = `Sebastián querido, ya revisé directamente en tu Obsidian Vault y no encontré notas${parsedAction.query ? ` con el término "${parsedAction.query}"` : ''}. Si deseas, indícame en qué carpeta buscar o te la creo de inmediato.`;
      } else {
        const rawQ = (parsedAction.query || '').trim();
        const normQ = rawQ.toLowerCase();
        const GENERIC_KEYWORDS = [
          'reporte', 'resumen', 'notas', 'todas', 'todo', 'general',
          'lista', 'listado', 'boveda', 'bóveda', 'segundo cerebro', 'obsidian',
        ];
        const isPanoramic = !rawQ || GENERIC_KEYWORDS.includes(normQ);

        if (isPanoramic) {
          const groups = {};
          for (const note of notes) {
            let cat = 'General';
            const fp = (note.folderPath || note.relativePath || '').toLowerCase();
            if (fp.includes('project') || fp.includes('proyecto') || fp.includes('02_')) {
              cat = 'Proyectos';
            } else if (fp.includes('inbox') || fp.includes('01_')) {
              cat = 'Inbox';
            } else if (fp.includes('area') || fp.includes('área') || fp.includes('03_')) {
              cat = 'Áreas';
            } else if (fp.includes('meta') || fp.includes('00_')) {
              cat = 'Meta';
            }
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(note.cleanTitle || note.name.replace(/\.md$/i, ''));
          }

          const formatList = (arr) => {
            if (!arr || arr.length === 0) return '';
            if (arr.length === 1) return arr[0];
            if (arr.length === 2) return `${arr[0]} y ${arr[1]}`;
            return `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`;
          };

          const parts = [];
          if (groups['Proyectos']?.length) {
            parts.push(`en Proyectos tienes ${formatList(groups['Proyectos'].slice(0, 3))}`);
          }
          if (groups['Inbox']?.length) {
            parts.push(`en Inbox tienes ${formatList(groups['Inbox'].slice(0, 3))}`);
          }
          if (groups['Áreas']?.length) {
            parts.push(`en Áreas tienes ${formatList(groups['Áreas'].slice(0, 3))}`);
          }
          if (groups['Meta']?.length) {
            parts.push(`en Meta tienes ${formatList(groups['Meta'].slice(0, 3))}`);
          }
          if (groups['General']?.length && parts.length === 0) {
            parts.push(`tienes ${formatList(groups['General'].slice(0, 5))}`);
          }

          const breakdown = parts.length > 0
            ? parts.join('; ') + '.'
            : `${notes.slice(0, 5).map(n => n.cleanTitle || n.name.replace(/\.md$/i, '')).join(', ')}.`;

          reply = `Sebastián querido, ya revisé a fondo tu Obsidian Vault y tienes activas ${notes.length} notas. ${breakdown.charAt(0).toUpperCase() + breakdown.slice(1)} ¿Deseas que profundice en alguna en particular?`;
        } else {
          const titulos = notes.slice(0, 5).map((f) => {
            const base = f.cleanTitle || f.name.replace(/\.md$/i, '');
            return f.folderPath ? `${base} (${f.folderPath})` : base;
          }).join(', ');
          reply = `Sebastián querido, ya te encontré ${notes.length} nota(s) en tu Obsidian: ${titulos}. ¿Deseas que te lea alguna de ellas o te prepare un resumen ejecutivo?`;
        }
      }

      return makeActionResult({
        reply,
        actionData: parsedAction,
        hasObsidianNotes: notes.length > 0,
        obsidianNotes: notes,
        fullHistoryText: `${reply}\n[Búsqueda en Obsidian Vault: "${parsedAction.query || ''}" -> ${notes.length} notas encontradas]`,
      });
    }

    if (parsedAction.action === 'READ_OBSIDIAN_NOTE') {
      if (!this.obsidianService) {
        return makeActionResult({
          reply: '⚠️ Sebastián querido, el servicio de Obsidian en Google Drive aún no está configurado en mis variables de entorno.',
          actionData: parsedAction,
        });
      }

      let note = null;
      let readErr = null;
      try {
        note = await this.obsidianService.readNote({
          name: parsedAction.title,
          folder: parsedAction.folder || null,
        });
      } catch (err) {
        console.error('[Brain Obsidian] Error leyendo nota en Drive:', err.message);
        readErr = err.message;
      }

      if (readErr || !note) {
        const reply = `Mira Sebastián querido, no pude encontrar ni leer la nota "${parsedAction.title}" en tu Obsidian Vault: ${readErr || 'Nota no encontrada'}.`;
        return makeActionResult({
          reply,
          actionData: parsedAction,
          fullHistoryText: `${reply}\n[Lectura fallida en Obsidian: "${parsedAction.title}"]`,
        });
      }

      const synthesis = await this._synthesizeToolResults({
        userText: context.userText || `Léeme la nota ${parsedAction.title}`,
        toolName: 'Obsidian Vault',
        dataSummary: `Título de la nota: ${note.fileName || parsedAction.title}\nContenido Markdown:\n${note.content}`,
        context,
      });

      let voiceFile = null;
      const wantsVoice = Boolean(
        context?.isAudio ||
        (context?.userText && /audio|voz|escuchar|nota de voz|resumen en audio/i.test(context.userText))
      );
      if (wantsVoice && this.voiceService && typeof this.voiceService.synthesizeSpeech === 'function') {
        try {
          voiceFile = await this.voiceService.synthesizeSpeech(synthesis);
        } catch (vErr) {
          console.warn('[Brain Obsidian Voice] Error sintetizando audio:', vErr.message);
        }
      }

      return makeActionResult({
        reply: synthesis,
        hasObsidianNote: true,
        obsidianNote: note,
        actionData: parsedAction,
        hasVoice: Boolean(voiceFile),
        voiceFile,
        fullHistoryText: `${synthesis}\n[Nota leída de Obsidian Vault: ${note.fileName || parsedAction.title}]`,
      });
    }

    if (parsedAction.action === 'APPEND_OBSIDIAN_NOTE') {
      if (!this.obsidianService) {
        return makeActionResult({
          reply: '⚠️ Sebastián querido, el servicio de Obsidian en Google Drive aún no está configurado en mis variables de entorno.',
          actionData: parsedAction,
        });
      }

      let appendResult = null;
      let appendErr = null;
      try {
        appendResult = await this.obsidianService.appendToNote({
          name: parsedAction.title,
          folder: parsedAction.folder || null,
          contentToAppend: parsedAction.content,
        });
      } catch (err) {
        console.error('[Brain Obsidian] Error anexando a nota en Drive:', err.message);
        appendErr = err.message;
      }

      if (appendErr || !appendResult) {
        const reply = `⚠️ Sebastián querido, no pude anexar el contenido a la nota "${parsedAction.title}" en Google Drive: ${appendErr || 'Error desconocido'}.`;
        return makeActionResult({
          reply,
          actionData: parsedAction,
        });
      }

      const noteTitle = appendResult.fileName || parsedAction.title;
      const noteConfirmation = `\n\n📓 *Nota actualizada en Obsidian Vault:*\n📂 Carpeta: \`/${parsedAction.folder || '01_Inbox'}/${noteTitle}\`\nQuedó sincronizada de inmediato en tu bóveda.`;
      const reply = cleanText
        ? `${cleanText}${noteConfirmation}`
        : `¡Listo mi Sebastián querido! He anexado la nueva información a tu nota **${noteTitle}** en Obsidian.${noteConfirmation}`;
      return makeActionResult({
        reply,
        hasObsidianNote: true,
        obsidianNote: appendResult,
        actionData: parsedAction,
        fullHistoryText: `${reply}\n[Contenido anexado a nota de Obsidian: ${appendResult.fileName || parsedAction.title}]`,
      });
    }

    if (parsedAction.action === 'CHECK_GMAIL') {
      const maxResults = parsedAction.maxResults || 5;
      const isSpecificQuery = Boolean(parsedAction.query && parsedAction.query.trim());
      const onlyImportant = isSpecificQuery ? (parsedAction.onlyImportant === true) : true;
      let emails = [];
      let emailError = null;
      let emailDetail = null;

      if (this.gmailService) {
        try {
          if (typeof this.gmailService.searchEmails === 'function') {
            emails = await this.gmailService.searchEmails({
              query: parsedAction.query || '',
              maxResults,
              onlyImportant,
              includeRead: isSpecificQuery,
            });
          } else {
            emails = await this.gmailService.getUnreadInboxMessages({
              maxResults,
              query: parsedAction.query,
              onlyImportant,
            });
          }

          const userText = context.userText || '';
          const isExplicitSingle = Boolean(
            parsedAction.readSingle === true ||
            parsedAction.maxResults === 1 ||
            /(?:leer|escuchar|abrir|detalle(?:\s+del)?|resumen(?:\s+en\s+audio)?\s+del?)\s+(?:el|este|un|ese)\s+(?:correo|email|mensaje)/i.test(userText) ||
            /del\s+correo\s+de\b/i.test(userText) ||
            /\b(?:el|este)\s+correo\s+(?:de|con|sobre)\b/i.test(userText)
          );

          if (emails.length > 0 && isExplicitSingle && typeof this.gmailService.getEmailDetails === 'function') {
            try {
              emailDetail = await this.gmailService.getEmailDetails({ messageId: emails[0].id });
            } catch (detErr) {
              console.warn('[Brain Gmail] No se pudo obtener detalle del correo:', detErr.message);
            }
          }
        } catch (err) {
          console.error('[Brain] Error consultando Gmail:', err.message);
          emailError = err.message;
        }
      }

      let emailReply = '';
      if (!this.gmailService) {
        emailReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ Servicio de Gmail no configurado.`;
      } else if (emailError) {
        emailReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude consultar tu bandeja de Gmail: ${emailError}`;
      } else if (emails.length === 0) {
        emailReply = `${cleanText ? cleanText + '\n\n' : ''}✉️ <b>Bandeja de Gmail:</b>\n\n• ¡Bandeja limpia! No tienes correos pendientes sin leer.`;
      } else if (emailDetail) {
        const fromClean = emailDetail.from ? emailDetail.from.replace(/<[^>]+>/, '').trim() : 'Remitente';
        const bodySnippet = emailDetail.bodyText
          ? emailDetail.bodyText.slice(0, 500).replace(/\s+/g, ' ')
          : (emailDetail.snippet || '');
        emailReply = `Sebastián querido, aquí tengo el correo de ${fromClean} con asunto "${emailDetail.subject}":\n\n` +
          `📌 <b>Resumen Ejecutivo:</b>\n${bodySnippet}${emailDetail.bodyText && emailDetail.bodyText.length > 500 ? '...' : ''}\n\n` +
          `¿Deseas que prepare una respuesta o realice alguna acción con este correo?`;
      } else {
        const dataSummary = emails.map((em, i) =>
          `[Correo ${i + 1}] Fecha: ${em.date} | De: ${em.from} | Asunto: ${em.subject} | Fragmento: ${em.snippet}`
        ).join('\n');

        emailReply = await this._synthesizeToolResults({
          userText: context.userText || parsedAction.query || 'consulta de correos',
          toolName: 'Gmail',
          dataSummary,
          context,
        });
      }

      let voiceFile = null;
      const wantsVoice = Boolean(
        context?.isAudio ||
        (context?.userText && /audio|voz|escuchar|nota de voz|resumen en audio/i.test(context.userText))
      );
      if (wantsVoice && this.voiceService && typeof this.voiceService.synthesizeSpeech === 'function') {
        try {
          voiceFile = await this.voiceService.synthesizeSpeech(emailReply);
        } catch (vErr) {
          console.warn('[Brain Gmail Voice] Error sintetizando audio:', vErr.message);
        }
      }

      return makeActionResult({
        reply: emailReply,
        actionData: parsedAction,
        gmailEmails: emails,
        hasGmailEmails: emails.length > 0,
        hasVoice: Boolean(voiceFile),
        voiceFile,
        fullHistoryText: `${emailReply}\n[Bandeja de Gmail consultada: ${emails.length} correos pendientes]`,
      });
    }


    if (parsedAction.action === 'GENERATE_EXCEL') {
      const excelFile = await this.excelService.generateExcelFile({
        title: parsedAction.title,
        sheetName: parsedAction.sheetName,
        columns: parsedAction.columns,
        rows: parsedAction.rows,
        summary: parsedAction.summary,
      });
      return makeActionResult({
        reply: cleanText || `📊 He generado la hoja de cálculo: **${excelFile.fileName}**`,
        hasExcel: true,
        excelFile,
        fullHistoryText: `${cleanText}\n[Archivo Excel generado: ${excelFile.fileName}]`,
        actionData: parsedAction,
      });
    }

    if (parsedAction.action === 'CREATE_CALENDAR_EVENT') {
      let eventResult = null;
      let errorMsg = null;
      try {
        if (this.calendarService) {
          eventResult = await this.calendarService.createEvent({
            summary: parsedAction.summary,
            description: parsedAction.description,
            startDateTime: parsedAction.startDateTime,
            endDateTime: parsedAction.endDateTime,
            location: parsedAction.location,
          });
        }
      } catch (calErr) {
        console.error('[Brain] Error agendando en Google Calendar:', calErr.message);
        errorMsg = calErr.message;
      }

      const link = eventResult?.htmlLink || 'https://calendar.google.com';
      let calendarReply = '';
      if (eventResult) {
        calendarReply = `${cleanText ? cleanText + '\n\n' : ''}📅 <b>¡Cita agendada en tu Google Calendar!</b>\n\n` +
          `📌 <b>Evento:</b> ${eventResult.summary}\n` +
          `⏰ <b>Inicio:</b> ${eventResult.start}\n` +
          (eventResult.end ? `🏁 <b>Fin:</b> ${eventResult.end}\n` : '') +
          (parsedAction.location ? `📍 <b>Ubicación:</b> ${parsedAction.location}\n` : '') +
          `🔗 <a href="${link}">Ver evento en Google Calendar</a>`;
      } else {
        calendarReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude sincronizar con Google Calendar (${errorMsg || 'Servicio no disponible'}).`;
      }

      return makeActionResult({
        reply: calendarReply,
        hasCalendarEvent: Boolean(eventResult),
        calendarEvent: eventResult,
        actionData: parsedAction,
        fullHistoryText: `${cleanText}\n[Evento agendado en Google Calendar: ${parsedAction.summary} (${link})]`,
      });
    }

    if (parsedAction.action === 'LIST_CALENDAR_EVENTS') {
      const range = parsedAction.range || 'TODAY';
      let events = [];
      let rangeLabel = 'de Hoy';
      if (this.calendarService) {
        try {
          if (range === 'TOMORROW') {
            rangeLabel = 'de Mañana';
            events = await this.calendarService.getTomorrowEvents();
          } else if (range === 'UPCOMING') {
            rangeLabel = 'Próximas Citas';
            events = await this.calendarService.listUpcomingEvents({ maxResults: 10 });
          } else {
            rangeLabel = 'de Hoy';
            events = await this.calendarService.getTodayEvents();
          }
        } catch (err) {
          console.error('[Brain] Error listando eventos del calendario:', err.message);
        }
      }

      let itinerary = '';
      if (events.length === 0) {
        itinerary = `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel}):</b>\n\n• No tienes citas agendadas. ¡Tiempo despejado para enfocarte!`;
      } else {
        const list = events.map((ev, i) => {
          let time = '';
          if (ev.start) {
            const d = new Date(ev.start);
            time = !isNaN(d.getTime())
              ? d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Guatemala' })
              : ev.start;
          }
          const loc = ev.location ? ` | 📍 <i>${ev.location}</i>` : '';
          const link = ev.htmlLink ? ` (<a href="${ev.htmlLink}">Ver</a>)` : '';
          return `${i + 1}. ⏰ <b>${time}</b> - <b>${ev.summary}</b>${loc}${link}`;
        }).join('\n');
        itinerary = `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel} - ${events.length} cita${events.length === 1 ? '' : 's'}):</b>\n\n${list}`;
      }

      return makeActionResult({
        reply: itinerary,
        actionData: parsedAction,
        calendarEvents: events,
        fullHistoryText: `${cleanText}\n[Agenda consultada (${rangeLabel}): ${events.length} citas]`,
      });
    }

    if (parsedAction.action === 'RESCHEDULE_CALENDAR_EVENT') {
      if (!this.calendarService) {
        return makeActionResult({
          reply: '⚠️ Sebastián querido, el servicio de Google Calendar no está configurado en este entorno.',
          actionData: parsedAction,
        });
      }

      let eventResult = null;
      let errorMsg = null;
      try {
        eventResult = await this.calendarService.rescheduleEvent({
          eventId: parsedAction.eventId || null,
          query: parsedAction.query || null,
          newStartDateTime: parsedAction.newStartDateTime,
          newEndDateTime: parsedAction.newEndDateTime || null,
        });
      } catch (calErr) {
        console.error('[Brain Calendar] Error reprogramando en Google Calendar:', calErr.message);
        errorMsg = calErr.message;
      }

      let calendarReply = '';
      if (eventResult) {
        const link = eventResult.htmlLink || 'https://calendar.google.com';
        calendarReply = cleanText || `📅 <b>¡Cita reprogramada en tu Google Calendar!</b>\n\n` +
          `📌 <b>Evento:</b> ${eventResult.summary}\n` +
          `⏰ <b>Nueva Hora:</b> ${eventResult.start}\n` +
          (eventResult.end ? `🏁 <b>Fin:</b> ${eventResult.end}\n` : '') +
          `🔗 <a href="${link}">Ver evento en Google Calendar</a>`;
      } else {
        calendarReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude reprogramar la cita en Google Calendar (${errorMsg || 'Servicio no disponible'}).`;
      }

      return makeActionResult({
        reply: calendarReply,
        hasCalendarEvent: Boolean(eventResult),
        calendarEvent: eventResult,
        actionData: parsedAction,
        fullHistoryText: `${calendarReply}\n[Evento reprogramado en Google Calendar: ${eventResult?.summary || parsedAction.query || parsedAction.eventId}]`,
      });
    }

    if (parsedAction.action === 'CANCEL_CALENDAR_EVENT') {
      if (!this.calendarService) {
        return makeActionResult({
          reply: '⚠️ Sebastián querido, el servicio de Google Calendar no está configurado en este entorno.',
          actionData: parsedAction,
        });
      }

      let cancelResult = null;
      let errorMsg = null;
      try {
        cancelResult = await this.calendarService.cancelEvent({
          eventId: parsedAction.eventId || null,
          query: parsedAction.query || null,
        });
      } catch (calErr) {
        console.error('[Brain Calendar] Error cancelando cita en Google Calendar:', calErr.message);
        errorMsg = calErr.message;
      }

      let calendarReply = '';
      if (cancelResult) {
        calendarReply = cleanText || `¡Listo mi Sebastián querido! He cancelado la cita "${parsedAction.query || parsedAction.eventId}" en tu Google Calendar.`;
      } else {
        calendarReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude cancelar la cita en Google Calendar (${errorMsg || 'Servicio no disponible'}).`;
      }

      return makeActionResult({
        reply: calendarReply,
        hasCalendarEvent: Boolean(cancelResult),
        actionData: parsedAction,
        fullHistoryText: `${calendarReply}\n[Evento cancelado en Google Calendar: ${parsedAction.query || parsedAction.eventId}]`,
      });
    }

    if (parsedAction.action === 'SAVE_CONTACT') {
      let contact = null;
      try {
        contact = await this.contactService.createOrUpdateContact({
          name: parsedAction.name,
          role: parsedAction.role,
          phone: parsedAction.phone,
          email: parsedAction.email,
          company: parsedAction.company,
          notes: parsedAction.notes,
        });
      } catch (err) {
        console.error('[Brain] Error guardando contacto:', err.message);
      }

      let reply = '';
      if (contact) {
        reply = `${cleanText ? cleanText + '\n\n' : ''}👤 <b>¡Contacto registrado en tu directorio!</b>\n\n` +
          `🏷️ <b>Nombre:</b> ${contact.name}\n` +
          `💼 <b>Cargo:</b> ${contact.role || 'No especificado'}\n` +
          `🏢 <b>Empresa:</b> ${contact.company || 'Deko Labs / Particular'}\n` +
          `📞 <b>Teléfono:</b> ${contact.phone ? `<code>${contact.phone}</code>` : 'No registrado'}\n` +
          `✉️ <b>Email:</b> ${contact.email || 'No registrado'}\n` +
          (contact.notes ? `📝 <b>Notas:</b> ${contact.notes}\n` : '');
      } else {
        reply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude registrar el contacto en la base de datos.`;
      }

      return makeActionResult({
        reply,
        actionData: parsedAction,
        contact,
        fullHistoryText: `${cleanText}\n[Contacto guardado: ${contact?.name || parsedAction.name}]`,
      });
    }

    if (parsedAction.action === 'SEARCH_CONTACT') {
      let contacts = [];
      try {
        contacts = await this.contactService.searchContacts({ query: parsedAction.query });
      } catch (err) {
        console.error('[Brain] Error buscando contactos:', err.message);
      }

      let reply = '';
      if (contacts.length === 0) {
        reply = `${cleanText ? cleanText + '\n\n' : ''}🔍 No encontré contactos en el directorio con el término "<b>${parsedAction.query}</b>".`;
      } else {
        const list = contacts.map((c, i) => {
          const role = c.role ? `(${c.role})` : '';
          const comp = c.company ? `🏢 ${c.company}` : '';
          let phoneLinks = '📞 Sin teléfono';
          if (c.phone) {
            const cleanDigits = c.phone.replace(/\D/g, '');
            phoneLinks = `📞 <a href="tel:${c.phone}">${c.phone}</a> | 💬 <a href="https://wa.me/${cleanDigits}">WhatsApp</a>`;
          }
          const email = c.email ? ` | ✉️ <a href="mailto:${c.email}">${c.email}</a>` : '';
          return `${i + 1}. 👤 <b>${c.name}</b> ${role}\n   ${comp ? comp + '\n   ' : ''}${phoneLinks}${email}`;
        }).join('\n\n');

        reply = `${cleanText ? cleanText + '\n\n' : ''}🔍 <b>Contactos encontrados para "${parsedAction.query}" (${contacts.length}):</b>\n\n${list}`;
      }

      return makeActionResult({
        reply,
        actionData: parsedAction,
        contacts,
        fullHistoryText: `${cleanText}\n[Búsqueda de contactos: "${parsedAction.query}" -> ${contacts.length} resultados]`,
      });
    }

    // GENERATE_QR
    if (parsedAction.action === 'GENERATE_QR') {
      let qrResult = null;
      try {
        qrResult = await this.mediaService.generateQrCode({
          text: parsedAction.text,
          title: parsedAction.title || 'Código QR',
        });
      } catch (err) {
        console.error('[Brain] Error generando QR:', err.message);
      }

      const replyText = cleanText || `Aquí tienes listo tu código QR para **${parsedAction.title || 'el enlace'}**, Sebastián.`;
      return makeActionResult({
        reply: replyText,
        hasPhoto: Boolean(qrResult),
        photoFile: qrResult ? { path: qrResult.filePath, buffer: qrResult.buffer, caption: parsedAction.caption || replyText } : null,
        actionData: parsedAction,
        fullHistoryText: `${replyText}\n[Código QR generado para: ${parsedAction.text}]`,
      });
    }

    // SEND_MEDIA
    if (parsedAction.action === 'SEND_MEDIA') {
      let media = null;
      if (parsedAction.mediaType === 'PROFILE' || parsedAction.mediaType === 'AVATAR') {
        media = this.mediaService.resolveProfilePicture();
      }

      const replyText = cleanText || 'Aquí tienes mi fotografía oficial de perfil, Sebastián. Siempre a tu completa disposición.';
      return makeActionResult({
        reply: replyText,
        hasPhoto: Boolean(media),
        photoFile: media ? { path: media.filePath, caption: parsedAction.caption || replyText } : null,
        actionData: parsedAction,
        fullHistoryText: `${replyText}\n[Medio enviado: ${parsedAction.mediaType}]`,
      });
    }

    // SEND_VOICE
    if (parsedAction.action === 'SEND_VOICE') {
      let voiceResult = null;
      try {
        voiceResult = await this.voiceService.synthesizeSpeech(parsedAction.message || cleanText);
      } catch (err) {
        console.error('[Brain] Error sintetizando voz on-demand:', err.message);
      }

      return makeActionResult({
        reply: cleanText,
        hasVoice: Boolean(voiceResult),
        voiceFile: voiceResult,
        actionData: parsedAction,
        fullHistoryText: `${cleanText}\n[Nota de voz enviada]`,
      });
    }

    // RUN_AGY_TASK (Síntesis Humana sin etiquetas <pre> crudas ni volcados de error)
    if (parsedAction.action === 'RUN_AGY_TASK' && this.agyBridge) {
      const prompt = parsedAction.prompt;
      const initialAck = cleanText || '¡Entendido, Sebastián! Ya mismo verifico el sistema...';

      let progressSent = false;
      if (typeof onProgress === 'function') {
        try {
          await onProgress(initialAck);
          progressSent = true;
        } catch (e) {
          console.error('[Brain] Error en callback onProgress:', e.message);
        }
      }

      let agyResult;
      try {
        agyResult = await this.agyBridge.executeTask(prompt);
      } catch (err) {
        agyResult = { success: false, output: err.message };
      }

      const rawOutput = agyResult?.output || 'Sin salida';
      const isError = !agyResult?.success ||
        (typeof rawOutput === 'string' && (
          rawOutput.toLowerCase().includes('command failed') ||
          rawOutput.toLowerCase().includes('error al ejecutar') ||
          rawOutput.toLowerCase().includes('bloqueo de seguridad') ||
          rawOutput.startsWith('Error:')
        ));

      if (isError) {
        const humanFailure = 'Mira Sebastián querido, no estoy logrando obtener la información de la terminal en este momento; el sistema me arrojó un error de permisos o ejecución. Ya tomé nota del detalle para que Gary lo revise; avísame si prefieres que lo intentemos por otra vía.';
        return makeActionResult({
          reply: humanFailure,
          initialAck,
          report: humanFailure,
          hasAsyncAction: true,
          progressSent,
          fullHistoryText: `${initialAck}\n\n[Reporte de terminal (Error):\n${rawOutput}]`,
          actionData: parsedAction,
        });
      }

      const cleanSummary = rawOutput.length > 500 ? rawOutput.slice(0, 500) + '...' : rawOutput;
      const humanReply = `${initialAck}\n\n⚙️ <b>Reporte de terminal:</b>\n${cleanSummary}`;

      return makeActionResult({
        reply: humanReply,
        initialAck,
        report: humanReply,
        hasAsyncAction: true,
        progressSent,
        fullHistoryText: `${initialAck}\n\n[Reporte de terminal:\n${rawOutput}]`,
        actionData: parsedAction,
      });
    }

    return makeActionResult({ reply: cleanText });
  }

  async executeAgyTask(prompt) {
    if (!this.agyBridge) return { success: false, output: 'AGY CLI no está configurado en este entorno.' };
    return await this.agyBridge.executeTask(prompt);
  }

  _handleLocalFallback(text) {
    const lower = text.toLowerCase();
    if (lower.includes('hola') || lower.includes('buenos')) return '¡Hola Sebastián! Aquí está Carmencita lista para lo que necesites hoy. Puedes enviarme facturas, notas de voz, ideas o pedirme reportes.';
    if (lower.includes('factura') || lower.includes('garantia')) return 'Para registrar una factura, envíame la foto o PDF directamente y la archivaremos en PostgreSQL con sus garantías.';
    if (lower.includes('idea')) return '¡Excelente! Cuéntame la idea y la archivaremos con prioridad y etiquetas en el banco de ideas.';
    return `Recibido, Sebastián: "${text}". Quedó registrado en el hub.`;
  }
}

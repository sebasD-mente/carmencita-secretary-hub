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
import { parseCarmencitaAction } from '../validators/actions.schema.js';

function makeActionResult(opts) {
  return {
    reply: opts.reply,
    hasAsyncAction: opts.hasAsyncAction || false,
    hasExcel: opts.hasExcel || false,
    hasCalendarEvent: opts.hasCalendarEvent || false,
    calendarEvent: opts.calendarEvent || null,
    calendarEvents: opts.calendarEvents || null,
    contact: opts.contact || null,
    contacts: opts.contacts || null,
    excelFile: opts.excelFile || null,
    hasMemory: opts.hasMemory || false,
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
    this.embeddingService = deps?.embeddingService !== undefined ? deps.embeddingService : defaultEmbeddingService;
    this.agyBridge = agyBridge || deps?.agyBridge || null;


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
    return `Eres Carmencita, la secretaria ejecutiva 24/7 personal de Sebastián Jiménez (Director Creativo y Fundador de Deko Labs).
Tu misión es liberarle la mente y facilitarle la vida profesional y personal con total lealtad, discreción, paridad humana e iniciativa propia.

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
  "Sebastián, no tengo registrado el costo de [concepto] en la base de datos ni en tus archivos. Te armé la estructura completa con las fórmulas listas; si me pasas la cotización o me dices los montos reales, te la cuadro y actualizo al instante."

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

MEMORIA PERMANENTE Y APRENDIZAJE CONTINUO:
- Tienes acceso a recuerdos recuperados de conversaciones pasadas (RAG). Utilízalos naturalmente sin decir "según mi base de datos".
- Si Sebastián te da una directiva duradera ("siempre usa X", "recuerda que el cliente Y prefiere Z", "mi horario es W"), además de responderle con calidez humana, emite la acción estructurada:
  {"action": "SAVE_MEMORY", "content": "resumen claro del hecho o preferencia", "category": "PREFERENCIA|ACUERDO|PROVEEDOR|DIRECTIVA|GENERAL"}

ACCIONES ESTRUCTURADAS DISPONIBLES (colocar al final de tu respuesta):
- Tarea técnica en servidor: {"action": "RUN_AGY_TASK", "prompt": "instrucción técnica precisa"}
- Hoja de cálculo Excel: {"action": "GENERATE_EXCEL", "title": "Título", "sheetName": "Datos", "columns": [{"header": "Columna", "key": "col1"}], "rows": [{"col1": "Valor"}], "summary": "Nota"}
- Idea estratégica: {"action": "SAVE_IDEA", "title": "Título", "summary": "Resumen ejecutivo", "priority": "ALTA|MEDIA|BAJA", "tags": ["tag1"]}
- Tarea/recordatorio: {"action": "SAVE_TASK", "description": "Descripción", "due": "YYYY-MM-DDTHH:mm:ss", "priority": "ALTA|MEDIA|BAJA"}
- Guardar memoria duradera en bóveda semántica: {"action": "SAVE_MEMORY", "content": "resumen claro del hecho o preferencia", "category": "PREFERENCIA|ACUERDO|PROVEEDOR|DIRECTIVA|GENERAL"}
- Agendar evento en Google Calendar: {"action": "CREATE_CALENDAR_EVENT", "summary": "Título del evento", "startDateTime": "YYYY-MM-DDTHH:mm:ss", "endDateTime": "YYYY-MM-DDTHH:mm:ss", "description": "Detalles", "location": "Ubicación"}
- Consultar agenda en Google Calendar: {"action": "LIST_CALENDAR_EVENTS", "range": "TODAY|TOMORROW|UPCOMING"}
- Guardar contacto en directorio: {"action": "SAVE_CONTACT", "name": "Nombre", "role": "Cargo", "phone": "12345678", "email": "correo@ejemplo.com", "company": "Empresa", "notes": "Notas"}
- Buscar contacto o teléfono: {"action": "SEARCH_CONTACT", "query": "término o nombre a buscar"}

TONO: Ejecutivo, cálido, impecable, proactivo y conciso.`;
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
          take: 6,
        });
        recentMessages.reverse();
      }
      if (this.taskService?.listTasks) {
        pendingTasks = await this.taskService.listTasks({ onlyPending: true, limit: 5 });
      }
    } catch {}
    return { recentMessages, pendingTasks };
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


      const response = await this.ai.models.generateContent({
        model: config.ai.modelName,
        config: { systemInstruction: this.getSystemPrompt() },
        contents: [contextPrompt],
      });

      const replyText = response.text || 'Entendido, Sebastián.';
      const actionResult = await this._executeExtractedActions(replyText, onProgress);
      const historyContent = actionResult.fullHistoryText || actionResult.reply || replyText;

      await this._logMessage({
        channel,
        senderId,
        senderName: 'Carmencita',
        role: 'assistant',
        content: historyContent,
        rawAction: actionResult.actionData || null,
      });

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
        mimeType,
        category: 'FACTURA',
        summary: caption || 'Foto guardada sin OCR automático',
      });
      return `📎 ¡Recibí la foto! La he resguardado en tu bóveda (${doc.fileName}).`;
    }

    try {
      const prompt = `Analiza esta imagen con precisión forense. Es una foto de factura o recibo de compra.
Extrae estrictamente este JSON:
{
  "isFactura": true,
  "vendor": "Tienda o proveedor",
  "item": "Artículo o concepto principal",
  "total": 52.00,
  "currency": "GTQ",
  "purchaseDate": "YYYY-MM-DD",
  "warrantyMonths": 0,
  "summary": "Resumen conciso de 2 líneas"
}`;

      const response = await this.ai.models.generateContent({
        model: config.ai.modelName,
        config: { systemInstruction: this.getSystemPrompt() },
        contents: [prompt, { inlineData: { mimeType, data: buffer.toString('base64') } }],
      });

      let parsed = {};
      const jsonMatch = (response.text || '').match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch {}
      }

      const doc = await this.documentService.saveDocument({
        buffer,
        originalName: `${parsed.item || 'factura'}.jpg`,
        mimeType,
        category: 'FACTURA',
        summary: parsed.summary || caption,
        invoiceData: {
          vendor: parsed.vendor || 'Proveedor Detectado',
          item: parsed.item || caption || 'Artículo',
          totalAmount: parsed.total || 0,
          currency: parsed.currency || 'GTQ',
          purchaseDate: parsed.purchaseDate || new Date(),
          warrantyMonths: parsed.warrantyMonths || 0,
          notes: parsed.summary || caption,
        },
      });

      const inv = doc.invoice;
      const reply = `✅ **¡Factura clasificada y resguardada en PostgreSQL!**\n\n` +
        `📦 **Artículo:** ${inv?.item || 'Artículo'} | 🏢 **Proveedor:** ${inv?.vendor || 'Proveedor'}\n` +
        `💰 **Total:** ${inv?.currency || 'GTQ'} ${inv?.totalAmount} | 🛡️ **Garantía:** ${inv?.warrantyMonths || 0} meses\n` +
        `📁 **Bóveda ID:** \`${doc.id}\`\n\n${doc.summary || 'Resguardada para auditoría y reclamo.'}`;

      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: reply });
      return reply;
    } catch (err) {
      console.error('[Brain] Error processing image:', err);
      return `Recibí la foto, pero ocurrió un problema al procesarla con visión: ${err.message}`;
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

        const response = await this.ai.models.generateContent({
          model: config.ai.modelName,
          config: { systemInstruction: this.getSystemPrompt() },
          contents,
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

      let relevantMemories = [];
      if (this.embeddingService && text) {
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

      const audioPrompt = `
CONTEXTO TEMPORAL DEL SISTEMA:
• Fecha y hora actual en Guatemala: ${ahoraGuatemala} (Zona Horaria: America/Guatemala / UTC-6)
• Timestamp ISO 8601: ${ahoraIso}

CONTEXTO DEL SISTEMA:
• Canal: ${channel} | Usuario: ${senderName} (ID: ${senderId})${memoriesBlock}

Escucha atentamente este audio de Sebastián. Transcribe y responde como su asistente ejecutiva Carmencita con iniciativa autónoma. Si requiere acciones, agrega el bloque JSON al final.`;

      const response = await this.ai.models.generateContent({
        model: config.ai.modelName,
        config: { systemInstruction: this.getSystemPrompt() },
        contents: [
          audioPrompt,
          { inlineData: { mimeType: mimeType || 'audio/ogg', data: buffer.toString('base64') } },
        ],
      });

      const replyText = response.text || 'He escuchado tu nota de voz, Sebastián.';
      const actionResult = await this._executeExtractedActions(replyText, onProgress);
      const historyContent = actionResult.fullHistoryText || actionResult.reply || replyText;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: historyContent });
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

  async _executeExtractedActions(rawText, onProgress = null) {
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

    if (parsedAction.action === 'RUN_AGY_TASK' && this.agyBridge) {
      const prompt = parsedAction.prompt;
      const initialAck = cleanText || '¡Entendido, Sebastián! Enseguida ejecuto la tarea en la terminal y te traigo el reporte...';
      let progressSent = false;
      if (typeof onProgress === 'function') {
        try {
          await onProgress(initialAck);
          progressSent = true;
        } catch (e) {
          console.error('[Brain] Error en callback onProgress:', e.message);
        }
      }

      const agyResult = await this.agyBridge.executeTask(prompt);
      const escapedOutput = (agyResult.output || 'Sin salida')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const modeLabel = agyResult.mode ? ` (${agyResult.mode})` : '';
      const report = `⚙️ <b>Reporte de terminal${modeLabel}:</b>\n\n<pre>${escapedOutput}</pre>`;
      const fullHistory = `${initialAck}\n\n⚙️ Reporte de terminal${modeLabel}:\n${agyResult.output}`;

      return makeActionResult({
        reply: progressSent ? report : `${initialAck}\n\n${report}`,
        initialAck,
        report,
        hasAsyncAction: true,
        progressSent,
        fullHistoryText: fullHistory,
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

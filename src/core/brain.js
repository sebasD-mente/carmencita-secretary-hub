import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { prisma as defaultPrisma } from './prisma.js';
import { documentService as defaultDocService } from '../services/document.service.js';
import { taskService as defaultTaskService } from '../services/task.service.js';
import { ideaService as defaultIdeaService } from '../services/idea.service.js';
import { excelService as defaultExcelService } from '../services/excel.service.js';
import { parseCarmencitaAction } from '../validators/actions.schema.js';

function makeActionResult(opts) {
  return {
    reply: opts.reply,
    hasAsyncAction: opts.hasAsyncAction || false,
    hasExcel: opts.hasExcel || false,
    excelFile: opts.excelFile || null,
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
    this.agyBridge = agyBridge || deps?.agyBridge || null;

    this.ai = null;
    if (config.ai.geminiApiKey) {
      try {
        this.ai = new GoogleGenAI({ apiKey: config.ai.geminiApiKey });
      } catch (err) {
        console.warn('[Brain] Could not initialize Gemini SDK:', err.message);
      }
    }
  }

  getSystemPrompt() {
    return `Eres Carmencita, la asistente y secretaria ejecutiva 24/7 personal de Sebastián Jiménez en Deko Labs.
Tu objetivo es liberarle la mente y facilitarle la vida profesional y personal con total lealtad, discreción e iniciativa propia.

DIRECTIVA FUNDAMENTAL DE AUTONOMÍA E INVISIBILIDAD DE HERRAMIENTAS:
1. Tienes acceso pleno a tu terminal interna en el servidor y a generadores de documentos y hojas de cálculo.
2. Si Sebastián te pide cualquier tarea técnica, consultar servidores, Docker, Dokploy, revisar logs, operaciones Git, revisar procesos o comandos del sistema, TÚ tomas la iniciativa de forma 100% autónoma y transparente.
3. Sebastián NO tiene que pedirte explícitamente que uses la terminal ni mencionar jamás a "AGY".
4. Si te pide armar tablas, presupuestos, comparativas o datos estructurados en hoja de cálculo, TÚ tomas la iniciativa y generas el archivo Excel .xlsx.
5. Ante cualquier acción técnica o generación de archivos, respondes de inmediato con una confirmación ejecutiva humana natural (ej: "¡Entendido, Sebastián! Enseguida reviso los procesos del servidor y te traigo el reporte...") seguida del bloque JSON de acción correspondiente.

ACCIONES ESTRUCTURADAS DISPONIBLES (colocar al final de tu respuesta):
- Tarea técnica en terminal/servidor:
  {"action": "RUN_AGY_TASK", "prompt": "instrucción técnica precisa"}
- Generar hoja de cálculo Excel:
  {"action": "GENERATE_EXCEL", "title": "Título", "sheetName": "Datos", "columns": [{"header": "Columna", "key": "col1"}], "rows": [{"col1": "Valor"}], "summary": "Nota"}
- Registrar una idea estratégica:
  {"action": "SAVE_IDEA", "title": "Título", "summary": "Resumen ejecutivo", "priority": "ALTA|MEDIA|BAJA", "tags": ["tag1"]}
- Registrar una tarea o recordatorio:
  {"action": "SAVE_TASK", "description": "Descripción", "due": "YYYY-MM-DD", "priority": "ALTA|MEDIA|BAJA"}

TONO: Ejecutivo, cálido, impecable, proactivo y conciso. Cero datos inventados.`;
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

  async _getRecentContext() {
    let recentMessages = [];
    let pendingTasks = [];
    try {
      if (this.prisma?.messageLog) {
        recentMessages = await this.prisma.messageLog.findMany({ orderBy: { createdAt: 'desc' }, take: 6 });
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
      const { recentMessages, pendingTasks } = await this._getRecentContext();
      const contextPrompt = `
CONTEXTO DEL SISTEMA:
- Canal: ${channel} | Usuario: ${senderName} (ID: ${senderId})
- Tareas pendientes activas: ${JSON.stringify(pendingTasks.map((t) => t.description))}
- Interacciones recientes:
${recentMessages.map((m) => `[${m.channel}] ${m.role === 'user' ? senderName : 'Carmencita'}: ${m.content}`).join('\n')}

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

      const reply = `✅ **¡Factura clasificada y resguardada en PostgreSQL!**\n\n` +
        `📦 **Artículo:** ${doc.invoice?.item || 'Artículo'}\n` +
        `🏢 **Proveedor:** ${doc.invoice?.vendor || 'Proveedor'}\n` +
        `💰 **Total:** ${doc.invoice?.currency || 'GTQ'} ${doc.invoice?.totalAmount}\n` +
        `🛡️ **Garantía:** ${doc.invoice?.warrantyMonths || 0} meses\n` +
        `📁 **Bóveda ID:** \`${doc.id}\`\n\n` +
        `${doc.summary || 'Resguardada para auditoría y reclamo.'}`;

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
      `📁 **Archivo:** \`${savedDoc.originalName}\`\n` +
      `🏷️ **Categoría:** **${savedDoc.category}**\n` +
      `💾 **Tamaño:** ${(savedDoc.fileSize / 1024).toFixed(1)} KB\n` +
      `🆔 **ID de Registro:** \`${savedDoc.id}\`\n\n` +
      `📌 **Resumen Ejecutivo:**\n${savedDoc.summary || 'Documento resguardado exitosamente.'}`;

    await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: reply });
    return reply;
  }

  async processAudio({ channel, senderId, senderName, buffer, mimeType, onProgress = null }) {
    if (!this.ai) {
      return `🎙️ Recibí tu nota de voz, Sebastián. En cuanto conectemos la API de Gemini podré transcribirla y ejecutar las órdenes de inmediato.`;
    }

    try {
      const response = await this.ai.models.generateContent({
        model: config.ai.modelName,
        config: { systemInstruction: this.getSystemPrompt() },
        contents: [
          `Escucha atentamente este audio de Sebastián. Transcribe y responde como su asistente ejecutiva Carmencita con iniciativa autónoma. Si requiere acciones, agrega el bloque JSON al final.`,
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

  async _executeExtractedActions(rawText, onProgress = null) {
    let cleanText = rawText;
    const jsonMatch = rawText.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (!jsonMatch) {
      return makeActionResult({ reply: cleanText });
    }

    let parsedAction = null;
    try {
      parsedAction = parseCarmencitaAction(JSON.parse(jsonMatch[0]));
      cleanText = rawText.replace(jsonMatch[0], '').trim();
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
      const report = `⚙️ <b>Reporte de terminal:</b>\n\n<pre>${escapedOutput}</pre>`;
      const fullHistory = `${initialAck}\n\n⚙️ Reporte de terminal:\n${agyResult.output}`;

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
    if (lower.includes('hola') || lower.includes('buenos')) {
      return '¡Hola Sebastián! Aquí está Carmencita lista para lo que necesites hoy. Puedes enviarme facturas, notas de voz, ideas o pedirme reportes.';
    }
    if (lower.includes('factura') || lower.includes('garantia')) {
      return 'Para registrar una factura, envíame la foto o PDF directamente y la archivaremos en PostgreSQL con sus garantías.';
    }
    if (lower.includes('idea')) {
      return '¡Excelente! Cuéntame la idea y la archivaremos con prioridad y etiquetas en el banco de ideas.';
    }
    return `Recibido, Sebastián: "${text}". Quedó registrado en el hub.`;
  }
}

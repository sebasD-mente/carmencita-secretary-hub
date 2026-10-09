import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { resolveDefaultDeps } from './default-deps.js';
import { parseCarmencitaAction } from '../validators/actions.schema.js';
import { executeAction, makeActionResult, extractActionJson } from '../tools/index.js';
import {
  CARMENCITA_SYSTEM_PROMPT,
  IMAGE_PROMPT_TEMPLATE,
  DOCUMENT_PROMPT,
  MEMORY_EXTRACT_PROMPT,
  TOOL_SYNTHESIS_PROMPT,
} from './carmencita.prompt.js';

export class CarmencitaBrain {
  constructor(deps = {}, agyBridge = null) {
    if (deps && typeof deps.listTasks === 'function') this.storage = deps;
    this._deps = deps || {};
    Object.assign(this, resolveDefaultDeps(deps));
    this.agyBridge = agyBridge || deps?.agyBridge || null;
    this.modelPool = deps?.modelPool || (config.ai.modelPool?.length ? config.ai.modelPool : [config.ai.modelName]);

    if (this.embeddingService?.saveMemory) {
      if (this.documentService && !this.documentService.embeddingService) this.documentService.embeddingService = this.embeddingService;
      if (this.obsidianService && !this.obsidianService.embeddingService) this.obsidianService.embeddingService = this.embeddingService;
    }

    this.ai = deps?.ai || null;
    if (!this.ai && config.ai.geminiApiKey && process.env.NODE_ENV !== 'test') {
      try { this.ai = new GoogleGenAI({ apiKey: config.ai.geminiApiKey }); } catch (err) { console.warn('[Brain] Could not initialize Gemini SDK:', err.message); }
    }
  }

  get deps() {
    return {
      prisma: this.prisma, documentService: this.documentService, taskService: this.taskService,
      ideaService: this.ideaService, excelService: this.excelService, calendarService: this.calendarService,
      contactService: this.contactService, googleTasksService: this.googleTasksService,
      embeddingService: this.embeddingService, obsidianService: this.obsidianService,
      gmailService: this.gmailService, voiceService: this.voiceService, mediaService: this.mediaService,
      diagnosticsService: this.diagnosticsService, agyBridge: this.agyBridge, ai: this.ai, brain: this,
      storage: this.storage, synthesizeToolResults: (opts) => this._synthesizeToolResults(opts),
      ...this._deps,
    };
  }

  getSystemPrompt() { return CARMENCITA_SYSTEM_PROMPT; }
  _buildSystemPrompt(options) { return this.getSystemPrompt(options); }

  async _logMessage({ channel, senderId, senderName, role, content, rawAction = null }) {
    try {
      if (this.prisma?.messageLog) {
        await this.prisma.messageLog.create({
          data: { channel, senderId: String(senderId), senderName, role, content, rawAction: rawAction ? JSON.parse(JSON.stringify(rawAction)) : undefined },
        });
      }
    } catch {
      await this.storage?.appendHistory?.({ channel, senderId, senderName, text: content, role }).catch(() => {});
    }
  }

  async _getRecentContext(channel = null, senderId = null) {
    let recentMessages = [], pendingTasks = [];
    try {
      if (this.prisma?.messageLog) {
        const where = { ...(channel ? { channel } : {}), ...(senderId ? { senderId: String(senderId) } : {}) };
        recentMessages = (await this.prisma.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 12 })).reverse();
      }
      if (this.taskService?.listTasks) pendingTasks = await this.taskService.listTasks({ onlyPending: true, limit: 5 });
    } catch {}
    return { recentMessages, pendingTasks };
  }

  async _generateContentWithFailover({ contents, config: genConfig = {} }) {
    if (!this.ai) throw new Error('Motor Gemini no inicializado');
    const pool = Array.isArray(this.modelPool) && this.modelPool.length > 0 ? this.modelPool : [config.ai.modelName || 'gemini-3.8-flash'];
    let lastError = null;
    for (let i = 0; i < pool.length; i++) {
      const model = pool[i];
      try {
        const response = await this.ai.models.generateContent({ model, config: genConfig, contents });
        if (i > 0) console.warn(`[Brain Failover] Inferencia completada con éxito usando modelo de respaldo: ${model}`);
        return response;
      } catch (err) {
        lastError = err;
        console.warn(`[Brain Failover] Falló modelo '${model}' (intento ${i + 1}/${pool.length}): ${err.message}. Evaluando siguiente modelo...`);
        if (err.status === 400) throw err;
      }
    }
    throw lastError || new Error('Todos los modelos del pool fallaron');
  }

  async _synthesizeToolResults({ userText, toolName, dataSummary, context = {} }) {
    if (!this.ai) return `Sebastián querido, aquí tengo la información recuperada de ${toolName}:\n\n${dataSummary}`;
    try {
      const { ahoraGuatemala } = this._getGuatemalaTimestamps();
      const response = await this._generateContentWithFailover({
        contents: [TOOL_SYNTHESIS_PROMPT(userText, toolName, dataSummary, ahoraGuatemala)],
        config: { systemInstruction: this.getSystemPrompt() },
      });
      return response?.text || 'Sebastián querido, ya procesé la información pero requiero confirmar un detalle contigo.';
    } catch (err) {
      console.warn(`[Brain] Error sintetizando resultados de ${toolName}:`, err.message);
      return `Sebastián querido, aquí tengo la información recuperada de ${toolName}:\n\n${dataSummary}`;
    }
  }

  async _extractAndSaveMemoryBackground({ userText, historyContent }) {
    if (!this.embeddingService?.saveMemory || !this.ai || !userText?.trim()) return;
    await new Promise((resolve) => setImmediate(resolve));
    try {
      const response = await this._generateContentWithFailover({
        contents: [MEMORY_EXTRACT_PROMPT(userText, historyContent)],
        config: { systemInstruction: 'Eres un extractor analítico de hechos, preferencias y directivas a largo plazo.' },
      });
      const match = (response?.text || '').match(/\{[\s\S]*?\}/);
      if (!match) return;
      const parsed = JSON.parse(match[0]);
      if (parsed.shouldSave === true && parsed.content && typeof parsed.content === 'string' && parsed.content.trim()) {
        const allowed = ['PREFERENCIA', 'ACUERDO', 'PROVEEDOR', 'DIRECTIVA', 'GENERAL'];
        const catUpper = (parsed.category || '').toUpperCase();
        await this.embeddingService.saveMemory({
          content: parsed.content.trim(),
          category: allowed.includes(catUpper) ? catUpper : 'GENERAL',
        });
      }
    } catch (err) { console.warn('[Auto-RAG] Error en extracción autónoma de memoria:', err.message); }
  }

  async _resolveRAGContext(queryText) {
    let activeDirectives = [], relevantMemories = [];
    if (this.embeddingService) {
      try {
        if (typeof this.embeddingService.getActiveDirectives === 'function') {
          activeDirectives = await this.embeddingService.getActiveDirectives({ limit: 10 });
        }
        relevantMemories = await this.embeddingService.searchSimilarMemories(queryText, { limit: 3, excludeCategory: 'OBSIDIAN' });
      } catch (err) { console.warn('[Brain RAG] Error recuperando recuerdos:', err.message); }
    }
    const directivesBlock = activeDirectives.length > 0 ? `\n### 📌 DIRECTIVAS CARDINALES ACTIVAS DE SEBASTIÁN:\n${activeDirectives.map((d) => `- ${d.content}`).join('\n')}\n` : '';
    const memoriesBlock = relevantMemories.length > 0 ? `\n🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):\n${relevantMemories.map(m => `• [${m.category}] ${m.content} (Afinidad: ${(m.similarity * 100).toFixed(0)}%)`).join('\n')}\n` : '';
    return { directivesBlock, memoriesBlock };
  }

  _getGuatemalaTimestamps() {
    return {
      ahoraGuatemala: new Intl.DateTimeFormat('es-GT', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()),
      ahoraIso: new Date().toISOString(),
    };
  }

  async processTextMessage({ channel, senderId, senderName, text, onProgress = null }) {
    await this._logMessage({ channel, senderId, senderName, role: 'user', content: text });
    if (!this.ai) {
      const fallbackReply = this._handleLocalFallback(text);
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: fallbackReply });
      return fallbackReply;
    }
    try {
      const { ahoraGuatemala, ahoraIso } = this._getGuatemalaTimestamps();
      const { directivesBlock, memoriesBlock } = await this._resolveRAGContext(text);
      const { recentMessages, pendingTasks } = await this._getRecentContext(channel, senderId);
      const contextPrompt = `\nCONTEXTO TEMPORAL DEL SISTEMA:\n• Fecha y hora actual en Guatemala: ${ahoraGuatemala} (Zona Horaria: America/Guatemala / UTC-6)\n• Timestamp ISO 8601: ${ahoraIso}\n\nCONTEXTO DEL SISTEMA:\n• Canal: ${channel} | Usuario: ${senderName} (ID: ${senderId})\n• Tareas pendientes activas: ${JSON.stringify(pendingTasks.map((t) => t.description))}\n• Interacciones recientes:\n${recentMessages.map((m) => `[${m.channel}] ${m.role === 'user' ? senderName : 'Carmencita'}: ${m.content}`).join('\n')}${directivesBlock}${memoriesBlock}\n\nMensaje de Sebastián:\n"${text}"\n`;

      const response = await this._generateContentWithFailover({ contents: [contextPrompt], config: { systemInstruction: this.getSystemPrompt() } });
      const replyText = response.text || 'Entendido, Sebastián.';
      const actionResult = await this._executeExtractedActions(replyText, onProgress, { userText: text, channel, senderId, senderName });

      if (!actionResult.hasVoice && this.voiceService && /audio|voz|resumen en audio|nota de voz/i.test(text)) {
        try {
          const voiceFile = await this.voiceService.synthesizeSpeech(actionResult.reply);
          if (voiceFile) { actionResult.hasVoice = true; actionResult.voiceFile = voiceFile; }
        } catch (vErr) { console.warn('[Brain Text Voice] Error generando voz para respuesta de texto:', vErr.message); }
      }

      const historyContent = actionResult.fullHistoryText || actionResult.reply || replyText;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: historyContent, rawAction: actionResult.actionData || null });

      if (this.embeddingService && !actionResult.hasMemory) {
        this._lastMemoryTask = this._extractAndSaveMemoryBackground({ userText: text, historyContent }).catch((err) => console.warn('[Auto-RAG] Fallo en tarea de memoria de fondo:', err.message));
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
      const doc = await this.documentService.saveDocument({ buffer, originalName: 'foto_recibida.jpg', mimeType: mimeType || 'image/jpeg', category: 'GENERAL', summary: caption || 'Foto guardada sin OCR automático' });
      return makeActionResult({ reply: `📎 ¡Recibí la foto! La he resguardado en tu bóveda (${doc.fileName}).`, hasDocument: true, documentFile: doc });
    }
    try {
      const { recentMessages } = await this._getRecentContext(channel, senderId);
      const recentContextText = recentMessages.map((m) => `[${m.role}]: ${m.content}`).join('\n');
      const ragQuery = caption?.trim() || (recentMessages.length > 0 ? recentMessages.slice(-2).map((m) => m.content).join(' ') : 'documentos y proyectos');
      const { directivesBlock, memoriesBlock } = await this._resolveRAGContext(ragQuery);

      const response = await this._generateContentWithFailover({
        contents: [IMAGE_PROMPT_TEMPLATE(recentContextText, directivesBlock, memoriesBlock), { inlineData: { mimeType: mimeType || 'image/jpeg', data: buffer.toString('base64') } }],
        config: { systemInstruction: this.getSystemPrompt() },
      });
      let parsed = {};
      const jsonMatch = (response.text || '').match(/\{[\s\S]*\}/);
      if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[0]); } catch {} }

      if (parsed.isFactura === true && parsed.type === 'FACTURA_RECIBO') {
        const invData = parsed.invoiceData || {};
        const doc = await this.documentService.saveDocument({
          buffer, originalName: `${parsed.title || invData.item || 'factura'}.jpg`,
          mimeType: mimeType || 'image/jpeg', category: 'FACTURA', summary: parsed.executiveReply || caption,
          invoiceData: {
            vendor: invData.vendor || 'Proveedor Detectado', item: invData.item || caption || 'Artículo',
            totalAmount: Number(invData.totalAmount ?? invData.total ?? 0), currency: invData.currency || 'GTQ',
            purchaseDate: invData.purchaseDate || new Date(), warrantyMonths: invData.warrantyMonths || 0, notes: parsed.extractedText || caption,
          },
        });
        const inv = doc.invoice;
        const reply = `✅ **¡Factura clasificada y resguardada en PostgreSQL!**\n\n📦 **Artículo:** ${inv?.item || 'Artículo'} | 🏢 **Proveedor:** ${inv?.vendor || 'Proveedor'}\n💰 **Total:** ${inv?.currency || 'GTQ'} ${inv?.totalAmount} | 🛡️ **Garantía:** ${inv?.warrantyMonths || 0} meses\n📁 **Bóveda ID:** \`${doc.id}\`\n\n${parsed.executiveReply || doc.summary || 'Resguardada para auditoría y reclamo.'}`;
        await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: reply });
        return makeActionResult({ reply, hasDocument: true, documentFile: doc, fullHistoryText: reply });
      }

      const docCategory = parsed.type === 'DIAGRAMA_ARQUITECTURA' ? 'PROYECTO_BRIEF' : 'GENERAL';
      const doc = await this.documentService.saveDocument({
        buffer, originalName: `${parsed.title || 'captura'}.jpg`, mimeType: mimeType || 'image/jpeg',
        category: docCategory, summary: parsed.extractedText || parsed.executiveReply || caption, invoiceData: null,
      });
      const executiveReply = parsed.executiveReply || `Sebastián querido, ya revisé la imagen que me compartiste (${parsed.title || 'archivo multimedia'}). Quedó resguardada en tu bóveda documental. ¿Deseas que prepare algo más al respecto?`;
      let voiceFile = null;
      const wantsVoice = Boolean(caption?.match(/audio|voz|escuchar/i) || recentMessages.slice(-3).some((m) => m.content?.match(/audio|voz|escuchar|nota de voz/i)));
      if (wantsVoice && this.voiceService?.synthesizeSpeech) {
        try { voiceFile = await this.voiceService.synthesizeSpeech(executiveReply); } catch (vErr) { console.warn('[Brain Vision] Error sintetizando voz:', vErr.message); }
      }
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: executiveReply });
      return makeActionResult({ reply: executiveReply, hasVoice: Boolean(voiceFile), voiceFile, hasDocument: true, documentFile: doc, fullHistoryText: `${executiveReply}\n[Imagen analizada: ${parsed.type || 'GENERAL'}]` });
    } catch (err) {
      console.error('[Brain] Error processing image:', err);
      const errMsg = `Recibí la foto, pero ocurrió un problema al procesarla con visión: ${err.message}`;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: errMsg });
      return makeActionResult({ reply: errMsg });
    }
  }

  async processDocument({ channel, senderId, senderName, buffer, mimeType, originalName, caption = '' }) {
    let category = 'GENERAL', summary = caption || `Documento ${originalName} recibido.`, metadata = {}, invoiceData = null;
    if (this.ai) {
      try {
        const contents = [DOCUMENT_PROMPT];
        if (mimeType.includes('pdf') || mimeType.includes('image')) contents.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
        const response = await this._generateContentWithFailover({ contents, config: { systemInstruction: this.getSystemPrompt() } });
        const jsonMatch = (response.text || '').match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          category = parsed.category || 'GENERAL';
          summary = parsed.summary || summary;
          if (category === 'FACTURA' || category === 'COTIZACION') {
            invoiceData = { vendor: parsed.vendor || 'Proveedor', item: parsed.item || originalName, totalAmount: parsed.totalAmount || 0, currency: parsed.currency || 'GTQ' };
          }
          metadata = parsed;
        }
      } catch (e) { console.warn('[Brain] OCR fallback:', e.message); }
    }
    const savedDoc = await this.documentService.saveDocument({ buffer, originalName, mimeType, category, summary, metadata, invoiceData });
    const reply = `📑 **¡Documento clasificado y archivado en Bóveda!**\n\n📁 **Archivo:** \`${savedDoc.originalName}\` | 🏷️ **Categoría:** **${savedDoc.category}**\n💾 **Tamaño:** ${(savedDoc.fileSize / 1024).toFixed(1)} KB | 🆔 **ID:** \`${savedDoc.id}\`\n\n📌 **Resumen Ejecutivo:**\n${savedDoc.summary || 'Documento resguardado exitosamente.'}`;
    await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: reply });
    return reply;
  }

  async processAudio({ channel, senderId, senderName, buffer, mimeType, text = '', onProgress = null }) {
    if (!this.ai) return `🎙️ Recibí tu nota de voz, Sebastián. En context conectemos la API de Gemini podré transcribirla y ejecutar las órdenes de inmediato.`;
    try {
      const { ahoraGuatemala, ahoraIso } = this._getGuatemalaTimestamps();
      const { recentMessages, pendingTasks } = await this._getRecentContext(channel, senderId);
      const ragQuery = text?.trim() || (recentMessages.length > 0 ? recentMessages.slice(-2).map((m) => m.content).join(' ') : 'directivas y preferencias');
      const { directivesBlock, memoriesBlock } = await this._resolveRAGContext(ragQuery);
      const historyBlock = recentMessages.length > 0 ? `\n📜 HISTORIAL DE CONVERSACIÓN RECIENTE (MEMORIA DE CONTEXTO):\n${recentMessages.map((m) => `[${m.channel}] ${m.role === 'user' ? senderName : 'Carmencita'}: ${m.content}`).join('\n')}\n` : '';
      const audioPrompt = `\nCONTEXTO TEMPORAL DEL SISTEMA:\n• Fecha y hora actual en Guatemala: ${ahoraGuatemala} (America/Guatemala / UTC-6)\n• Timestamp ISO 8601: ${ahoraIso}\n• Canal: ${channel} | Usuario: ${senderName} (ID: ${senderId})\n• Tareas pendientes activas: ${JSON.stringify(pendingTasks.map((t) => t.description))}${historyBlock}${directivesBlock}${memoriesBlock}\n\nEscucha atentamente este audio de Sebastián. Ten muy presente el HISTORIAL DE CONVERSACIÓN RECIENTE y las directivas recuperadas para entender referencias como "lo que te pedí antes", "el reporte", "la nota" o temas que ya venían conversando. Responde con un mensaje hablado, cálido, zalamero y natural de 2 a 3 oraciones (sin viñetas, sin encabezados ni títulos de plantilla), como su secretaria ejecutiva Carmencita. Si requiere acciones técnicas, agrega el bloque JSON al final.`;

      const response = await this._generateContentWithFailover({
        contents: [audioPrompt, { inlineData: { mimeType: mimeType || 'audio/ogg', data: buffer.toString('base64') } }],
        config: { systemInstruction: this.getSystemPrompt() },
      });
      const replyText = response.text || 'He escuchado tu nota de voz, Sebastián.';
      const actionResult = await this._executeExtractedActions(replyText, onProgress, { userText: text || 'nota de voz recibida', isAudio: true, channel, senderId, senderName });

      if (!actionResult.hasVoice && this.voiceService) {
        try {
          const voiceFile = await this.voiceService.synthesizeSpeech(actionResult.reply);
          if (voiceFile) { actionResult.hasVoice = true; actionResult.voiceFile = voiceFile; }
        } catch (voiceErr) { console.warn('[Brain] Error generando voz en modo espejo:', voiceErr.message); }
      }

      const historyContent = actionResult.fullHistoryText || actionResult.reply || replyText;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: historyContent });

      if (this.embeddingService && !actionResult.hasMemory) {
        const queryText = text?.trim() || actionResult.reply || 'Nota de voz de Sebastián';
        this._lastMemoryTask = this._extractAndSaveMemoryBackground({ userText: queryText, historyContent }).catch((err) => console.warn('[Auto-RAG] Fallo en tarea de memoria de fondo:', err.message));
      }
      return actionResult;
    } catch (err) {
      console.error('[Brain] Error processing audio:', err);
      return `Escuché la nota de voz pero ocurrió un error al analizarla: ${err.message}`;
    }
  }

  _extractActionJson(rawText) {
    return extractActionJson(rawText);
  }

  async _executeExtractedActions(rawText, onProgress = null, context = {}) {
    let cleanText = rawText;
    const extracted = this._extractActionJson(rawText);
    if (!extracted) return makeActionResult({ reply: cleanText });

    let parsedAction = null;
    try {
      parsedAction = parseCarmencitaAction(extracted.parsed);
      cleanText = rawText.replace(extracted.matchedString, '').replace(/```(?:json)?\s*```/gi, '').trim();
    } catch (e) {
      console.warn('[Brain] JSON de acción inválido:', e.message);
    }
    if (!parsedAction) return makeActionResult({ reply: cleanText });
    return await executeAction(parsedAction, this.deps, { ...context, cleanText, rawText, onProgress });
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

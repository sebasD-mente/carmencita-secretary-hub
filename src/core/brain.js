import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { resolveDefaultDeps } from './default-deps.js';
import { parseCarmencitaAction } from '../validators/actions.schema.js';
import { executeAction, makeActionResult, extractActionJson, sanitizeReplyText } from '../tools/index.js';
import { ToolDispatcher } from '../tools/dispatcher.js';
import { AgentRunner, mapToolSummaryToActionResult } from './agent-runner.js';
import { handleBrainImage, handleBrainDocument, handleBrainAudio } from './multimodal.js';
import { CARMENCITA_SYSTEM_PROMPT, MEMORY_EXTRACT_PROMPT, TOOL_SYNTHESIS_PROMPT } from './carmencita.prompt.js';

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
      try { this.ai = new GoogleGenAI({ apiKey: config.ai.geminiApiKey }); } catch (err) { console.warn('[Brain] Gemini SDK fail:', err.message); }
    }

    this.toolDispatcher = deps?.toolDispatcher || new ToolDispatcher(this.deps);
    this.agentRunner = deps?.agentRunner || new AgentRunner({
      aiPool: {
        executeWithRetry: async (callFn) => callFn({
          models: { generateContent: (args) => this._generateContentWithFailover(args) },
        }),
      },
      toolDispatcher: this.toolDispatcher,
      modelName: config.ai.modelName,
    });
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
        if (i > 0) console.warn(`[Brain Failover] Inferencia exitosa usando modelo: ${model}`);
        return response;
      } catch (err) {
        lastError = err;
        console.warn(`[Brain Failover] Falló modelo '${model}' (${i + 1}/${pool.length}): ${err.message}`);
        if (err.status === 400) throw err;
      }
    }
    throw lastError || new Error('Todos los modelos del pool fallaron');
  }

  async _synthesizeToolResults({ userText, toolName, dataSummary }) {
    if (!this.ai) return `Sebastián querido, aquí tengo la información recuperada de ${toolName}:\n\n${dataSummary}`;
    try {
      const { ahoraGuatemala } = this._getGuatemalaTimestamps();
      const response = await this._generateContentWithFailover({
        contents: [TOOL_SYNTHESIS_PROMPT(userText, toolName, dataSummary, ahoraGuatemala)],
        config: { systemInstruction: this.getSystemPrompt() },
      });
      return response?.text || 'Sebastián querido, ya procesé la información requerida.';
    } catch {
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
    if (!this.embeddingService) return { directivesBlock: '', memoriesBlock: '' };
    try {
      const active = typeof this.embeddingService.getActiveDirectives === 'function' ? await this.embeddingService.getActiveDirectives({ limit: 10 }) : [];
      const mems = await this.embeddingService.searchSimilarMemories(queryText, { limit: 3, excludeCategory: 'OBSIDIAN' });
      const directivesBlock = active?.length ? `\n### 📌 DIRECTIVAS CARDINALES ACTIVAS DE SEBASTIÁN:\n${active.map(d => `- ${d.content}`).join('\n')}\n` : '';
      const memoriesBlock = mems?.length ? `\n🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):\n${mems.map(m => `• [${m.category}] ${m.content} (Afinidad: ${(m.similarity * 100).toFixed(0)}%)`).join('\n')}\n` : '';
      return { directivesBlock, memoriesBlock };
    } catch { return { directivesBlock: '', memoriesBlock: '' }; }
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

      const runnerResult = await this.agentRunner.run({
        systemInstruction: this.getSystemPrompt(),
        history: [],
        userMessage: contextPrompt,
        context: { userText: text, channel, senderId, senderName, onProgress },
      });

      let actionResult = (runnerResult.toolCallsSummary && runnerResult.toolCallsSummary.length > 0)
        ? mapToolSummaryToActionResult(runnerResult)
        : await this._executeExtractedActions(runnerResult.rawReply || runnerResult.reply, onProgress, { userText: text, channel, senderId, senderName });

      if (!actionResult.hasVoice && this.voiceService && /audio|voz|resumen en audio|nota de voz/i.test(text)) {
        try {
          const voiceFile = await this.voiceService.synthesizeSpeech(actionResult.reply);
          if (voiceFile) { actionResult.hasVoice = true; actionResult.voiceFile = voiceFile; }
        } catch (vErr) { console.warn('[Brain Text Voice] Error generando voz para texto:', vErr.message); }
      }

      const historyContent = actionResult.fullHistoryText || actionResult.reply;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: historyContent, rawAction: actionResult.actionData || null });

      if (this.embeddingService && !actionResult.hasMemory) {
        this._lastMemoryTask = this._extractAndSaveMemoryBackground({ userText: text, historyContent }).catch(() => {});
      }
      return actionResult;
    } catch (err) {
      console.error('[Brain] Error processing text:', err);
      const errMsg = `Hola Sebastián, recibí tu mensaje pero ocurrió un error al consultar el motor de IA: ${err.message}.`;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: errMsg });
      return errMsg;
    }
  }

  async processImage(opts) { return await handleBrainImage(this, opts); }
  async processDocument(opts) { return await handleBrainDocument(this, opts); }
  async processAudio(opts) { return await handleBrainAudio(this, opts); }

  async _executeExtractedActions(rawText, onProgress = null, context = {}) {
    const extracted = extractActionJson(rawText);
    if (!extracted) return makeActionResult({ reply: sanitizeReplyText(rawText) });
    let parsedAction = null;
    try {
      parsedAction = parseCarmencitaAction(extracted.parsed);
    } catch (e) {
      console.warn('[Brain] JSON de acción inválido:', e.message);
    }
    if (!parsedAction) return makeActionResult({ reply: sanitizeReplyText(rawText) });
    const cleanText = rawText.replace(extracted.matchedString, '').replace(/```(?:json)?\s*```/gi, '').trim();
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

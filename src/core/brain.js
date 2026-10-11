import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { resolveDefaultDeps } from './default-deps.js';
import { makeActionResult } from '../tools/index.js';
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
    this.stagedActions = new Map();
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
      googleDriveService: this.googleDriveService,
      gmailService: this.gmailService, voiceService: this.voiceService, mediaService: this.mediaService,
      diagnosticsService: this.diagnosticsService, agyBridge: this.agyBridge, ai: this.ai, brain: this,
      storage: this.storage, synthesizeToolResults: (opts) => this._synthesizeToolResults(opts),
      imageGenerationService: this.imageGenerationService,
      emailTriageService: this.emailTriageService,
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

  stageAction({ toolName, args, description, senderId, ttlMs = 15 * 60 * 1000 }) {
    const actionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const staged = {
      actionId,
      toolName,
      args: args || {},
      description: description || `Ejecutar ${toolName}`,
      senderId: String(senderId || 'default'),
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    this.stagedActions.set(actionId, staged);
    return staged;
  }

  async executeStagedAction(actionIdOrStaged, context = {}) {
    let staged = null;
    let actionId = null;

    if (typeof actionIdOrStaged === 'string') {
      actionId = actionIdOrStaged;
      staged = this.stagedActions.get(actionId);
    } else if (actionIdOrStaged && typeof actionIdOrStaged === 'object') {
      staged = actionIdOrStaged;
      actionId = staged.actionId;
    }

    if (!staged) {
      throw new Error('Esta acción no existe o ya fue procesada.');
    }

    if (staged.expiresAt && Date.now() > staged.expiresAt) {
      if (actionId) this.stagedActions.delete(actionId);
      throw new Error('Esta acción ha expirado (TTL de 15 minutos superado).');
    }

    if (actionId) {
      this.stagedActions.delete(actionId);
    }

    const dispatcher = this.toolDispatcher || this.agentRunner?.toolDispatcher;
    if (!dispatcher) {
      throw new Error('ToolDispatcher no disponible en CarmencitaBrain.');
    }

    const dispatchContext = {
      ...context,
      senderId: staged.senderId,
      isConfirmed: true,
      bypassStaging: true,
    };

    return await dispatcher.dispatch(staged.toolName, staged.args, dispatchContext);
  }

  async _extractAndSaveMemoryBackground({ userText, historyContent }) {
    if (!this.embeddingService?.saveMemory || !this.ai || !userText?.trim()) return;
    const casualPattern = /^(hola|buenos d[ií]as|buenas tardes|buenas noches|adi[oó]s|gracias|muchas gracias|ok|de acuerdo|entendido|perfecto|va|listo|s[ií]|no|chao|bueno)[.!]?$/i;
    if (casualPattern.test(userText.trim())) return;

    await new Promise((resolve) => setImmediate(resolve));
    try {
      const response = await this._generateContentWithFailover({
        contents: [MEMORY_EXTRACT_PROMPT(userText, historyContent)],
        config: { systemInstruction: 'Eres un extractor analítico de hechos, preferencias y directivas a largo plazo con filtro estricto de saliencia ejecutiva.' },
      });
      const match = (response?.text || '').match(/\{[\s\S]*?\}/);
      if (!match) return;
      const parsed = JSON.parse(match[0]);
      if (parsed.shouldSave === true && parsed.content && typeof parsed.content === 'string' && parsed.content.trim()) {
        if (parsed.salience !== undefined && Number(parsed.salience) < 0.6) return;
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
      let directivesBlock = '';
      let memoriesBlock = '';
      const tasks = [];

      // 1. Directivas Cardinales Activas
      if (typeof this.embeddingService.getActiveDirectives === 'function') {
        tasks.push(
          this.embeddingService.getActiveDirectives({ limit: 10 })
            .then((active) => {
              if (active?.length) {
                directivesBlock = `\n### 📌 DIRECTIVAS CARDINALES ACTIVAS DE SEBASTIÁN:\n${active.map((d) => `- ${d.content}`).join('\n')}\n`;
              }
            })
            .catch(() => {})
        );
      }

      // 2. Búsqueda Vectorial Semántica por Afinidad Coseno (excluyendo chunks crudos de OBSIDIAN)
      if (typeof this.embeddingService.searchSimilarMemories === 'function' && queryText && queryText.trim()) {
        tasks.push(
          this.embeddingService.searchSimilarMemories(queryText, { limit: 3, excludeCategory: 'OBSIDIAN', minSimilarity: 0.55 })
            .then((mems) => {
              if (mems?.length) {
                memoriesBlock = `\n🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):\n${mems.map((m) => `• [${m.category}] ${m.content}${m.similarity !== undefined ? ` (Afinidad: ${(m.similarity * 100).toFixed(0)}%)` : ''}`).join('\n')}\n`;
              }
            })
            .catch(() => {})
        );
      }

      await Promise.all(tasks);
      return { directivesBlock, memoriesBlock };
    } catch {
      return { directivesBlock: '', memoriesBlock: '' };
    }
  }

  _getGuatemalaTimestamps() {
    return {
      ahoraGuatemala: new Intl.DateTimeFormat('es-GT', { timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()),
      ahoraIso: new Date().toISOString(),
    };
  }

  async processTextMessage({ channel, senderId, senderName, text, isVoiceInput = false, onProgress = null }) {
    await this._logMessage({ channel, senderId, senderName, role: 'user', content: text });
    try {
      // 1. Contexto temporal y semántico del sistema
      const { ahoraGuatemala, ahoraIso } = this._getGuatemalaTimestamps();
      const { directivesBlock, memoriesBlock } = await this._resolveRAGContext(text);
      const { recentMessages, pendingTasks } = await this._getRecentContext(channel, senderId);

      // 2. Reconstrucción estructurada nativa del historial (Puntos 02, 12 y 30)
      const historyContents = (recentMessages || []).map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: String(m.content || '') }],
      }));

      // 3. Preámbulo dinámico de sistema (libera tokens de atención del mensaje del usuario)
      const dynamicSystemInstruction = `${this.getSystemPrompt()}

[CONTEXTO OPERATIVO ACTIVO]
• Hora y Fecha en Guatemala: ${ahoraGuatemala} (Zona Horaria: America/Guatemala / UTC-6)
• Timestamp ISO 8601: ${ahoraIso}
• Canal de Entrada: ${channel} | Usuario: ${senderName} (ID: ${senderId})
• Tareas Pendientes Activas: ${JSON.stringify(pendingTasks.map((t) => t.description))}${directivesBlock}${memoriesBlock}`;

      // 4. Invocación limpia al motor ReAct con Native Tool Calling
      const runnerResult = await this.agentRunner.run({
        systemInstruction: dynamicSystemInstruction,
        history: historyContents,
        userMessage: text,
        context: { userText: text, channel, senderId, senderName, onProgress, isVoiceInput },
      });

      // 5. Mapeo directo y exclusivo de Native Tool Calling (Erradicación del Dual Engine)
      let actionResult = mapToolSummaryToActionResult(runnerResult);

      if (!actionResult.hasVoice && this.voiceService && (isVoiceInput || /audio|voz|resumen en audio|nota de voz/i.test(text))) {
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
      const errMsg = `Hola Sebastián, ocurrió un inconveniente técnico al procesar tu solicitud: ${err.message}. El incidente fue registrado con transparencia y la acción no fue alterada.`;
      await this._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: errMsg });
      return makeActionResult({ reply: errMsg });
    }
  }

  async processImage(opts) { return await handleBrainImage(this, opts); }
  async processDocument(opts) { return await handleBrainDocument(this, opts); }
  async processAudio(opts) { return await handleBrainAudio(this, opts); }

  async executeAgyTask(prompt) {
    if (!this.agyBridge) return { success: false, output: 'AGY CLI no está configurado en este entorno.' };
    return await this.agyBridge.executeTask(prompt);
  }
}

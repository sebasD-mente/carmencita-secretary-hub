import { CARMENCITA_TOOL_DECLARATIONS } from '../tools/declarations.js';
import { sanitizeReplyText, makeActionResult } from '../tools/index.js';
import { config } from '../config.js';

/**
 * Núcleo Agéntico Autónomo ReAct (Reasoning + Acting) para Carmencita 2.0.
 * Utiliza Native Tool Calling de @google/genai, contratos tipados Zod,
 * temperatura bimodal (0.1 en deliberación, 0.6 en síntesis) y Circuit Breakers globales.
 */
export class AgentRunner {
  /**
   * @param {{
   *   aiPool: unknown,
   *   toolDispatcher: unknown,
   *   maxTurns?: number,
   *   globalTimeoutMs?: number,
   *   modelName?: string
   * }} options
   */
  constructor({ aiPool, toolDispatcher, maxTurns = 5, globalTimeoutMs = 25000, modelName = null } = {}) {
    this.aiPool = aiPool;
    this.toolDispatcher = toolDispatcher;
    this.maxTurns = maxTurns;
    this.globalTimeoutMs = globalTimeoutMs;
    this.modelName = modelName || config.ai?.modelName || 'gemini-3.8-flash';
  }

  /**
   * Prepara y normaliza el historial conversacional aplicando ventana deslizante (Rolling Summary).
   * @param {Array<Record<string, unknown>>} rawHistory
   * @param {string} userMessage
   * @returns {Array<{ role: string, parts: Array<{ text: string }> }>}
   */
  _buildContents(rawHistory = [], userMessage = '') {
    const validHistory = Array.isArray(rawHistory)
      ? rawHistory
          .filter((item) => item && (item.content || item.text))
          .map((item) => ({
            role: item.role === 'assistant' || item.role === 'model' ? 'model' : 'user',
            text: String(item.content || item.text || '').trim(),
          }))
          .filter((item) => item.text.length > 0)
      : [];

    let olderSummary = '';
    let recentTurns = validHistory;

    // Ventana deslizante: retener los últimos 8 turnos atómicos y condensar anteriores
    if (validHistory.length > 8) {
      const olderTurns = validHistory.slice(0, validHistory.length - 8);
      recentTurns = validHistory.slice(-8);
      olderSummary = `[Resumen de contexto histórico previo:\n${olderTurns
        .map((t) => `• ${t.role === 'user' ? 'Sebastián' : 'Carmencita'}: ${t.text}`)
        .join('\n')}\n]\n\n`;
    }

    const contents = recentTurns.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    }));

    // Inyectar el mensaje actual del usuario con el resumen condensado si existe
    const fullUserText = olderSummary ? `${olderSummary}${userMessage}` : userMessage;
    contents.push({
      role: 'user',
      parts: [{ text: fullUserText }],
    });

    return contents;
  }

  /**
   * Realiza la llamada de inferencia al cliente de Gemini con failover o pool.
   * @private
   */
  async _callModel({ contents, systemInstruction, temperature, signal }) {
    if (!this.aiPool) throw new Error('Motor de IA no configurado en AgentRunner.');

    const callFn = async (client) => {
      const targetClient = client || this.aiPool;
      const targetModel = this.modelName;

      let contentsForCall = contents;
      if (contents.length === 1 && contents[0].role === 'user' && contents[0].parts?.[0]?.text && contents[0].parts.length === 1) {
        contentsForCall = [contents[0].parts[0].text];
      }

      return await targetClient.models.generateContent({
        model: targetModel,
        contents: contentsForCall,
        config: {
          systemInstruction,
          temperature,
          tools: [{ functionDeclarations: CARMENCITA_TOOL_DECLARATIONS }],
          signal,
        },
      });
    };

    if (typeof this.aiPool.executeWithRetry === 'function') {
      return await this.aiPool.executeWithRetry(callFn);
    }
    return await callFn(this.aiPool);
  }

  /**
   * Ejecuta el ciclo de razonamiento multi-paso ReAct.
   * @param {{
   *   systemInstruction?: string,
   *   history?: Array<Record<string, unknown>>,
   *   userMessage: string,
   *   context?: Record<string, unknown>
   * }} options
   */
  async run({ systemInstruction = '', history = [], userMessage = '', context = {} }) {
    const contents = this._buildContents(history, userMessage);
    const toolCallsSummary = [];
    const stagedActions = [];
    let turnCount = 0;

    const globalController = new AbortController();
    let globalTimer = null;

    const timeoutPromise = new Promise((resolve) => {
      globalTimer = setTimeout(() => {
        globalController.abort();
        resolve({
          isTimeout: true,
          reply: 'Sebastián querido, la deliberación excedió el tiempo global de respuesta (25s). Se interrumpió el proceso de forma segura.',
          toolCallsSummary,
          stagedActions,
        });
      }, this.globalTimeoutMs);
    });

    const runnerExecution = (async () => {
      let lastResponse = null;

      while (turnCount < this.maxTurns) {
        // Temperatura bimodal: 0.1 en razonamiento/tools, 0.6 en síntesis final
        const hasActiveTools = toolCallsSummary.length > 0;
        const temperature = hasActiveTools ? 0.1 : 0.6;

        const response = await this._callModel({
          contents,
          systemInstruction,
          temperature,
          signal: globalController.signal,
        });

        lastResponse = response;
        const functionCalls = response?.functionCalls || [];

        if (functionCalls.length > 0) {
          // 1. Agregar turno del modelo con llamadas de herramientas a contents
          const modelParts = [];
          if (response.text) {
            modelParts.push({ text: response.text });
          }
          for (const call of functionCalls) {
            modelParts.push({
              functionCall: {
                name: call.name,
                args: call.args,
              },
            });
          }
          contents.push({ role: 'model', parts: modelParts });

          // 2. Ejecutar cada herramienta mediante ToolDispatcher (con hard-timeout individual de 8s)
          const responseParts = [];
          for (const call of functionCalls) {
            const toolResult = await this.toolDispatcher.dispatch(call.name, call.args, {
              ...context,
              stagedActions,
            });

            toolCallsSummary.push({
              name: call.name,
              args: call.args,
              result: toolResult,
            });

            if ((toolResult?.status === 'staged' || toolResult?.requiresConfirmation) && !stagedActions.includes(toolResult)) {
              stagedActions.push(toolResult);
            }

            // 3. Empaquetar functionResponse para devolver al modelo
            responseParts.push({
              functionResponse: {
                name: call.name,
                response: toolResult,
              },
            });
          }

          // 4. Agregar turno del usuario con resultados de herramientas a contents
          contents.push({ role: 'user', parts: responseParts });
          turnCount++;
        } else {
          // No hay llamadas de herramientas: respuesta sintética final
          const rawText = typeof response?.text === 'function' ? response.text() : response?.text;
          const cleanReply = sanitizeReplyText(rawText || '');
          return {
            reply: cleanReply,
            rawReply: rawText || '',
            toolCallsSummary,
            stagedActions,
          };
        }
      }

      // Si agotó turnos máximos, devolver último texto disponible
      const rawFallback = typeof lastResponse?.text === 'function' ? lastResponse.text() : lastResponse?.text;
      return {
        reply: sanitizeReplyText(rawFallback || 'Sebastián querido, completé la deliberación requerida.'),
        rawReply: rawFallback || '',
        toolCallsSummary,
        stagedActions,
      };
    })();

    try {
      return await Promise.race([runnerExecution, timeoutPromise]);
    } finally {
      if (globalTimer) clearTimeout(globalTimer);
    }
  }
}

/**
 * Mapea el resumen de ejecución de herramientas de AgentRunner a la estructura ActionResult normalizada.
 * @param {{ reply: string, toolCallsSummary?: Array<Record<string, any>> }} runnerResult
 * @returns {Record<string, unknown>}
 */
export function mapToolSummaryToActionResult(runnerResult) {
  const opts = { reply: runnerResult.reply };
  if (runnerResult.stagedActions && runnerResult.stagedActions.length > 0) {
    opts.hasStagedAction = true;
    opts.stagedAction = runnerResult.stagedActions[0];
    opts.stagedActions = runnerResult.stagedActions;
  }
  for (const call of runnerResult.toolCallsSummary || []) {
    const { name, result } = call;
    const data = result?.data;
    if (name === 'manage_calendar') {
      opts.hasCalendarEvent = true;
      if (data?.event) opts.calendarEvent = data.event;
      if (data?.events) opts.calendarEvents = data.events;
      opts.actionData = { action: data?.action || 'MANAGE_CALENDAR', ...(data || {}) };
    } else if (name === 'search_gmail') {
      opts.hasGmailEmails = true;
      opts.gmailEmails = data?.emails || [];
      opts.actionData = { action: 'CHECK_GMAIL', ...(data || {}) };
    } else if (name === 'manage_obsidian_notes') {
      if (data?.note) { opts.hasObsidianNote = true; opts.obsidianNote = data.note; }
      if (data?.notes) { opts.hasObsidianNotes = true; opts.obsidianNotes = data.notes; }
      if (data?.syncResult) opts.syncResult = data.syncResult;
      opts.actionData = { action: 'MANAGE_OBSIDIAN', ...(data || {}) };
    } else if (name === 'manage_tasks') {
      opts.hasTask = true;
      if (data?.task) opts.task = data.task;
      if (data?.tasks) opts.tasks = data.tasks;
      opts.actionData = { action: 'MANAGE_TASKS', ...(data || {}) };
    } else if (name === 'manage_documents') {
      if (data?.documents) { opts.hasDocuments = true; opts.documents = data.documents; }
      if (data?.document) { opts.hasDocument = true; opts.documentFile = data.document; }
      opts.actionData = { action: 'MANAGE_DOCUMENTS', ...(data || {}) };
    } else if (name === 'diagnose_system') {
      opts.hasDiagnostics = true;
      opts.diagnostics = data?.diagnostics || null;
      opts.actionData = { action: 'DIAGNOSE_SYSTEM', ...(data || {}) };
    } else if (name === 'generate_media') {
      if (data?.qrFile) { opts.hasPhoto = true; opts.photoFile = data.qrFile; }
      if (data?.excelFile) { opts.hasExcel = true; opts.excelFile = data.excelFile; }
      if (data?.avatar) { opts.hasPhoto = true; opts.photoFile = data.avatar; }
      opts.actionData = { action: 'GENERATE_MEDIA', ...(data || {}) };
    }
  }
  return makeActionResult(opts);
}


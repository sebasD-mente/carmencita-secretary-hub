import { CARMENCITA_TOOL_DECLARATIONS } from '../tools/declarations.js';
import { sanitizeReplyText, makeActionResult } from '../tools/index.js';
import { config } from '../config.js';

/**
 * Sanitiza recursivamente el resultado de herramientas para evitar desbordar
 * la ventana de contexto de Gemini con datos binarios (Buffers) o cadenas Base64 gigantes.
 * @param {unknown} data
 * @returns {unknown}
 */
export function sanitizeToolResponseForModel(data) {
  if (!data || typeof data !== 'object') return data;
  if (Buffer.isBuffer(data)) return undefined;
  if (data.type === 'Buffer' && Array.isArray(data.data)) return undefined;

  if (Array.isArray(data)) {
    return data.map(sanitizeToolResponseForModel).filter((x) => x !== undefined);
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    // 1. Purgar buffers directos (Buffer o serializado { type: 'Buffer', data: [] })
    if (Buffer.isBuffer(value) || (value && value.type === 'Buffer' && Array.isArray(value.data))) {
      if (key === 'buffer' || key === 'dataBuffer' || key === 'rawBytes') sanitized[key] = '[BINARY_BUFFER_OMITTED]';
      continue;
    }

    // 2. Claves de archivos conocidos con buffer anidado
    if (key === 'photoFile' || key === 'excelFile' || key === 'qrFile') {
      if (value && (Buffer.isBuffer(value) || (typeof value === 'object' && (value.buffer || value.type === 'Buffer')))) {
        sanitized[key] = '[BINARY_BUFFER_OMITTED]';
        continue;
      }
    }

    // 3. Objeto archivo contenedor que resguarda un buffer en su interior
    if (value && typeof value === 'object' && value.type !== 'Buffer' && (Buffer.isBuffer(value.buffer) || (value.buffer?.type === 'Buffer' && Array.isArray(value.buffer?.data)))) {
      sanitized[key] = { fileName: value.fileName || key, mimeType: value.mimeType || 'application/octet-stream', summary: '[BUFFER_RESGUARDADO_EN_STORAGE]', filePath: value.filePath || undefined, cloudUrl: value.cloudUrl || undefined };
      continue;
    }

    // 4. Purgar cadenas Base64 largas (> 1,000 caracteres)
    if (typeof value === 'string' && value.length > 1000 && !value.includes(' ') && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 100))) {
      sanitized[key] = '[BASE64_OMITTED]';
      continue;
    }

    const cleaned = sanitizeToolResponseForModel(value);
    if (cleaned !== undefined) {
      sanitized[key] = cleaned;
    }
  }
  return sanitized;
}

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
  constructor({ aiPool, toolDispatcher, maxTurns = 5, globalTimeoutMs = 35000, modelName = null } = {}) {
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
          .filter((item) => item && (item.content || item.text || (item.parts && item.parts[0]?.text)))
          .map((item) => ({
            role: item.role === 'assistant' || item.role === 'model' ? 'model' : 'user',
            text: String(item.content || item.text || item.parts?.[0]?.text || '').trim(),
          }))
          .filter((item) => item.text.length > 0)
      : [];

    let olderSummary = '';
    let recentTurns = validHistory;

    // Ventana deslizante: retener los últimos 8 turnos atómicos y condensar anteriores
    if (validHistory.length > 8) {
      const olderTurns = validHistory.slice(0, validHistory.length - 8);
      recentTurns = validHistory.slice(-8);
      olderSummary = `[Resumen de contexto histórico previo:\n${olderTurns.map((t) => `• ${t.role === 'user' ? 'Sebastián' : 'Carmencita'}: ${t.text}`).join('\n')}\n]\n\n`;
    }

    const contents = recentTurns.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] }));
    const fullUserText = olderSummary ? `${olderSummary}${userMessage}` : userMessage;
    contents.push({ role: 'user', parts: [{ text: fullUserText }] });
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
          reply: `Sebastián querido, la deliberación excedió el tiempo global de respuesta (${Math.round(this.globalTimeoutMs / 1000)}s). Se interrumpió el proceso de forma segura.`,
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
          // En @google/genai con modelos thinking (gemini-3.8-flash), response.candidates[0].content
          // contiene el thoughtSignature mandatorio. Preservar el objeto original intacto.
          if (response?.candidates?.[0]?.content) {
            contents.push(response.candidates[0].content);
          } else {
            const modelParts = [];
            if (response.text) modelParts.push({ text: response.text });
            for (const call of functionCalls) {
              modelParts.push({ functionCall: { name: call.name, args: call.args } });
            }
            contents.push({ role: 'model', parts: modelParts });
          }

          // 2. Ejecutar cada herramienta mediante ToolDispatcher (con hard-timeout individual de 8s)
          const responseParts = [];
          for (const call of functionCalls) {
            let progressTimer = null;
            if (typeof context?.onProgress === 'function') {
              const toolMsgs = {
                manage_drive: 'Revisando archivos en Google Drive...',
                manage_obsidian_notes: 'Consultando notas en Obsidian Vault...',
                generate_image: 'Generando diseño visual con Nano Banana...',
                query_calendar: 'Consultando agenda en Google Calendar...',
                query_gmail: 'Consultando Gmail...',
                query_tasks: 'Revisando tareas pendientes...',
                system_diagnostics: 'Ejecutando diagnóstico...',
              };
              const msg = toolMsgs[call.name] || 'Procesando tu solicitud...';
              progressTimer = setTimeout(() => {
                context.onProgress(`⏳ ${msg}`).catch(() => {});
              }, 3500);
            }

            let toolResult;
            try {
              toolResult = await this.toolDispatcher.dispatch(call.name, call.args, {
                ...context,
                stagedActions,
              });
            } finally {
              if (progressTimer) clearTimeout(progressTimer);
            }

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
                response: sanitizeToolResponseForModel(toolResult),
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
  let rawReply = (runnerResult.reply || '').trim();
  const opts = { reply: rawReply };
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
    } else if (name === 'generate_image') {
      if (data?.buffer || data?.filePath) {
        opts.hasPhoto = true;
        opts.photoFile = { buffer: data.buffer || null, path: data.filePath || null, fileName: data.fileName || 'nano_generated.png', caption: runnerResult.reply };
      }
      opts.actionData = { action: 'GENERATE_IMAGE', ...(data || {}) };
    } else if (name === 'run_agy_task') {
      opts.hasAsyncAction = false;
      opts.actionData = { action: 'RUN_AGY_TASK', ...(data || {}) };
    }
  }

  // Síntesis agéntica de respaldo si el LLM no generó texto explicativo (Punto 24)
  if (!opts.reply || opts.reply.length === 0) {
    if (opts.hasCalendarEvent && opts.calendarEvent) {
      opts.reply = `📅 Evento agendado en Google Calendar: "${opts.calendarEvent.summary || opts.calendarEvent.title}" para el ${opts.calendarEvent.start?.dateTime || opts.calendarEvent.startTime || 'horario indicado'}.`;
    } else if (opts.hasGmailEmails && opts.gmailEmails.length > 0) {
      opts.reply = `✉️ Se encontraron ${opts.gmailEmails.length} correos en tu bandeja de Gmail.`;
    } else if (opts.hasTask && opts.task) {
      opts.reply = `📋 Tarea registrada en tu lista de pendientes: "${opts.task.description || opts.task.title}".`;
    } else if (opts.hasPhoto) {
      opts.reply = `🎨 Render visual generado exitosamente listo para revisión.`;
    } else {
      opts.reply = 'Operación completada exitosamente en el sistema.';
    }
  }

  return makeActionResult(opts);
}

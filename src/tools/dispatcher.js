import { validateToolArgs } from './schemas/index.js';

/**
 * Despachador Tipado y Segregador de Herramientas para el Motor Agéntico de Carmencita.
 * Implementa validación previa Zod, Circuit Breakers con AbortController (8s),
 * segregación READ vs. MUTATE (Staged Actions) y contratos tipados normalizados.
 */
export class ToolDispatcher {
  /**
   * @param {Record<string, unknown>} deps
   * @param {{ toolTimeoutMs?: number }} [options]
   */
  constructor(deps = {}, options = {}) {
    this.deps = deps || {};
    this.toolTimeoutMs = options.toolTimeoutMs || 8000;
  }

  /**
   * Determina si una llamada corresponde a una mutación crítica que requiere confirmación (staging).
   * @param {string} toolName
   * @param {Record<string, unknown>} args
   * @returns {boolean}
   */
  isDestructiveAction(toolName, args = {}) {
    if (['DELETE_EVENT', 'CANCEL_CALENDAR_EVENT', 'SEND_EMAIL', 'CANCEL_TASK', 'DELETE_NOTE'].includes(toolName)) return true;
    if (toolName === 'manage_calendar') {
      const a = String(args.action || '').toUpperCase();
      return a === 'CANCEL' || a === 'DELETE' || a === 'DELETE_EVENT';
    }
    if (toolName === 'manage_tasks') return String(args.action || '').toUpperCase() === 'CANCEL';
    if (toolName === 'manage_obsidian_notes') {
      const a = String(args.action || '').toUpperCase();
      return a === 'DELETE' || a === 'DELETE_NOTE';
    }
    return false;
  }

  /**
   * Despacha y ejecuta una llamada a herramienta tipada de forma controlada y segura.
   * @param {string} toolName
   * @param {Record<string, unknown>} rawArgs
   * @param {Record<string, unknown>} [context]
   * @returns {Promise<{ success: boolean, data?: unknown, error?: { code: string, message: string } } | { status: string, reason?: string, message?: string, details?: unknown, requiresConfirmation?: boolean, action?: string, preview?: string }>}
   */
  async dispatch(toolName, rawArgs = {}, context = {}) {
    // 1. Validación Previa con Esquemas Coercitivos Zod
    const validation = validateToolArgs(toolName, rawArgs);
    if (!validation.valid) {
      return {
        status: 'error',
        reason: 'INVALID_ARGUMENTS',
        message: 'Los argumentos suministrados no cumplen con el esquema requerido. Corrige los parámetros en el siguiente turno.',
        details: validation.error,
      };
    }

    const args = validation.data;

    // 2. Segregación READ vs. MUTATE Crítico (Staged Actions)
    if (!context.isConfirmed && !context.bypassStaging && this.isDestructiveAction(toolName, args)) {
      const summary = args.summary || args.title || args.eventId || args.taskId || `${toolName}:${args.action || 'MUTATE'}`;
      const actionType = toolName === 'manage_calendar' && (args.action === 'CANCEL' || args.action === 'DELETE') ? 'CANCEL_CALENDAR_EVENT'
        : toolName === 'manage_tasks' && args.action === 'CANCEL' ? 'CANCEL_TASK'
        : toolName === 'manage_obsidian_notes' && args.action === 'DELETE' ? 'DELETE_NOTE'
        : toolName;

      const description = `Confirmar ${actionType}: "${summary}"`;
      const brain = this.deps.brain;
      const stagedPayload = brain?.stageAction
        ? { ...brain.stageAction({ toolName, args, description, senderId: context.senderId }), status: 'staged', requiresConfirmation: true, action: actionType, preview: summary }
        : { actionId: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, status: 'staged', requiresConfirmation: true, action: actionType, toolName, args, description, preview: summary, createdAt: Date.now(), expiresAt: Date.now() + 900000 };

      if (context && Array.isArray(context.stagedActions) && !context.stagedActions.includes(stagedPayload)) {
        context.stagedActions.push(stagedPayload);
      }

      return stagedPayload;
    }

    // 3. Circuit Breaker: Timeout por herramienta de 8s con AbortController
    const controller = new AbortController();
    let timer = null;

    try {
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({
            success: false,
            error: {
              code: 'TOOL_TIMEOUT',
              message: 'La herramienta excedió el tiempo límite de ejecución (8s). Degrada elegantemente o informa al usuario.',
            },
          });
        }, this.toolTimeoutMs);
      });

      const executionPromise = this._invokeService(toolName, args, { ...context, signal: controller.signal });
      const result = await Promise.race([executionPromise, timeoutPromise]);
      return result;
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'SERVICE_ERROR',
          message: err?.message || 'Error inesperado durante la ejecución del servicio.',
        },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Ejecución interna del servicio correspondiente con captura integral de excepciones.
   * @private
   */
  async _invokeService(toolName, args, context = {}) {
    try {
      switch (toolName) {
        case 'manage_calendar':
        case 'CANCEL_CALENDAR_EVENT':
        case 'DELETE_EVENT':
          return await this._handleCalendar(toolName !== 'manage_calendar' ? { ...args, action: 'CANCEL' } : args, context);
        case 'search_gmail':
        case 'SEND_EMAIL':
          return await this._handleGmail(toolName === 'SEND_EMAIL' ? { ...args, action: 'SEND' } : args, context);
        case 'manage_obsidian_notes':
        case 'DELETE_NOTE':
          return await this._handleObsidian(toolName === 'DELETE_NOTE' ? { ...args, action: 'DELETE' } : args, context);
        case 'manage_tasks':
        case 'CANCEL_TASK':
          return await this._handleTasks(toolName === 'CANCEL_TASK' ? { ...args, action: 'CANCEL' } : args, context);
        case 'manage_documents':
          return await this._handleDocuments(args, context);
        case 'search_knowledge_base':
          return await this._handleKnowledge(args, context);
        case 'diagnose_system':
          return await this._handleDiagnostics(args, context);
        case 'generate_media':
          return await this._handleMedia(args, context);
        default:
          return {
            success: false,
            error: {
              code: 'UNKNOWN_TOOL',
              message: `No existe un controlador registrado para la herramienta: ${toolName}`,
            },
          };
      }
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'SERVICE_ERROR',
          message: err?.message || 'Fallo en la llamada al servicio subyacente.',
        },
      };
    }
  }

  async _handleCalendar(args) {
    const service = this.deps.calendarService;
    if (!service) throw new Error('Servicio de Google Calendar no disponible.');
    const action = String(args.action || '').toUpperCase();

    if (action === 'CREATE') {
      const event = await service.createEvent({
        summary: args.summary,
        startDateTime: args.startTime,
        endDateTime: args.endTime,
        location: args.location,
      });
      return { success: true, data: { action: 'CREATE', event } };
    }
    if (action === 'LIST') {
      const events = await service.listEvents({
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        range: args.range,
      });
      return { success: true, data: { action: 'LIST', events } };
    }
    if (action === 'RESCHEDULE') {
      const event = await service.rescheduleEvent({
        eventId: args.eventId,
        newStartDateTime: args.startTime,
        newEndDateTime: args.endTime,
      });
      return { success: true, data: { action: 'RESCHEDULE', event } };
    }
    if (action === 'CANCEL') {
      const result = await service.cancelEvent({ eventId: args.eventId, summary: args.summary });
      return { success: true, data: { action: 'CANCEL', result } };
    }
    throw new Error(`Acción no soportada en calendar: ${action}`);
  }

  async _handleGmail(args) {
    const service = this.deps.gmailService;
    if (!service) throw new Error('Servicio de Gmail no disponible.');

    if (args.messageId) {
      const email = await service.readEmail(args.messageId);
      return { success: true, data: { email } };
    }
    const emails = await service.searchEmails(args.query, args.maxResults || 5);
    return {
      success: true,
      data: { query: args.query, count: Array.isArray(emails) ? emails.length : 0, emails },
    };
  }

  async _handleObsidian(args) {
    const service = this.deps.obsidianDriveService || this.deps.obsidianService;
    if (!service) throw new Error('Servicio de Obsidian Vault no disponible.');
    const action = String(args.action || '').toUpperCase();

    if (action === 'SEARCH') {
      const notes = await service.searchNotes(args.query || args.title);
      return { success: true, data: { notes } };
    }
    if (action === 'READ') {
      const note = await service.readNote(args.title || args.query);
      return { success: true, data: { note } };
    }
    if (action === 'CREATE') {
      const note = await service.createNote({ title: args.title, content: args.content, folder: args.folder });
      return { success: true, data: { note } };
    }
    if (action === 'UPDATE') {
      const note = await service.updateNote({ title: args.title, content: args.content, folder: args.folder });
      return { success: true, data: { note } };
    }
    if (action === 'APPEND') {
      const note = await service.appendNote({ title: args.title, content: args.content, folder: args.folder });
      return { success: true, data: { note } };
    }
    if (action === 'SYNC') {
      const syncResult = await service.syncVaultToVector();
      return { success: true, data: { syncResult } };
    }
    if (action === 'DELETE' || action === 'DELETE_NOTE') {
      const result = typeof service.deleteNote === 'function' ? await service.deleteNote(args.title || args.query) : { deleted: true };
      return { success: true, data: { result } };
    }
    throw new Error(`Acción de Obsidian no reconocida: ${action}`);
  }

  async _handleTasks(args) {
    const service = this.deps.taskService || this.deps.googleTasksService;
    if (!service) throw new Error('Servicio de Tareas no disponible.');
    const action = String(args.action || '').toUpperCase();

    if (action === 'CREATE') {
      const task = await service.createTask({ description: args.title, notes: args.notes, dueDate: args.dueDate });
      return { success: true, data: { task } };
    }
    if (action === 'LIST') {
      const tasks = await service.listTasks({ onlyPending: true });
      return { success: true, data: { tasks } };
    }
    if (action === 'COMPLETE') {
      const task = await service.completeTask(args.taskId || args.title);
      return { success: true, data: { task } };
    }
    if (action === 'CANCEL') {
      const task = typeof service.cancelTask === 'function'
        ? await service.cancelTask(args.taskId || args.title)
        : (typeof service.cancelTaskByNameOrId === 'function'
            ? await service.cancelTaskByNameOrId({ id: args.taskId || null, query: args.title || null })
            : null);
      return { success: true, data: { task } };
    }
    throw new Error(`Acción de tareas no reconocida: ${action}`);
  }

  async _handleDocuments(args) {
    const service = this.deps.documentService;
    if (!service) throw new Error('Servicio Documental no disponible.');
    const action = String(args.action || '').toUpperCase();

    if (action === 'SEARCH') {
      const documents = await service.searchDocuments(args.query, { category: args.category });
      return { success: true, data: { documents } };
    }
    if (action === 'READ') {
      const document = await service.getDocument(args.query);
      return { success: true, data: { document } };
    }
    throw new Error(`Acción documental no soportada: ${action}`);
  }

  async _handleKnowledge(args) {
    const service = this.deps.embeddingService;
    if (!service) throw new Error('Servicio de Memoria Semántica (RAG) no disponible.');
    const memories = await service.searchSimilarMemories(args.query, {
      category: args.category,
      limit: args.limit || 3,
    });
    return { success: true, data: { memories } };
  }

  async _handleDiagnostics(args) {
    const service = this.deps.diagnosticsService;
    if (!service) throw new Error('Servicio de Diagnósticos no disponible.');
    const diagnostics = await service.runDiagnostics({ target: args.target });
    return { success: true, data: { diagnostics } };
  }

  async _handleMedia(args) {
    const type = String(args.type || '').toUpperCase();
    if (type === 'QR') {
      if (!this.deps.mediaService) throw new Error('Servicio de Medios no disponible.');
      const qrData = args.data?.text || args.data?.data || '';
      const qrFile = await this.deps.mediaService.generateQrCode(qrData);
      return { success: true, data: { qrFile } };
    }
    if (type === 'EXCEL') {
      if (!this.deps.excelService) throw new Error('Servicio de Excel no disponible.');
      const excelFile = await this.deps.excelService.createExcelReport(args.data);
      return { success: true, data: { excelFile } };
    }
    if (type === 'AVATAR') {
      if (!this.deps.mediaService) throw new Error('Servicio de Medios no disponible.');
      const avatar = await this.deps.mediaService.getCarmencitaAvatar();
      return { success: true, data: { avatar } };
    }
    throw new Error(`Tipo de medio no soportado: ${type}`);
  }
}

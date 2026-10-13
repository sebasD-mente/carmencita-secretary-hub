import { validateToolArgs } from './schemas/index.js';
import { DriveToolSchema, handleDriveAction } from './drive.tools.js';
import { GenerateImageActionSchema } from '../validators/actions.schema.js';

/**
 * Despachador Tipado y Segregador de Herramientas para el Motor Agéntico de Carmencita.
 * Implementa validación Zod, Circuit Breakers con AbortController (8s / 25s media),
 * segregación READ vs. MUTATE (Staged Actions) y contratos tipados normalizados.
 */
export class ToolDispatcher {
  constructor(deps = {}, options = {}) {
    this.deps = deps || {};
    this.toolTimeoutMs = options.toolTimeoutMs || 12000;
  }

  isDestructiveAction(toolName, args = {}) {
    if (['DELETE_EVENT', 'CANCEL_CALENDAR_EVENT', 'SEND_EMAIL', 'CANCEL_TASK', 'DELETE_NOTE', 'DELETE_DRIVE_FILE'].includes(toolName)) return true;
    const a = String(args.action || '').toUpperCase();
    return (toolName === 'manage_calendar' && ['CANCEL', 'DELETE', 'DELETE_EVENT'].includes(a))
      || (toolName === 'manage_tasks' && a === 'CANCEL')
      || (toolName === 'manage_obsidian_notes' && (a === 'DELETE' || a === 'DELETE_NOTE'))
      || (toolName === 'manage_drive' && a === 'DELETE');
  }

  async dispatch(toolName, rawArgs = {}, context = {}) {
    let validation;
    if (toolName === 'manage_drive' || toolName === 'DELETE_DRIVE_FILE') {
      const parsed = DriveToolSchema.safeParse(rawArgs);
      validation = parsed.success ? { valid: true, data: parsed.data } : { valid: false, error: parsed.error.format() };
    } else if (toolName === 'generate_image') {
      const parsed = GenerateImageActionSchema.safeParse(rawArgs);
      validation = parsed.success ? { valid: true, data: parsed.data } : { valid: false, error: parsed.error.format() };
    } else if (toolName === 'run_agy_task') {
      const prompt = rawArgs?.prompt || rawArgs?.task || rawArgs?.command;
      if (!prompt || typeof prompt !== 'string') {
        validation = { valid: false, error: { prompt: { _errors: ['El parámetro prompt es requerido.'] } } };
      } else {
        validation = { valid: true, data: { prompt } };
      }
    } else if (toolName === 'search_gmail' && rawArgs?.messageId && !rawArgs?.query) {
      validation = { valid: true, data: { ...rawArgs, query: '' } };
    } else {
      validation = validateToolArgs(toolName, rawArgs);
    }

    if (!validation.valid) {
      return { status: 'error', reason: 'INVALID_ARGUMENTS', message: 'Los argumentos suministrados no cumplen con el esquema requerido. Corrige los parámetros en el siguiente turno.', details: validation.error };
    }

    const args = validation.data;

    // Segregación READ vs. MUTATE Crítico (Staged Actions)
    if (!context.isConfirmed && !context.bypassStaging && this.isDestructiveAction(toolName, args)) {
      const summary = args.summary || args.title || args.name || args.fileId || args.eventId || args.taskId || `${toolName}:${args.action || 'MUTATE'}`;
      const actionType = toolName === 'manage_calendar' && (args.action === 'CANCEL' || args.action === 'DELETE') ? 'CANCEL_CALENDAR_EVENT'
        : toolName === 'manage_tasks' && args.action === 'CANCEL' ? 'CANCEL_TASK'
        : toolName === 'manage_obsidian_notes' && args.action === 'DELETE' ? 'DELETE_NOTE'
        : toolName === 'manage_drive' && args.action === 'DELETE' ? 'DELETE_DRIVE_FILE'
        : toolName;

      const description = `Confirmar ${actionType}: "${summary}"`;
      const brain = this.deps.brain;
      const stagedPayload = brain?.stageAction
        ? { ...brain.stageAction({ toolName, args, description, senderId: context.senderId }), status: 'staged', requiresConfirmation: true, action: actionType, preview: summary }
        : { actionId: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, status: 'staged', requiresConfirmation: true, action: actionType, toolName, args, description, preview: summary, createdAt: Date.now(), expiresAt: Date.now() + 1800000 };

      if (context && Array.isArray(context.stagedActions) && !context.stagedActions.includes(stagedPayload)) {
        context.stagedActions.push(stagedPayload);
      }
      return stagedPayload;
    }

    // Circuit Breaker: Timeout por herramienta con AbortController
    const controller = new AbortController();
    let timer = null;

    try {
      const timeoutLimit = toolName === 'generate_image' ? 20000 : this.toolTimeoutMs;
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({
            success: false,
            error: { code: 'TOOL_TIMEOUT', message: 'La herramienta excedió el tiempo límite de ejecución.' },
          });
        }, timeoutLimit);
      });

      const executionPromise = this._invokeService(toolName, args, { ...context, signal: controller.signal });
      return await Promise.race([executionPromise, timeoutPromise]);
    } catch (err) {
      return { success: false, error: { code: 'SERVICE_ERROR', message: err?.message || 'Error inesperado durante la ejecución del servicio.' } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

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
        case 'manage_drive':
        case 'DELETE_DRIVE_FILE':
          return await this._handleDrive(toolName === 'DELETE_DRIVE_FILE' ? { ...args, action: 'DELETE' } : args, context);
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
        case 'generate_image':
          return await this._handleImage(args, context);
        case 'run_agy_task':
          return await this._handleAgy(args, context);
        default:
          return { success: false, error: { code: 'UNKNOWN_TOOL', message: `No existe un controlador registrado para la herramienta: ${toolName}` } };
      }
    } catch (err) {
      return { success: false, error: { code: 'SERVICE_ERROR', message: err?.message || 'Fallo en la llamada al servicio subyacente.' } };
    }
  }

  async _handleCalendar(args) {
    const service = this.deps.calendarService;
    if (!service) throw new Error('Servicio de Google Calendar no disponible.');
    const action = String(args.action || '').toUpperCase();
    if (action === 'CREATE') return { success: true, data: { action, event: await service.createEvent({ summary: args.summary, startDateTime: args.startTime, endDateTime: args.endTime, location: args.location }) } };
    if (action === 'LIST') {
      const timeMin = args.timeMin || args.startTime || args.startDate;
      const timeMax = args.timeMax || args.endTime || args.endDate;
      const events = await service.listEvents({ timeMin, timeMax, range: args.range, maxResults: args.maxResults });
      return { success: true, data: { action, count: events?.length || 0, events } };
    }
    if (action === 'RESCHEDULE') return { success: true, data: { action, event: await service.rescheduleEvent({ eventId: args.eventId, newStartDateTime: args.startTime, newEndDateTime: args.endTime }) } };
    if (action === 'CANCEL') return { success: true, data: { action, result: await service.cancelEvent({ eventId: args.eventId, summary: args.summary }) } };
    throw new Error(`Acción no soportada en calendar: ${action}`);
  }

  async _handleGmail(args) {
    const service = this.deps.gmailService;
    if (!service) throw new Error('Servicio de Gmail no disponible.');
    if (args.messageId) {
      const email = await service.getEmailDetails({ messageId: args.messageId });
      return { success: true, data: { email } };
    }
    const searchPayload = {
      query: args.query || '',
      maxResults: args.maxResults || 5,
      onlyImportant: args.onlyImportant ?? false,
      includeRead: args.includeRead ?? true,
    };
    const callArg = (typeof service.getEmailDetails === 'function' || service.isStructured || !service.searchEmails || service.getInboxSummary)
      ? searchPayload
      : (service.searchEmails.length === 1 ? (args.query || '') : searchPayload);
    const emails = await service.searchEmails(callArg);
    return { success: true, data: { query: args.query || '', count: Array.isArray(emails) ? emails.length : 0, emails } };
  }

  async _handleAgy(args) {
    const agy = this.deps.agyBridge;
    if (!agy) throw new Error('AgyBridge no disponible en despachador.');
    const result = await agy.executeTask(args.prompt);
    return { success: result?.success ?? true, data: result };
  }

  async _handleObsidian(args) {
    const service = this.deps.obsidianDriveService || this.deps.obsidianService;
    if (!service) throw new Error('Servicio de Obsidian Vault no disponible.');
    const action = String(args.action || '').toUpperCase();

    if (action === 'SEARCH') return { success: true, data: { notes: await service.searchNotes(args.query || args.title) } };
    if (action === 'READ') return { success: true, data: { note: await service.readNote(args.title || args.query) } };
    if (action === 'CREATE') return { success: true, data: { note: await service.createNote({ title: args.title, content: args.content, folder: args.folder }) } };
    if (action === 'UPDATE') return { success: true, data: { note: await service.updateNote({ title: args.title, content: args.content, folder: args.folder }) } };
    if (action === 'APPEND') return { success: true, data: { note: await service.appendNote({ title: args.title, content: args.content, folder: args.folder }) } };
    if (action === 'SYNC') return { success: true, data: { syncResult: await service.syncVaultToVector() } };
    if (action === 'DELETE' || action === 'DELETE_NOTE') {
      const result = typeof service.deleteNote === 'function' ? await service.deleteNote(args.title || args.query) : { deleted: true };
      return { success: true, data: { result } };
    }
    throw new Error(`Acción de Obsidian no reconocida: ${action}`);
  }

  async _handleDrive(args) {
    const service = this.deps.googleDriveService || this.deps.driveService;
    return await handleDriveAction(service, args);
  }

  async _handleTasks(args) {
    const service = this.deps.taskService || this.deps.googleTasksService;
    if (!service) throw new Error('Servicio de Tareas no disponible.');
    const action = String(args.action || '').toUpperCase();

    if (action === 'CREATE') return { success: true, data: { task: await service.createTask({ description: args.title, notes: args.notes, dueDate: args.dueDate }) } };
    if (action === 'LIST') return { success: true, data: { tasks: await service.listTasks({ onlyPending: true }) } };
    if (action === 'COMPLETE') return { success: true, data: { task: await service.completeTask(args.taskId || args.title) } };
    if (action === 'CANCEL') {
      const task = typeof service.cancelTask === 'function' ? await service.cancelTask(args.taskId || args.title)
        : (typeof service.cancelTaskByNameOrId === 'function' ? await service.cancelTaskByNameOrId({ id: args.taskId || null, query: args.title || null }) : null);
      return { success: true, data: { task } };
    }
    throw new Error(`Acción de tareas no reconocida: ${action}`);
  }

  async _handleDocuments(args) {
    const service = this.deps.documentService;
    if (!service) throw new Error('Servicio Documental no disponible.');
    const action = String(args.action || '').toUpperCase();

    if (action === 'SEARCH') return { success: true, data: { documents: await service.searchDocuments(args.query, { category: args.category }) } };
    if (action === 'READ') return { success: true, data: { document: await service.getDocument(args.query) } };
    throw new Error(`Acción documental no soportada: ${action}`);
  }

  async _handleKnowledge(args) {
    const service = this.deps.embeddingService;
    if (!service) throw new Error('Servicio de Memoria Semántica (RAG) no disponible.');
    const memories = await service.searchSimilarMemories(args.query, { category: args.category, limit: args.limit || 3 });
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
      const qrFile = await this.deps.mediaService.generateQrCode(args.data?.text || args.data?.data || '');
      return {
        success: true,
        data: {
          summary: `Código QR generado para: ${args.data?.text || 'enlace'}`,
          filePath: qrFile?.filePath,
          fileName: qrFile?.fileName,
          qrFile, // Preservado para el adapter
        },
      };
    }
    if (type === 'EXCEL') {
      if (!this.deps.excelService) throw new Error('Servicio de Excel no disponible.');
      const excelFile = await this.deps.excelService.generateExcelFile(args.data || {});
      return {
        success: true,
        data: {
          summary: `Hoja de cálculo generada: ${excelFile?.fileName}`,
          fileName: excelFile?.fileName,
          mimeType: excelFile?.mimeType,
          excelFile, // Preservado para el adapter
        },
      };
    }
    if (type === 'AVATAR') {
      if (!this.deps.mediaService) throw new Error('Servicio de Medios no disponible.');
      return { success: true, data: { avatar: await this.deps.mediaService.getCarmencitaAvatar() } };
    }
    throw new Error(`Tipo de medio no soportado: ${type}`);
  }

  async _handleImage(args, context = {}) {
    const service = this.deps.imageGenerationService;
    if (!service) throw new Error('Servicio de Generación de Imágenes no disponible.');
    const result = await service.generateImage({
      prompt: args.prompt,
      aspectRatio: args.aspectRatio,
      mode: args.mode,
      style: args.style,
      signal: context.signal,
    });

    if (result?.isSafetyBlock) {
      return { success: false, isSafetyBlock: true, reason: result.reason || 'SAFETY_FILTER_TRIGGERED', data: result };
    }

    // Tool Response Envelope: retorno liviano con resumen y URL de GCS
    const assetUrl = result.cloudUrl || result.publicUrl || '';
    return {
      success: true,
      data: {
        assetUrl,
        filePath: result.filePath,
        fileName: result.fileName,
        dimensions: result.aspectRatio || '1:1',
        summary: `Render generado exitosamente (${result.mode || 'arte_final'}) con ${result.model}: ${result.fileName}`,
        model: result.model,
        buffer: result.buffer, // Preservado para que mapToolSummaryToActionResult arme photoFile hacia Telegram
      },
    };
  }
}

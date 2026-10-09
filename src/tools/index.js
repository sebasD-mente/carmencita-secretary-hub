import { handleObsidianAction } from './obsidian.tools.js';
import { handleWorkspaceAction } from './workspace.tools.js';
import { handleSystemAction } from './system.tools.js';
import { handleMediaAction } from './media.tools.js';
import { handleDocumentsAction } from './documents.tools.js';
import { parseCarmencitaAction } from '../validators/actions.schema.js';

/**
 * Estandariza la respuesta de cualquier acción ejecutada en el Hub.
 */
export function makeActionResult(opts = {}) {
  return {
    reply: opts.reply,
    hasAsyncAction: opts.hasAsyncAction || false,
    hasExcel: opts.hasExcel || false, excelFile: opts.excelFile || null,
    hasPhoto: opts.hasPhoto || false, photoFile: opts.photoFile || null,
    hasVoice: opts.hasVoice || false, voiceFile: opts.voiceFile || null,
    hasDocument: opts.hasDocument || false, documentFile: opts.documentFile || null,
    hasDocuments: opts.hasDocuments || false, documents: opts.documents || null,
    hasCalendarEvent: opts.hasCalendarEvent || false,
    calendarEvent: opts.calendarEvent || null, calendarEvents: opts.calendarEvents || null,
    contact: opts.contact || null, contacts: opts.contacts || null,
    hasMemory: opts.hasMemory || false,
    hasObsidianNote: opts.hasObsidianNote || false, obsidianNote: opts.obsidianNote || null,
    hasObsidianNotes: opts.hasObsidianNotes || false, obsidianNotes: opts.obsidianNotes || null,
    hasGmailEmails: opts.hasGmailEmails || false, gmailEmails: opts.gmailEmails || null,
    hasTask: opts.hasTask || false, task: opts.task || null, tasks: opts.tasks || null,
    fullHistoryText: opts.fullHistoryText || opts.reply,
    actionData: opts.actionData || null, initialAck: opts.initialAck || null, report: opts.report || null,
    progressSent: opts.progressSent || false, syncResult: opts.syncResult || null, hasObsidianSync: Boolean(opts.syncResult),
    hasDiagnostics: opts.hasDiagnostics || false, diagnostics: opts.diagnostics || null,
    toString() { return this.reply; },
    includes(s) { return this.reply.includes(s); },
  };
}

/**
 * Extractor quirúrgico y seguro de bloques JSON de acción en texto de LLM.
 */
export function extractActionJson(rawText) {
  if (!rawText) return null;
  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?\{[\s\S]*?"action"[\s\S]*?\})\s*```/i);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (parsed?.action) return { parsed, matchedString: codeBlockMatch[0] };
    } catch {}
  }
  const actionIndex = rawText.indexOf('"action"');
  if (actionIndex !== -1) {
    const openBrace = rawText.lastIndexOf('{', actionIndex);
    if (openBrace !== -1) {
      let depth = 0;
      for (let i = openBrace; i < rawText.length; i++) {
        if (rawText[i] === '{') depth++;
        else if (rawText[i] === '}' && --depth === 0) {
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
  return null;
}

/**
 * Sanitiza el texto de respuesta eliminando bloques de código JSON con "action",
 * objetos JSON residuales y colapsando saltos de línea para Telegram.
 */
export function sanitizeReplyText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let cleaned = rawText.replace(/```(?:json)?\s*[\s\S]*?\{[\s\S]*?"action"[\s\S]*?\}[\s\S]*?```/gi, '');
  let safety = 0;
  while (safety++ < 10) {
    const actionIndex = cleaned.indexOf('"action"');
    if (actionIndex === -1) break;
    const openBrace = cleaned.lastIndexOf('{', actionIndex);
    if (openBrace === -1) break;
    let depth = 0, closed = false;
    for (let i = openBrace; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}' && --depth === 0) {
        cleaned = cleaned.slice(0, openBrace) + cleaned.slice(i + 1);
        closed = true;
        break;
      }
    }
    if (!closed) break;
  }
  return cleaned.replace(/```(?:json)?\s*```/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Asistente de síntesis agéntica para resultados de herramientas.
 */
export async function synthesizeToolResults(deps, { userText, toolName, dataSummary, context = {} }) {
  if (typeof deps?.synthesizeToolResults === 'function') {
    return await deps.synthesizeToolResults({ userText, toolName, dataSummary, context });
  }
  if (typeof deps?.brain?._synthesizeToolResults === 'function') {
    return await deps.brain._synthesizeToolResults({ userText, toolName, dataSummary, context });
  }
  return `Sebastián querido, aquí tengo la información recuperada de ${toolName}:\n\n${dataSummary}`;
}

const OBSIDIAN_ACTIONS = new Set([
  'SAVE_OBSIDIAN_NOTE', 'UPDATE_OBSIDIAN_NOTE', 'READ_OBSIDIAN_NOTE',
  'APPEND_OBSIDIAN_NOTE', 'SEARCH_OBSIDIAN_NOTES', 'SYNC_OBSIDIAN_VAULT',
]);

const WORKSPACE_ACTIONS = new Set([
  'CHECK_GMAIL', 'CREATE_CALENDAR_EVENT', 'LIST_CALENDAR_EVENTS',
  'RESCHEDULE_CALENDAR_EVENT', 'CANCEL_CALENDAR_EVENT', 'SAVE_TASK',
  'COMPLETE_TASK', 'CANCEL_TASK', 'LIST_TASKS', 'SAVE_CONTACT', 'SEARCH_CONTACT',
]);

const SYSTEM_ACTIONS = new Set(['DIAGNOSE_SYSTEM', 'RUN_AGY_TASK']);
const MEDIA_ACTIONS = new Set(['GENERATE_QR', 'SEND_MEDIA', 'SEND_VOICE', 'GENERATE_EXCEL']);
const DOCUMENT_ACTIONS = new Set(['SEARCH_DOCUMENTS', 'SAVE_IDEA', 'SAVE_MEMORY']);

/**
 * Enrutador central de herramientas modulares con soporte de Chaining multi-paso.
 */
export async function executeAction(parsedAction, deps, context = {}) {
  const actionName = parsedAction?.action;

  let result = null;
  if (OBSIDIAN_ACTIONS.has(actionName)) result = await handleObsidianAction(parsedAction, deps, context);
  else if (WORKSPACE_ACTIONS.has(actionName)) result = await handleWorkspaceAction(parsedAction, deps, context);
  else if (SYSTEM_ACTIONS.has(actionName)) result = await handleSystemAction(parsedAction, deps, context);
  else if (MEDIA_ACTIONS.has(actionName)) result = await handleMediaAction(parsedAction, deps, context);
  else if (DOCUMENT_ACTIONS.has(actionName)) result = await handleDocumentsAction(parsedAction, deps, context);
  else result = makeActionResult({ reply: context?.cleanText || '' });

  // Si ya estamos en ejecución encadenada secundaria, evitar bucles infinitos (profundidad máxima = 1)
  if (context._isChained) {
    if (result && typeof result.reply === 'string') result.reply = sanitizeReplyText(result.reply);
    return result;
  }

  // Inspeccionar si result.reply contiene una acción secundaria
  if (result && typeof result.reply === 'string') {
    const secondary = extractActionJson(result.reply);
    if (secondary?.parsed) {
      let secondaryAction = null;
      try {
        secondaryAction = parseCarmencitaAction(secondary.parsed);
      } catch (err) {
        console.warn('[Tool Chaining] Error parseando acción secundaria:', err.message);
      }

      if (secondaryAction) {
        const sanitizedPrimaryReply = sanitizeReplyText(result.reply);
        const secondaryResult = await executeAction(secondaryAction, deps, {
          ...context,
          cleanText: sanitizedPrimaryReply,
          _isChained: true,
        });

        // Combinar armónicamente el resultado de la acción secundaria con el primario
        let combinedReply = sanitizedPrimaryReply;
        if (secondaryResult?.reply && secondaryResult.reply !== sanitizedPrimaryReply) {
          combinedReply = secondaryResult.reply.includes(sanitizedPrimaryReply)
            ? secondaryResult.reply
            : `${sanitizedPrimaryReply}\n\n${secondaryResult.reply}`.trim();
        }

        let combinedHistory = result.fullHistoryText || sanitizedPrimaryReply;
        if (secondaryResult.fullHistoryText) {
          combinedHistory = secondaryResult.fullHistoryText.includes(sanitizedPrimaryReply)
            ? secondaryResult.fullHistoryText
            : `${combinedHistory}\n${secondaryResult.fullHistoryText}`.trim();
        }

        return makeActionResult({
          ...result, ...secondaryResult,
          reply: sanitizeReplyText(combinedReply),
          fullHistoryText: combinedHistory,
          hasCalendarEvent: Boolean(result.hasCalendarEvent || secondaryResult.hasCalendarEvent),
          calendarEvent: secondaryResult.calendarEvent || result.calendarEvent,
          calendarEvents: secondaryResult.calendarEvents || result.calendarEvents,
          hasTask: Boolean(result.hasTask || secondaryResult.hasTask),
          task: secondaryResult.task || result.task, tasks: secondaryResult.tasks || result.tasks,
          hasGmailEmails: Boolean(result.hasGmailEmails || secondaryResult.hasGmailEmails),
          gmailEmails: secondaryResult.gmailEmails || result.gmailEmails,
          hasObsidianNote: Boolean(result.hasObsidianNote || secondaryResult.hasObsidianNote),
          obsidianNote: secondaryResult.obsidianNote || result.obsidianNote,
          hasVoice: Boolean(result.hasVoice || secondaryResult.hasVoice),
          voiceFile: secondaryResult.voiceFile || result.voiceFile,
        });
      }
    }

    result.reply = sanitizeReplyText(result.reply);
  }

  return result;
}

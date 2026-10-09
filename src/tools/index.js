import { handleObsidianAction } from './obsidian.tools.js';
import { handleWorkspaceAction } from './workspace.tools.js';
import { handleSystemAction } from './system.tools.js';
import { handleMediaAction } from './media.tools.js';
import { handleDocumentsAction } from './documents.tools.js';

/**
 * Estandariza la respuesta de cualquier acción ejecutada en el Hub.
 */
export function makeActionResult(opts = {}) {
  return {
    reply: opts.reply,
    hasAsyncAction: opts.hasAsyncAction || false,
    hasExcel: opts.hasExcel || false,
    hasPhoto: opts.hasPhoto || false,
    photoFile: opts.photoFile || null,
    hasVoice: opts.hasVoice || false,
    voiceFile: opts.voiceFile || null,
    hasDocument: opts.hasDocument || false,
    documentFile: opts.documentFile || null,
    hasDocuments: opts.hasDocuments || false,
    documents: opts.documents || null,
    hasCalendarEvent: opts.hasCalendarEvent || false,
    calendarEvent: opts.calendarEvent || null,
    calendarEvents: opts.calendarEvents || null,
    contact: opts.contact || null,
    contacts: opts.contacts || null,
    excelFile: opts.excelFile || null,
    hasMemory: opts.hasMemory || false,
    hasObsidianNote: opts.hasObsidianNote || false,
    obsidianNote: opts.obsidianNote || null,
    hasObsidianNotes: opts.hasObsidianNotes || false,
    obsidianNotes: opts.obsidianNotes || null,
    hasGmailEmails: opts.hasGmailEmails || false,
    gmailEmails: opts.gmailEmails || null,
    hasTask: opts.hasTask || false,
    task: opts.task || null,
    tasks: opts.tasks || null,
    fullHistoryText: opts.fullHistoryText || opts.reply,
    actionData: opts.actionData || null,
    initialAck: opts.initialAck || null,
    report: opts.report || null,
    progressSent: opts.progressSent || false,
    syncResult: opts.syncResult || null,
    hasObsidianSync: Boolean(opts.syncResult),
    hasDiagnostics: opts.hasDiagnostics || false,
    diagnostics: opts.diagnostics || null,
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
 * Enrutador central de herramientas modulares.
 */
export async function executeAction(parsedAction, deps, context = {}) {
  const actionName = parsedAction?.action;

  if (OBSIDIAN_ACTIONS.has(actionName)) return await handleObsidianAction(parsedAction, deps, context);
  if (WORKSPACE_ACTIONS.has(actionName)) return await handleWorkspaceAction(parsedAction, deps, context);
  if (SYSTEM_ACTIONS.has(actionName)) return await handleSystemAction(parsedAction, deps, context);
  if (MEDIA_ACTIONS.has(actionName)) return await handleMediaAction(parsedAction, deps, context);
  if (DOCUMENT_ACTIONS.has(actionName)) return await handleDocumentsAction(parsedAction, deps, context);

  return makeActionResult({ reply: context?.cleanText || '' });
}

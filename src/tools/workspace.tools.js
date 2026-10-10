import { makeActionResult } from './index.js';
import { handleCalendarAction, formatEventDates } from './workspace/calendar.tools.js';
import { handleGmailAction } from './workspace/gmail.tools.js';
import { handleTasksAction } from './workspace/tasks.tools.js';
import { handleContactsAction } from './workspace/contacts.tools.js';

export { formatEventDates, handleCalendarAction, handleGmailAction, handleTasksAction, handleContactsAction };

const CALENDAR_ACTIONS = new Set(['CREATE_CALENDAR_EVENT', 'LIST_CALENDAR_EVENTS', 'RESCHEDULE_CALENDAR_EVENT', 'CANCEL_CALENDAR_EVENT']);
const GMAIL_ACTIONS = new Set(['CHECK_GMAIL']);
const TASK_ACTIONS = new Set(['SAVE_TASK', 'COMPLETE_TASK', 'CANCEL_TASK', 'LIST_TASKS']);
const CONTACT_ACTIONS = new Set(['SAVE_CONTACT', 'SEARCH_CONTACT']);

/**
 * Fachada compacta de Herramientas de Espacio de Trabajo.
 * Enruta de forma unificada hacia calendar, gmail, tasks y contacts.
 */
export async function handleWorkspaceAction(parsedAction, deps, context = {}) {
  const action = parsedAction?.action;
  if (CALENDAR_ACTIONS.has(action)) return await handleCalendarAction(parsedAction, deps, context);
  if (GMAIL_ACTIONS.has(action)) return await handleGmailAction(parsedAction, deps, context);
  if (TASK_ACTIONS.has(action)) return await handleTasksAction(parsedAction, deps, context);
  if (CONTACT_ACTIONS.has(action)) return await handleContactsAction(parsedAction, deps, context);
  return makeActionResult({ reply: context?.cleanText || '' });
}

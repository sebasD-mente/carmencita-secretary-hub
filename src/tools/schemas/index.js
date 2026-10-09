import { z } from 'zod';
import { CalendarToolSchema } from './calendar.schema.js';
import { GmailToolSchema } from './gmail.schema.js';
import { ObsidianToolSchema } from './obsidian.schema.js';
import { TasksToolSchema } from './tasks.schema.js';
import { KnowledgeToolSchema } from './knowledge.schema.js';

export const DocumentsToolSchema = z.object({
  action: z.enum(['SEARCH', 'READ']),
  query: z.coerce.string().min(1, 'El término de búsqueda documental no puede estar vacío'),
  category: z.coerce.string().optional(),
});

export const DiagnoseToolSchema = z.object({
  target: z.enum(['status', 'docker', 'system']).default('status').optional(),
});

export const MediaToolSchema = z.object({
  type: z.enum(['QR', 'EXCEL', 'AVATAR']),
  data: z.record(z.any()).optional(),
});

export const TOOL_SCHEMAS = {
  manage_calendar: CalendarToolSchema,
  search_gmail: GmailToolSchema,
  manage_obsidian_notes: ObsidianToolSchema,
  manage_tasks: TasksToolSchema,
  manage_documents: DocumentsToolSchema,
  search_knowledge_base: KnowledgeToolSchema,
  diagnose_system: DiagnoseToolSchema,
  generate_media: MediaToolSchema,
  // Alias de acciones críticas y directas
  DELETE_EVENT: CalendarToolSchema,
  SEND_EMAIL: GmailToolSchema,
  CANCEL_TASK: TasksToolSchema,
};

/**
 * Valida de forma coercitiva los argumentos de una llamada a herramienta tipada.
 * @param {string} toolName
 * @param {Record<string, unknown>} rawArgs
 * @returns {{ valid: true, data: Record<string, unknown> } | { valid: false, error: Record<string, unknown> }}
 */
export function validateToolArgs(toolName, rawArgs = {}) {
  const schema = TOOL_SCHEMAS[toolName];
  if (!schema) {
    return {
      valid: false,
      error: {
        _errors: [`Herramienta no registrada en el catálogo de validación Zod: "${toolName}"`],
      },
    };
  }

  const result = schema.safeParse(rawArgs);
  if (result.success) {
    return { valid: true, data: result.data };
  }

  return { valid: false, error: result.error.format() };
}

export {
  CalendarToolSchema,
  GmailToolSchema,
  ObsidianToolSchema,
  TasksToolSchema,
  KnowledgeToolSchema,
};

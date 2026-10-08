import { z } from 'zod';

export const PrioritySchema = z
  .string()
  .transform((val) => val.toUpperCase())
  .pipe(z.enum(['ALTA', 'MEDIA', 'BAJA']))
  .catch('MEDIA');

export const TaskStatusSchema = z
  .string()
  .transform((val) => {
    const v = val.toUpperCase();
    if (v === 'PENDING') return 'PENDIENTE';
    if (v === 'IN_PROGRESS') return 'EN_PROGRESO';
    if (v === 'COMPLETED') return 'COMPLETADA';
    if (v === 'CANCELLED') return 'CANCELADA';
    return v;
  })
  .pipe(z.enum(['PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'CANCELADA']))
  .catch('PENDIENTE');

export const DocumentCategorySchema = z
  .string()
  .transform((val) => val.toUpperCase())
  .pipe(
    z.enum([
      'FACTURA',
      'CONTRATO',
      'COTIZACION',
      'HOJA_CALCULO',
      'IDENTIFICACION',
      'PROYECTO_BRIEF',
      'GENERAL',
    ])
  )
  .catch('GENERAL');

export const RunAgyTaskActionSchema = z.object({
  action: z.literal('RUN_AGY_TASK'),
  prompt: z.string().min(1, 'El prompt no puede estar vacío'),
});

export const GenerateExcelActionSchema = z.object({
  action: z.literal('GENERATE_EXCEL'),
  title: z.string().min(1, 'El título del reporte es obligatorio'),
  sheetName: z.string().default('Datos'),
  columns: z
    .array(
      z.object({
        header: z.string(),
        key: z.string(),
        width: z.number().optional(),
      })
    )
    .min(1, 'Debe especificar al menos una columna'),
  // Filas del reporte: acepta celdas con números, cadenas ("[PENDIENTE]", ""), null, booleanos o fórmulas
  rows: z.array(z.record(z.string(), z.any())).default([]),
  summary: z.string().optional(),
});

export const SaveIdeaActionSchema = z.object({
  action: z.literal('SAVE_IDEA'),
  title: z.string().min(1, 'El título de la idea es obligatorio'),
  summary: z.string().min(1, 'El resumen ejecutivo es obligatorio'),
  rawText: z.string().optional(),
  priority: PrioritySchema.default('MEDIA'),
  tags: z.array(z.string()).default([]),
});

export const SaveTaskActionSchema = z.object({
  action: z.literal('SAVE_TASK'),
  description: z.string().min(1, 'La descripción de la tarea es obligatoria'),
  due: z.string().optional().nullable(),
  dueDate: z.string().or(z.date()).optional().nullable(),
  priority: PrioritySchema.default('MEDIA'),
});

export const InvoiceMetadataSchema = z.object({
  vendor: z.string().min(1, 'El proveedor es obligatorio'),
  item: z.string().min(1, 'El producto o concepto es obligatorio'),
  totalAmount: z
    .union([z.number(), z.string()])
    .transform((val) => {
      if (typeof val === 'number') return val;
      const clean = val.replace(/[^0-9.-]+/g, '');
      const parsed = parseFloat(clean);
      return isNaN(parsed) ? 0 : parsed;
    }),
  currency: z.string().default('GTQ'),
  purchaseDate: z.string().or(z.date()).optional().nullable(),
  warrantyMonths: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v : parseInt(v, 10) || 0))
    .default(0),
  warrantyUntil: z.string().or(z.date()).optional().nullable(),
  isExpense: z.boolean().default(true),
  notes: z.string().optional().nullable(),
});

export const SaveDocumentActionSchema = z.object({
  action: z.literal('SAVE_DOCUMENT').optional(),
  fileName: z.string().min(1),
  originalName: z.string().min(1),
  mimeType: z.string(),
  category: DocumentCategorySchema.default('GENERAL'),
  filePath: z.string().optional(),
  fileSize: z.number().optional(),
  summary: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
  invoice: InvoiceMetadataSchema.optional().nullable(),
});

export const CreateCalendarEventActionSchema = z.object({
  action: z.literal('CREATE_CALENDAR_EVENT'),
  summary: z.string().min(1, 'El resumen o título del evento es obligatorio'),
  startDateTime: z.string().min(1, 'La fecha y hora de inicio es obligatoria'),
  endDateTime: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
});

export const ListCalendarEventsActionSchema = z.object({
  action: z.literal('LIST_CALENDAR_EVENTS'),
  range: z.enum(['TODAY', 'TOMORROW', 'UPCOMING']).default('TODAY'),
  date: z.string().optional().nullable(),
});

export const SaveContactActionSchema = z.object({
  action: z.literal('SAVE_CONTACT'),
  name: z.string().min(1, 'El nombre es obligatorio'),
  role: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const SearchContactActionSchema = z.object({
  action: z.literal('SEARCH_CONTACT'),
  query: z.string().min(1, 'El término de búsqueda es obligatorio'),
});

export const SaveMemoryActionSchema = z.object({
  action: z.literal('SAVE_MEMORY'),
  content: z.string().min(1, 'El contenido del recuerdo es obligatorio'),
  category: z.enum(['PREFERENCIA', 'ACUERDO', 'PROVEEDOR', 'DIRECTIVA', 'GENERAL']).default('GENERAL'),
  reason: z.string().optional(),
});

export const SaveObsidianNoteActionSchema = z.object({
  action: z.literal('SAVE_OBSIDIAN_NOTE'),
  title: z.string().min(1, 'El título de la nota es obligatorio'),
  content: z.string().min(1, 'El contenido de la nota es obligatorio'),
  folder: z.string().default('01_Inbox'),
  tags: z.array(z.string()).default([]),
  wikilinks: z.array(z.string()).default([]),
  summary: z.string().optional(),
});

export const SearchObsidianNotesActionSchema = z.object({
  action: z.literal('SEARCH_OBSIDIAN_NOTES'),
  query: z.string().optional().default(''),
  folder: z.string().optional().nullable(),
  maxResults: z.number().optional().default(20), // Elevado de 5 a 20
});

export const CheckGmailActionSchema = z.object({
  action: z.literal('CHECK_GMAIL'),
  query: z.string().optional().default(''), // Vacío por omisión para delegar la lógica al servicio
  maxResults: z.number().optional().default(5),
  onlyImportant: z.boolean().optional().default(false), // Default false para no filtrar búsquedas deliberadas
  readSingle: z.boolean().optional(),
});

export const GenerateQrActionSchema = z.object({
  action: z.literal('GENERATE_QR'),
  text: z.string().min(1, 'La URL o texto para el código QR es obligatorio'),
  title: z.string().optional().default('Código QR Oficial'),
  caption: z.string().optional(),
});

export const SendMediaActionSchema = z.object({
  action: z.literal('SEND_MEDIA'),
  mediaType: z.enum(['AVATAR', 'PROFILE', 'QR', 'DOCUMENT']).default('PROFILE'),
  filePath: z.string().optional(),
  caption: z.string().optional(),
});

export const SendVoiceActionSchema = z.object({
  action: z.literal('SEND_VOICE'),
  message: z.string().min(1, 'El mensaje de voz es obligatorio'),
});

export const ReadObsidianNoteActionSchema = z.object({
  action: z.literal('READ_OBSIDIAN_NOTE'),
  title: z.string().min(1, 'El título de la nota es obligatorio'),
  folder: z.string().optional().nullable(),
});

export const AppendObsidianNoteActionSchema = z.object({
  action: z.literal('APPEND_OBSIDIAN_NOTE'),
  title: z.string().min(1, 'El título de la nota es obligatorio'),
  content: z.string().min(1, 'El contenido a anexar es obligatorio'),
  folder: z.string().optional().nullable(),
});

export const CompleteTaskActionSchema = z.object({
  action: z.literal('COMPLETE_TASK'),
  query: z.string().optional().nullable(),
  id: z.string().optional().nullable(),
});

export const CancelTaskActionSchema = z.object({
  action: z.literal('CANCEL_TASK'),
  query: z.string().optional().nullable(),
  id: z.string().optional().nullable(),
});

export const ListTasksActionSchema = z.object({
  action: z.literal('LIST_TASKS'),
  status: z.enum(['PENDIENTE', 'COMPLETADA', 'TODAS']).optional().default('PENDIENTE'),
  limit: z.number().optional().default(20),
});

export const RescheduleCalendarEventActionSchema = z.object({
  action: z.literal('RESCHEDULE_CALENDAR_EVENT'),
  query: z.string().optional().nullable(),
  eventId: z.string().optional().nullable(),
  newStartDateTime: z.string().min(1, 'La nueva fecha y hora de inicio es obligatoria'),
  newEndDateTime: z.string().optional().nullable(),
});

export const CancelCalendarEventActionSchema = z.object({
  action: z.literal('CANCEL_CALENDAR_EVENT'),
  query: z.string().optional().nullable(),
  eventId: z.string().optional().nullable(),
});

export const SearchDocumentsActionSchema = z.object({
  action: z.literal('SEARCH_DOCUMENTS'),
  query: z.string().min(1, 'El término de búsqueda es obligatorio'),
  category: z.enum(['FACTURA', 'CONTRATO', 'COTIZACION', 'GENERAL', 'TODOS']).optional().default('TODOS'),
  limit: z.number().optional().default(5),
});

export const SyncObsidianVaultActionSchema = z.object({
  action: z.literal('SYNC_OBSIDIAN_VAULT'),
  force: z.boolean().optional().default(false),
});

export const UpdateObsidianNoteActionSchema = z.object({
  action: z.literal('UPDATE_OBSIDIAN_NOTE'),
  title: z.string().min(1, 'El título es requerido'),
  content: z.string().min(1, 'El contenido es requerido'),
  folder: z.string().optional(),
  tags: z.array(z.string()).optional(),
  wikilinks: z.array(z.string()).optional(),
});

export const DiagnoseSystemActionSchema = z.object({
  action: z.literal('DIAGNOSE_SYSTEM'),
  scope: z.enum(['full', 'errors', 'services', 'pm2']).optional().default('full'),
});

export const AnyCarmencitaActionSchema = z.discriminatedUnion('action', [
  RunAgyTaskActionSchema,
  GenerateExcelActionSchema,
  SaveIdeaActionSchema,
  SaveTaskActionSchema,
  CreateCalendarEventActionSchema,
  ListCalendarEventsActionSchema,
  SaveContactActionSchema,
  SearchContactActionSchema,
  SaveMemoryActionSchema,
  SaveObsidianNoteActionSchema,
  SearchObsidianNotesActionSchema,
  CheckGmailActionSchema,
  GenerateQrActionSchema,
  SendMediaActionSchema,
  SendVoiceActionSchema,
  ReadObsidianNoteActionSchema,
  AppendObsidianNoteActionSchema,
  CompleteTaskActionSchema,
  CancelTaskActionSchema,
  ListTasksActionSchema,
  RescheduleCalendarEventActionSchema,
  CancelCalendarEventActionSchema,
  SearchDocumentsActionSchema,
  SyncObsidianVaultActionSchema,
  UpdateObsidianNoteActionSchema,
  DiagnoseSystemActionSchema,
]);

export function parseCarmencitaAction(rawJson) {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const result = AnyCarmencitaActionSchema.safeParse(rawJson);
  if (result.success) return result.data;
  return null;
}


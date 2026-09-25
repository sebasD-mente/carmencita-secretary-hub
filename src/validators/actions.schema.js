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

export const AnyCarmencitaActionSchema = z.discriminatedUnion('action', [
  RunAgyTaskActionSchema,
  GenerateExcelActionSchema,
  SaveIdeaActionSchema,
  SaveTaskActionSchema,
]);

export function parseCarmencitaAction(rawJson) {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const result = AnyCarmencitaActionSchema.safeParse(rawJson);
  if (result.success) return result.data;
  return null;
}

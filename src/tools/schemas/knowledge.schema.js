import { z } from 'zod';

export const KnowledgeToolSchema = z.object({
  query: z.coerce.string().min(1, 'La consulta de búsqueda semántica no puede estar vacía'),
  category: z.enum(['ACUERDO', 'DIRECTIVA', 'PREFERENCIA', 'PROVEEDOR', 'GENERAL']).or(z.string()).optional(),
  limit: z.coerce.number().int().positive().default(3).optional(),
});

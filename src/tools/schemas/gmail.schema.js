import { z } from 'zod';

export const GmailToolSchema = z.object({
  query: z.coerce.string().min(1, 'El parámetro query no puede estar vacío'),
  maxResults: z.coerce.number().int().positive().default(5).optional(),
  messageId: z.coerce.string().optional(),
});

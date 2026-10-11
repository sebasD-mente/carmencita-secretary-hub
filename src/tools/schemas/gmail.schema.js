import { z } from 'zod';

export const GmailToolSchema = z.object({
  query: z.coerce.string().default('').optional(),
  maxResults: z.coerce.number().int().positive().default(5).optional(),
  messageId: z.coerce.string().optional(),
});

import { z } from 'zod';

export const ObsidianToolSchema = z.object({
  action: z.enum(['SEARCH', 'READ', 'CREATE', 'UPDATE', 'APPEND', 'SYNC']),
  title: z.coerce.string().optional(),
  content: z.coerce.string().optional(),
  folder: z.coerce.string().optional(),
  query: z.coerce.string().optional(),
});

import { z } from 'zod';

export const TasksToolSchema = z.object({
  action: z.enum(['CREATE', 'LIST', 'COMPLETE', 'CANCEL']),
  title: z.coerce.string().optional(),
  taskId: z.coerce.string().optional(),
  notes: z.coerce.string().optional(),
  dueDate: z.coerce.string().optional(),
});

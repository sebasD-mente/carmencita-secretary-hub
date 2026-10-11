import { z } from 'zod';

export const CalendarToolSchema = z.object({
  action: z.enum(['CREATE', 'LIST', 'RESCHEDULE', 'CANCEL', 'DELETE']),
  summary: z.coerce.string().optional(),
  startTime: z.coerce.string().optional(),
  endTime: z.coerce.string().optional(),
  startDateTime: z.coerce.string().optional(),
  endDateTime: z.coerce.string().optional(),
  timeMin: z.coerce.string().optional(),
  timeMax: z.coerce.string().optional(),
  eventId: z.coerce.string().optional(),
  location: z.coerce.string().optional(),
  description: z.coerce.string().optional(),
  range: z.coerce.string().optional(),
});

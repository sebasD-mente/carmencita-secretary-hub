import { prisma as defaultPrisma } from '../core/prisma.js';
import { defaultGoogleTasksService } from './google-tasks.service.js';
import { SaveTaskActionSchema, TaskStatusSchema, PrioritySchema } from '../validators/actions.schema.js';

export class TaskService {
  constructor(prismaClient = defaultPrisma, googleTasksService = defaultGoogleTasksService) {
    this.prisma = prismaClient;
    this.googleTasksService = googleTasksService;
  }

  /**
   * Parser de rescate temporal heurístico para descripciones con horario relativo o fijo.
   */
  _parseRelativeTime(description, baseDate = new Date()) {
    if (!description || typeof description !== 'string') return null;

    // 1. Horas relativas ("en 2 horas", "dentro de 3 horas")
    const hoursMatch = description.match(/(?:en|dentro de)\s+(\d+)\s+horas?/i);
    if (hoursMatch) {
      const hours = parseInt(hoursMatch[1], 10);
      if (!isNaN(hours)) {
        return new Date(baseDate.getTime() + hours * 60 * 60 * 1000);
      }
    }

    // 2. Minutos relativos ("en 30 minutos", "dentro de 15 mins")
    const minutesMatch = description.match(/(?:en|dentro de)\s+(\d+)\s+min(?:uto)?s?/i);
    if (minutesMatch) {
      const minutes = parseInt(minutesMatch[1], 10);
      if (!isNaN(minutes)) {
        return new Date(baseDate.getTime() + minutes * 60 * 1000);
      }
    }

    // 3. Hora fija del día ("a las 7:00 PM", "para las 5 pm", "a las 19:30")
    const timeMatch = description.match(/(?:a las|para las)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridiem = timeMatch[3]?.toLowerCase();

      if (meridiem === 'pm' && hours < 12) {
        hours += 12;
      } else if (meridiem === 'am' && hours === 12) {
        hours = 0;
      }

      if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
        const target = new Date(baseDate);
        target.setHours(hours, minutes, 0, 0);
        if (target.getTime() <= baseDate.getTime()) {
          target.setDate(target.getDate() + 1);
        }
        return target;
      }
    }

    return null;
  }

  /**
   * Crea una nueva tarea en PostgreSQL con validación Zod y sincronización opcional con Google Tasks.
   */
  async createTask(data) {
    const validated = SaveTaskActionSchema.parse({
      action: 'SAVE_TASK',
      ...data,
    });

    let dueDate = null;
    if (validated.dueDate) {
      const parsed = new Date(validated.dueDate);
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed;
      }
    } else if (validated.due) {
      const parsed = new Date(validated.due);
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed;
      }
    }

    // Rescate heurístico si el LLM omitió dueDate o envió cadena vacía
    if (!dueDate) {
      dueDate = this._parseRelativeTime(validated.description);
    }

    const task = await this.prisma.task.create({
      data: {
        description: validated.description,
        dueDate,
        priority: validated.priority || 'MEDIA',
        status: 'PENDIENTE',
      },
    });

    // Sincronización en segundo plano con Google Tasks (sin bloquear la respuesta)
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    const isDefaultProductionService = this.googleTasksService === defaultGoogleTasksService;
    const shouldSync = (!isTestEnv || !isDefaultProductionService) && this.googleTasksService?.isConfigured?.();

    if (shouldSync) {
      this.googleTasksService.createTask({
        title: task.description,
        notes: `Prioridad: ${task.priority} | Creada desde Carmencita Hub`,
        due: task.dueDate ? task.dueDate.toISOString() : undefined,
        dueDate: task.dueDate,
      }).then((gTask) => {
        if (gTask?.id && task.id && this.prisma?.task?.update) {
          this.prisma.task.update({
            where: { id: task.id },
            data: { googleTaskId: gTask.id },
          }).catch((err) => console.warn('[TaskService] Error actualizando googleTaskId:', err.message));
        }
      }).catch((err) => {
        console.warn('[TaskService] Error sincronizando con Google Tasks:', err.message);
      });
    }

    return task;
  }

  /**
   * Lista tareas con filtros opcionales de estado.
   */
  async listTasks({ onlyPending = false, status = null, limit = 50 } = {}) {
    const where = {};
    if (onlyPending) {
      where.status = 'PENDIENTE';
    } else if (status) {
      where.status = TaskStatusSchema.parse(status);
    }

    return await this.prisma.task.findMany({
      where,
      orderBy: [
        { priority: 'asc' }, // ALTA -> BAJA en orden si se enumera o por fecha
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
      take: limit,
    });
  }

  /**
   * Obtiene una tarea por su ID.
   */
  async getTaskById(id) {
    return await this.prisma.task.findUnique({
      where: { id },
    });
  }

  /**
   * Actualiza el estado de una tarea (PENDIENTE, EN_PROGRESO, COMPLETADA, CANCELADA).
   */
  async updateTaskStatus(id, newStatus) {
    const validatedStatus = TaskStatusSchema.parse(newStatus);
    const updateData = {
      status: validatedStatus,
    };
    if (validatedStatus === 'COMPLETADA') {
      updateData.completedAt = new Date();
    } else {
      updateData.completedAt = null;
    }

    return await this.prisma.task.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Elimina una tarea de forma atómica.
   */
  async deleteTask(id) {
    return await this.prisma.task.delete({
      where: { id },
    });
  }
}

export const taskService = new TaskService();

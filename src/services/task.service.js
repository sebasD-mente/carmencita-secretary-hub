import { prisma as defaultPrisma } from '../core/prisma.js';
import { SaveTaskActionSchema, TaskStatusSchema, PrioritySchema } from '../validators/actions.schema.js';

export class TaskService {
  constructor(prismaClient = defaultPrisma) {
    this.prisma = prismaClient;
  }

  /**
   * Crea una nueva tarea en PostgreSQL con validación Zod.
   */
  async createTask(data) {
    const validated = SaveTaskActionSchema.parse({
      action: 'SAVE_TASK',
      ...data,
    });

    let dueDate = null;
    if (validated.dueDate) {
      dueDate = new Date(validated.dueDate);
    } else if (validated.due) {
      const parsed = new Date(validated.due);
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed;
      }
    }

    return await this.prisma.task.create({
      data: {
        description: validated.description,
        dueDate,
        priority: validated.priority || 'MEDIA',
        status: 'PENDIENTE',
      },
    });
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

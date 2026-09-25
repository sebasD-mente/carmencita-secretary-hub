import { prisma as defaultPrisma } from '../core/prisma.js';
import { SaveIdeaActionSchema, PrioritySchema } from '../validators/actions.schema.js';

export class IdeaService {
  constructor(prismaClient = defaultPrisma) {
    this.prisma = prismaClient;
  }

  /**
   * Registra una nueva idea en PostgreSQL con validación Zod.
   */
  async createIdea(data) {
    const validated = SaveIdeaActionSchema.parse({
      action: 'SAVE_IDEA',
      ...data,
    });

    return await this.prisma.idea.create({
      data: {
        title: validated.title,
        summary: validated.summary,
        rawText: validated.rawText || validated.summary,
        priority: validated.priority || 'MEDIA',
        tags: validated.tags || [],
      },
    });
  }

  /**
   * Lista ideas con filtros opcionales.
   */
  async listIdeas({ limit = 20, tag = null, priority = null } = {}) {
    const where = {};
    if (tag) {
      where.tags = { has: tag };
    }
    if (priority) {
      where.priority = PrioritySchema.parse(priority);
    }

    return await this.prisma.idea.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Obtiene una idea por su ID.
   */
  async getIdeaById(id) {
    return await this.prisma.idea.findUnique({
      where: { id },
    });
  }

  /**
   * Elimina una idea de forma atómica.
   */
  async deleteIdea(id) {
    return await this.prisma.idea.delete({
      where: { id },
    });
  }
}

export const ideaService = new IdeaService();

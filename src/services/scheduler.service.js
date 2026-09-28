import { prisma as defaultPrisma } from '../core/prisma.js';
import { config } from '../config.js';

export class SchedulerService {
  constructor(opts = {}) {
    this.prisma = opts.prisma || defaultPrisma;
    this.telegramAdapter = opts.telegramAdapter || null;
    this.intervalMs = opts.intervalMs || 60000;
    this.timer = null;
    this.isRunning = false;
    this.isChecking = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`⏱️ [Scheduler] Motor proactivo de recordatorios iniciado (pulso cada ${this.intervalMs / 1000}s)`);

    this.timer = setInterval(async () => {
      try {
        await this.checkPendingTasks();
      } catch (err) {
        console.error('[Scheduler] Error en ciclo periódico de recordatorios:', err.message);
      }
    }, this.intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('🛑 [Scheduler] Motor proactivo detenido.');
  }

  async checkPendingTasks(referenceDate = new Date()) {
    if (this.isChecking) return [];
    this.isChecking = true;

    const notifiedTasks = [];
    try {
      const dueTasks = await this.prisma.task.findMany({
        where: {
          status: 'PENDIENTE',
          dueDate: { lte: referenceDate },
          notifiedAt: null,
        },
        orderBy: { dueDate: 'asc' },
      });

      if (!dueTasks || dueTasks.length === 0) {
        return [];
      }

      console.log(`🔔 [Scheduler] ${dueTasks.length} tarea(s) pendiente(s) vencidas detectadas para notificación.`);

      for (const task of dueTasks) {
        try {
          await this._notifyTask(task);
          const updated = await this.prisma.task.update({
            where: { id: task.id },
            data: { notifiedAt: new Date() },
          });
          notifiedTasks.push(updated);
        } catch (taskErr) {
          console.error(`[Scheduler] Error al notificar tarea ${task.id}:`, taskErr.message);
        }
      }
    } finally {
      this.isChecking = false;
    }

    return notifiedTasks;
  }

  async _notifyTask(task) {
    const hora = task.dueDate
      ? new Date(task.dueDate).toLocaleString('es-GT', { timeZone: 'America/Guatemala' })
      : 'Inmediata';

    const text = [
      '🔔 ¡Sebastián, recordatorio de Carmencita!',
      '',
      `📌 Tarea: ${task.description}`,
      `⏰ Hora programada: ${hora}`,
      `🔥 Prioridad: ${task.priority || 'MEDIA'}`,
      '',
      '¿Deseas que la marque como completada o la pospongo?',
    ].join('\n');

    if (this.telegramAdapter) {
      const allowedUsers = config.telegram.allowedUsers.length > 0
        ? config.telegram.allowedUsers
        : [];

      for (const chatId of allowedUsers) {
        try {
          if (typeof this.telegramAdapter.sendMessage === 'function') {
            await this.telegramAdapter.sendMessage(chatId, text);
          } else if (this.telegramAdapter.bot?.api?.sendMessage) {
            await this.telegramAdapter.bot.api.sendMessage(chatId, text);
          }
        } catch (err) {
          console.error(`[Scheduler] Error al despachar mensaje proactivo a Telegram ID ${chatId}:`, err.message);
        }
      }
    }

    return text;
  }
}

export const schedulerService = new SchedulerService();

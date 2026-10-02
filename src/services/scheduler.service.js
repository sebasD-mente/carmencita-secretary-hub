import { prisma as defaultPrisma } from '../core/prisma.js';
import { config } from '../config.js';

function mapWeatherCode(code) {
  if (code === 0) return 'Soleado y despejado';
  if (code === 1) return 'Mayormente soleado';
  if (code === 2) return 'Parcialmente nublado';
  if (code === 3) return 'Nublado';
  if (code === 45 || code === 48) return 'Niebla matutina';
  if ([51, 53, 55].includes(code)) return 'Llovizna intermitente';
  if ([61, 63, 65, 80, 81, 82].includes(code)) return 'Lluvia / Chubascos';
  if ([95, 96, 99].includes(code)) return 'Tormenta eléctrica';
  return 'Condiciones estables';
}

export class SchedulerService {
  constructor(opts = {}) {
    this.prisma = opts.prisma || defaultPrisma;
    this.telegramAdapter = opts.telegramAdapter || null;
    this.calendarService = opts.calendarService || null;
    this.taskService = opts.taskService || null;
    this.gmailService = opts.gmailService || null;
    this.weatherFetcher = opts.weatherFetcher || null;
    this.intervalMs = opts.intervalMs || 60000;
    this.lastBriefDate = opts.lastBriefDate || null;
    this.timer = null;
    this.isRunning = false;
    this.isChecking = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`⏱️ [Scheduler] Motor proactivo y briefing matutino iniciado (pulso cada ${this.intervalMs / 1000}s)`);

    this.timer = setInterval(async () => {
      try {
        await this.checkPendingTasks();
        await this.checkMorningBrief();
      } catch (err) {
        console.error('[Scheduler] Error en ciclo periódico del scheduler:', err.message);
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

  async fetchGuatemalaWeather() {
    if (typeof this.weatherFetcher === 'function') {
      return await this.weatherFetcher();
    }

    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=14.6407&longitude=-90.5133&current=temperature_2m,relative_humidity_2m,weather_code&timezone=America%2FGuatemala';
      const res = await fetch(url, { headers: { 'User-Agent': 'CarmencitaHub/1.0' } });
      if (!res.ok) throw new Error(`HTTP Status ${res.status}`);
      const data = await res.json();
      const temp = Math.round(data.current?.temperature_2m ?? 21);
      const code = data.current?.weather_code ?? 0;
      const desc = mapWeatherCode(code);
      return `${temp}°C, ${desc}`;
    } catch (err) {
      console.warn('[Scheduler] No se pudo obtener el clima de Open-Meteo:', err.message);
      return '21°C, Parcialmente nublado';
    }
  }

  async checkMorningBrief(referenceDate = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guatemala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(referenceDate);

    const dMap = {};
    for (const p of parts) {
      dMap[p.type] = p.value;
    }
    const todayStr = `${dMap.year}-${dMap.month}-${dMap.day}`;
    const hour = parseInt(dMap.hour, 10);
    const minute = parseInt(dMap.minute, 10);

    // Ventana de las 7:00 AM (07:00 a 07:05)
    if (hour === 7 && minute <= 5 && this.lastBriefDate !== todayStr) {
      return await this.triggerMorningBrief(referenceDate);
    }
    return null;
  }

  async triggerMorningBrief(referenceDate = new Date()) {
    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guatemala',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(referenceDate);

    const weatherStr = await this.fetchGuatemalaWeather();

    let events = [];
    if (this.calendarService?.getTodayEvents) {
      try {
        events = await this.calendarService.getTodayEvents({ timeZone: 'America/Guatemala' });
      } catch (err) {
        console.warn('[Scheduler] Error consultando agenda para briefing:', err.message);
      }
    }

    let tasks = [];
    if (this.taskService?.listTasks) {
      try {
        tasks = await this.taskService.listTasks({ onlyPending: true, limit: 5 });
      } catch (err) {
        console.warn('[Scheduler] Error consultando tareas para briefing:', err.message);
      }
    }

    const eventsFormatted = events.length === 0
      ? '• Sin citas agendadas para hoy.'
      : events.map((ev) => {
          let time = '';
          if (ev.start) {
            const d = new Date(ev.start);
            time = !isNaN(d.getTime())
              ? d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Guatemala' })
              : ev.start;
          }
          const loc = ev.location ? ` (${ev.location})` : '';
          return `• ${time} - ${ev.summary}${loc}`;
        }).join('\n');

    const tasksFormatted = tasks.length === 0
      ? '• Sin tareas pendientes prioritarias.'
      : tasks.map((t) => `• [ ] ${t.description} [${t.priority || 'MEDIA'}]`).join('\n');

    let unreadEmails = [];
    if (this.gmailService?.getInboxSummary) {
      try {
        const summary = await this.gmailService.getInboxSummary({ maxResults: 5 });
        unreadEmails = summary?.messages || [];
      } catch (err) {
        console.warn('[Scheduler] Error consultando Gmail para briefing:', err.message);
      }
    }

    let emailSection = [];
    if (this.gmailService) {
      const emailsFormatted = unreadEmails.length === 0
        ? '• Bandeja al día (sin correos pendientes).'
        : unreadEmails.map((m) => {
            const fromClean = m.from ? m.from.replace(/<[^>]+>/, '').trim() : 'Desconocido';
            const snippetClean = m.snippet ? ` - ${m.snippet.slice(0, 80).replace(/\n/g, ' ')}...` : '';
            return `• [${fromClean}] ${m.subject}${snippetClean}`;
          }).join('\n');

      emailSection = [
        `✉️ Bandeja de entrada Gmail (${unreadEmails.length} pendiente${unreadEmails.length === 1 ? '' : 's'}):`,
        emailsFormatted,
        '',
      ];
    }

    const message = [
      '🌅 ¡Buenos días, Sebastián! Carmencita te presenta tu resumen de hoy:',
      '',
      `🌤️ Clima (Ciudad de Guatemala): ${weatherStr}`,
      '',
      `📅 Tu agenda de hoy (${events.length} cita${events.length === 1 ? '' : 's'}):`,
      eventsFormatted,
      '',
      '📋 Tareas prioritarias:',
      tasksFormatted,
      '',
      ...emailSection,
      '¡Que sea un día muy exitoso para Deko Labs!',
    ].join('\n');

    if (this.telegramAdapter) {
      const allowedUsers = config.telegram.allowedUsers.length > 0
        ? config.telegram.allowedUsers
        : [];

      for (const chatId of allowedUsers) {
        try {
          if (typeof this.telegramAdapter.sendMessage === 'function') {
            await this.telegramAdapter.sendMessage(chatId, message);
          } else if (this.telegramAdapter.bot?.api?.sendMessage) {
            await this.telegramAdapter.bot.api.sendMessage(chatId, message);
          }
        } catch (err) {
          console.error(`[Scheduler] Falló despacho de Morning Brief a Telegram ID ${chatId}:`, err.message);
        }
      }
    }

    this.lastBriefDate = todayStr;
    return message;
  }
}

export const schedulerService = new SchedulerService();

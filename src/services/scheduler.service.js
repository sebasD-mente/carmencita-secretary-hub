import { prisma as defaultPrisma } from '../core/prisma.js';
import { config } from '../config.js';
import { sanitizeReplyText } from '../tools/index.js';
import { ExecutiveBriefingService } from './executive-briefing.service.js';

function getGuatemalaTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guatemala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const dMap = {};
  for (const p of parts) dMap[p.type] = p.value;
  return {
    todayStr: `${dMap.year}-${dMap.month}-${dMap.day}`,
    hour: parseInt(dMap.hour, 10),
    minute: parseInt(dMap.minute, 10),
    weekday: dMap.weekday || '',
  };
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
    this.lastMiddayDate = opts.lastMiddayDate || null;
    this.lastEveningDate = opts.lastEveningDate || null;
    this.lastNightlyDate = opts.lastNightlyDate || null;
    this.lastInboxCheckTime = opts.lastInboxCheckTime || 0;
    this.notifiedEmailIds = new Set(opts.notifiedEmailIds || []);
    this.notifiedMeetingAlerts = new Set(opts.notifiedMeetingAlerts || []);
    this.brain = opts.brain || null;
    this.obsidianService = opts.obsidianService || null;
    this.embeddingService = opts.embeddingService || null;
    this.diagnosticsService = opts.diagnosticsService || null;
    this.executiveBriefingService = opts.executiveBriefingService || new ExecutiveBriefingService({
      ai: opts.ai || opts.brain?.ai || null,
      calendarService: this.calendarService,
      taskService: this.taskService,
      gmailService: this.gmailService,
      telegramAdapter: this.telegramAdapter,
      weatherFetcher: this.weatherFetcher,
      brain: this.brain,
    });
    this.timer = null;
    this.isRunning = false;
    this.isChecking = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`⏱️ [Scheduler] Motor proactivo y las 6 rutinas cardinales iniciadas (pulso cada ${this.intervalMs / 1000}s)`);

    this.timer = setInterval(async () => {
      try {
        await this.checkPendingTasks();
        await this.checkMeetingAlerts();
        await this.checkMorningBrief();
        await this.checkMiddaySync();
        await this.checkEveningDebrief();
        await this.checkInboxWatchdog();
        await this.checkNightlyMaintenance();
      } catch (err) {
        console.error('[Scheduler] Error en ciclo periódico del scheduler:', err.message);
      }
    }, this.intervalMs);

    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('🛑 [Scheduler] Motor proactivo detenido.');
  }

  async _dispatchTelegram(text) {
    if (!this.telegramAdapter || !text) return;
    const cleanText = sanitizeReplyText(text);
    const allowedUsers = config.telegram?.allowedUsers?.length > 0 ? config.telegram.allowedUsers : [];
    for (const chatId of allowedUsers) {
      try {
        if (typeof this.telegramAdapter.sendMessage === 'function') {
          await this.telegramAdapter.sendMessage(chatId, cleanText);
        } else if (this.telegramAdapter.bot?.api?.sendMessage) {
          await this.telegramAdapter.bot.api.sendMessage(chatId, cleanText);
        }
      } catch (err) {
        console.error(`[Scheduler] Falló despacho a Telegram ID ${chatId}:`, err.message);
      }
    }
  }

  async checkPendingTasks(referenceDate = new Date()) {
    if (this.isChecking) return [];
    this.isChecking = true;
    const notifiedTasks = [];
    try {
      const dueTasks = await this.prisma.task.findMany({
        where: { status: 'PENDIENTE', dueDate: { lte: referenceDate }, notifiedAt: null },
        orderBy: { dueDate: 'asc' },
      });
      if (!dueTasks || dueTasks.length === 0) return [];

      console.log(`🔔 [Scheduler] ${dueTasks.length} tarea(s) pendiente(s) vencidas detectadas para notificación.`);
      for (const task of dueTasks) {
        try {
          await this._notifyTask(task);
          const updated = await this.prisma.task.update({ where: { id: task.id }, data: { notifiedAt: new Date() } });
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
    const hora = task.dueDate ? new Date(task.dueDate).toLocaleString('es-GT', { timeZone: 'America/Guatemala' }) : 'Inmediata';
    const text = `🔔 ¡Sebastián, recordatorio de Carmencita!\n\n📌 Tarea: ${task.description}\n⏰ Hora programada: ${hora}\n🔥 Prioridad: ${task.priority || 'MEDIA'}\n\n¿Deseas que la marque como completada o la pospongo?`;
    await this._dispatchTelegram(text);
    return text;
  }

  _syncBriefingService() {
    if (!this.executiveBriefingService) return;
    this.executiveBriefingService.ai = this.brain?.ai || this.executiveBriefingService.ai;
    this.executiveBriefingService.brain = this.brain || this.executiveBriefingService.brain;
    this.executiveBriefingService.calendarService = this.calendarService || this.executiveBriefingService.calendarService;
    this.executiveBriefingService.taskService = this.taskService || this.executiveBriefingService.taskService;
    this.executiveBriefingService.gmailService = this.gmailService || this.executiveBriefingService.gmailService;
    this.executiveBriefingService.weatherFetcher = this.weatherFetcher || this.executiveBriefingService.weatherFetcher;
    this.executiveBriefingService.telegramAdapter = this.telegramAdapter || this.executiveBriefingService.telegramAdapter;
  }

  async fetchGuatemalaWeather() {
    this._syncBriefingService();
    return await this.executiveBriefingService.fetchGuatemalaWeather();
  }

  // ----------------- RUTINA 1: BRIEFING MATUTINO -----------------
  async checkMorningBrief(referenceDate = new Date()) {
    const { todayStr, hour, minute } = getGuatemalaTimeParts(referenceDate);
    const isMorningWindow = hour === 7 && ((minute >= 30 && minute <= 35) || minute <= 5);
    if (isMorningWindow && this.lastBriefDate !== todayStr) {
      return await this.triggerMorningBrief(referenceDate);
    }
    return null;
  }

  async triggerMorningBrief(referenceDate = new Date()) {
    const { todayStr } = getGuatemalaTimeParts(referenceDate);
    this._syncBriefingService();
    const briefing = await this.executiveBriefingService.buildMorningBriefing({ date: referenceDate });
    const message = briefing.text;
    await this._dispatchTelegram(message);
    this.lastBriefDate = todayStr;
    return message;
  }

  // ----------------- RUTINA 2: GUARDIÁN PRE-REUNIÓN (30 MIN) -----------------
  async checkMeetingAlerts(referenceDate = new Date()) {
    if (!this.calendarService?.getTodayEvents) return [];
    let events = [];
    try {
      events = await this.calendarService.getTodayEvents({ timeZone: 'America/Guatemala' });
    } catch (err) {
      console.warn('[Scheduler] Error consultando agenda para alertas de reunión:', err.message);
      return [];
    }

    const { todayStr } = getGuatemalaTimeParts(referenceDate);
    const alertsDispatched = [];

    for (const ev of events) {
      if (ev.isAllDay || !ev.start) continue;
      const startTime = new Date(ev.start).getTime();
      if (isNaN(startTime)) continue;

      const diffMins = Math.round((startTime - referenceDate.getTime()) / 60000);
      if (diffMins >= 25 && diffMins <= 35) {
        const meetingKey = `${ev.id || ev.summary}_${todayStr}`;
        if (!this.notifiedMeetingAlerts.has(meetingKey)) {
          const dObj = new Date(ev.start);
          const timeStr = dObj.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Guatemala' });
          const msg = `⏰ <b>¡Sebas, recordatorio de reunión en 30 minutos!</b>\n\n📌 <b>Cita:</b> ${ev.summary}\n🕒 <b>Hora:</b> ${timeStr}${ev.location ? `\n📍 <b>Lugar:</b> ${ev.location}` : ''}${ev.htmlLink ? `\n🔗 <a href="${ev.htmlLink}">Ver en Calendar</a>` : ''}\n\nSi necesitas que te busque la última cotización o notas antes de entrar, dime y te la tengo lista.`;

          await this._dispatchTelegram(msg);
          this.notifiedMeetingAlerts.add(meetingKey);
          alertsDispatched.push({ event: ev, message: msg });
        }
      }
    }

    return alertsDispatched;
  }

  // ----------------- RUTINA 3: RADAR DE BANDEJA GMAIL -----------------
  async checkInboxWatchdog(referenceDate = new Date(), force = false) {
    if (!this.gmailService) return [];
    const { hour } = getGuatemalaTimeParts(referenceDate);
    if (!force && (hour < 8 || hour >= 20)) return [];

    const nowMs = referenceDate.getTime();
    if (!force && (nowMs - this.lastInboxCheckTime < 60 * 60 * 1000)) return [];

    let messages = [];
    try {
      if (typeof this.gmailService.getUnreadInboxMessages === 'function') {
        messages = await this.gmailService.getUnreadInboxMessages({ maxResults: 5, onlyImportant: true });
      } else if (typeof this.gmailService.getInboxSummary === 'function') {
        const summary = await this.gmailService.getInboxSummary({ maxResults: 5 });
        messages = summary?.messages || [];
      }
    } catch (err) {
      console.warn('[Scheduler] Error en radar de bandeja Gmail:', err.message);
      return [];
    }

    const priorityRegex = /(?:cotizaci[oó]n|factura|cliente|contrato|devfest|evento|pago|urgente|reuni[oó]n|stand|presupuesto)/i;
    const notified = [];

    for (const m of messages) {
      if (!m || !m.id || this.notifiedEmailIds.has(m.id)) continue;
      const isPriority = priorityRegex.test(m.subject || '') || priorityRegex.test(m.from || '') || priorityRegex.test(m.snippet || '');

      if (isPriority) {
        const fromClean = m.from ? m.from.replace(/<[^>]+>/, '').trim() : 'Remitente';
        const snippetClean = m.snippet ? m.snippet.slice(0, 120).replace(/\n/g, ' ') : '';
        const msg = `✉️ <b>¡Jefecito, acaba de entrar un correo importante!</b>\n\n👤 <b>De:</b> ${fromClean}\n📌 <i>${m.subject || '(Sin asunto)'}</i>\n${snippetClean}\n\n¿Quieres que prepare una respuesta o lo revisamos más tarde?`;

        await this._dispatchTelegram(msg);
        this.notifiedEmailIds.add(m.id);
        notified.push({ email: m, message: msg });
      }
    }

    this.lastInboxCheckTime = nowMs;
    return notified;
  }

  // ----------------- RUTINA 4: CHECK-IN DE MEDIODÍA -----------------
  async checkMiddaySync(referenceDate = new Date()) {
    const { todayStr, hour, minute, weekday } = getGuatemalaTimeParts(referenceDate);
    const isWeekend = ['sat', 'sun', 'sáb', 'dom'].some((d) => weekday.toLowerCase().startsWith(d));
    if (isWeekend) return null;

    if (hour === 13 && minute <= 5 && this.lastMiddayDate !== todayStr) {
      const msg = '☕ <b>¡Jefe lindo, mitad del día superada!</b>\n\nEspero que esa mañana haya sido muy productiva. Aprovecha a almorzar tranquilo.\n\n¿Se te ocurrió alguna idea de diseño o tienes algún pendiente fresco que quieras que te apunte antes de que se te escape de la mente?';
      await this._dispatchTelegram(msg);
      this.lastMiddayDate = todayStr;
      return msg;
    }
    return null;
  }

  // ----------------- RUTINA 5: DEBRIEFING CIERRE DE JORNADA -----------------
  async checkEveningDebrief(referenceDate = new Date()) {
    const { todayStr, hour, minute, weekday } = getGuatemalaTimeParts(referenceDate);
    const isWeekend = ['sat', 'sun', 'sáb', 'dom'].some((d) => weekday.toLowerCase().startsWith(d));
    if (isWeekend) return null;

    const isEveningWindow = (hour === 18 && minute >= 30 && minute <= 35) || (hour === 19 && minute <= 5);
    if (isEveningWindow && this.lastEveningDate !== todayStr) {
      this._syncBriefingService();
      const debrief = await this.executiveBriefingService.buildEveningBriefing({ date: referenceDate });
      const msg = debrief.text;
      await this._dispatchTelegram(msg);
      this.lastEveningDate = todayStr;
      return msg;
    }
    return null;
  }

  // ----------------- RUTINA 6: MANTENIMIENTO NOCTURNO SILENCIOSO -----------------
  async checkNightlyMaintenance(referenceDate = new Date()) {
    const { todayStr, hour, minute } = getGuatemalaTimeParts(referenceDate);
    if (hour === 2 && minute <= 5 && this.lastNightlyDate !== todayStr) {
      let syncResult = null;
      let diagnosticsResult = null;

      try {
        if (this.obsidianService?.syncVaultToVector) {
          syncResult = await this.obsidianService.syncVaultToVector({ force: false });
        }
      } catch (obsErr) {
        console.warn('[Scheduler] Error en sincronización nocturna de Obsidian:', obsErr.message);
      }

      try {
        if (this.diagnosticsService?.getSystemStatus) {
          diagnosticsResult = await this.diagnosticsService.getSystemStatus();
        }
      } catch (diagErr) {
        console.warn('[Scheduler] Error en auto-diagnóstico nocturno:', diagErr.message);
      }

      this.lastNightlyDate = todayStr;
      console.log(`🌙 [Scheduler] Mantenimiento nocturno completado para ${todayStr}`);
      return { success: true, date: todayStr, syncResult, diagnosticsResult };
    }
    return null;
  }
}

export const schedulerService = new SchedulerService();

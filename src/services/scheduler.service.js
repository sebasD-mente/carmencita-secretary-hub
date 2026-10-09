import { prisma as defaultPrisma } from '../core/prisma.js';
import { config } from '../config.js';
import { sanitizeReplyText } from '../tools/index.js';

const WEATHER_DESCRIPTIONS = {
  0: 'Soleado y despejado', 1: 'Mayormente soleado', 2: 'Parcialmente nublado', 3: 'Nublado',
  45: 'Niebla matutina', 48: 'Niebla matutina', 51: 'Llovizna intermitente', 53: 'Llovizna intermitente',
  55: 'Llovizna intermitente', 61: 'Lluvia / Chubascos', 63: 'Lluvia / Chubascos', 65: 'Lluvia / Chubascos',
  80: 'Lluvia / Chubascos', 81: 'Lluvia / Chubascos', 82: 'Lluvia / Chubascos', 95: 'Tormenta eléctrica',
  96: 'Tormenta eléctrica', 99: 'Tormenta eléctrica',
};

function mapWeatherCode(code) {
  return WEATHER_DESCRIPTIONS[code] || 'Condiciones estables';
}

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

  async fetchGuatemalaWeather() {
    if (typeof this.weatherFetcher === 'function') return await this.weatherFetcher();
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=14.6407&longitude=-90.5133&current=temperature_2m,relative_humidity_2m,weather_code&timezone=America%2FGuatemala';
      const res = await fetch(url, { headers: { 'User-Agent': 'CarmencitaHub/1.0' } });
      if (!res.ok) throw new Error(`HTTP Status ${res.status}`);
      const data = await res.json();
      const temp = Math.round(data.current?.temperature_2m ?? 21);
      const code = data.current?.weather_code ?? 0;
      return `${temp}°C, ${mapWeatherCode(code)}`;
    } catch (err) {
      console.warn('[Scheduler] No se pudo obtener el clima de Open-Meteo:', err.message);
      return '21°C, Parcialmente nublado';
    }
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
    const weatherStr = await this.fetchGuatemalaWeather();

    let events = [];
    if (this.calendarService?.getTodayEvents) {
      try {
        events = await this.calendarService.getTodayEvents({ timeZone: 'America/Guatemala' });
      } catch (err) { console.warn('[Scheduler] Error consultando agenda para briefing:', err.message); }
    }

    let tasks = [];
    if (this.taskService?.listTasks) {
      try {
        tasks = await this.taskService.listTasks({ onlyPending: true, limit: 5 });
      } catch (err) { console.warn('[Scheduler] Error consultando tareas para briefing:', err.message); }
    }

    let unreadEmails = [];
    try {
      if (this.gmailService?.getInboxSummary) {
        const summary = await this.gmailService.getInboxSummary({ maxResults: 5 });
        unreadEmails = summary?.messages || [];
      } else if (this.gmailService?.getUnreadInboxMessages) {
        unreadEmails = await this.gmailService.getUnreadInboxMessages({ maxResults: 5, onlyImportant: true });
      }
    } catch (err) { console.warn('[Scheduler] Error consultando Gmail para briefing:', err.message); }

    const eventsFormatted = events.length === 0
      ? '• Sin citas agendadas para hoy.'
      : events.map((ev) => {
          let time = '';
          if (ev.start) {
            const d = new Date(ev.start);
            time = !isNaN(d.getTime()) ? d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Guatemala' }) : ev.start;
          }
          return `• ${time} - ${ev.summary}${ev.location ? ` (${ev.location})` : ''}`;
        }).join('\n');

    const tasksFormatted = tasks.length === 0
      ? '• Sin tareas pendientes prioritarias.'
      : tasks.map((t) => `• [ ] ${t.description} [${t.priority || 'MEDIA'}]`).join('\n');

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

    let message = [
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

    if (this.brain?.ai?.models?.generateContent) {
      try {
        const prompt = `Eres Carmencita, la secretaria ejecutiva de Sebastián Jiménez. Redacta el Briefing Matutino de las 07:30 AM con zalamería reactiva, calidez ejecutiva y aire visual.\nDatos:\n- Clima: ${weatherStr}\n- Citas: ${eventsFormatted}\n- Tareas: ${tasksFormatted}\n- Correos: ${unreadEmails.map((m) => `${m.from}: ${m.subject}`).join(', ') || 'Bandeja limpia'}\n\nDirectivas: Saludo cariñoso y dinámico, párrafos cortos con doble salto (\\n\\n), HTML limpio (<b>, <i>) y emoticones sobrios (☕, 🌤️, 📅, 📋, ✉️). CERO asteriscos.`;
        const res = await this.brain.ai.models.generateContent({ model: config.ai.modelName, contents: prompt });
        const aiText = typeof res?.text === 'function' ? res.text() : (res?.text || '');
        if (aiText && aiText.trim().length > 20) message = sanitizeReplyText(aiText.trim());
      } catch (aiErr) {
        console.warn('[Scheduler] Falló síntesis de briefing con IA, usando fallback estructurado:', aiErr.message);
      }
    }

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

    if (hour === 18 && minute >= 30 && minute <= 35 && this.lastEveningDate !== todayStr) {
      let tomorrowSummary = '• Mañana tienes tu agenda despejada para crear y avanzar.';
      if (this.calendarService?.getTomorrowEvents) {
        try {
          const events = await this.calendarService.getTomorrowEvents({ excludeBirthdays: true });
          if (events && events.length > 0) tomorrowSummary = events.map((e) => `• ${e.summary}`).join('\n');
        } catch (err) {
          console.warn('[Scheduler] Error consultando citas de mañana para debriefing:', err.message);
        }
      }

      const msg = `✨ <b>¡Mi jefe consentido, hora de cerrar jornada por hoy!</b>\n\n📅 <b>Para mañana:</b>\n${tomorrowSummary}\n\n¿Quedó algún acuerdo importante, cotización o apunte de hoy que quieras que te resguarde en tu bóveda de Obsidian antes de descansar?`;
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

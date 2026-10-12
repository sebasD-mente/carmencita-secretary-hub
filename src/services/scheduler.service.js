import { prisma as defaultPrisma } from '../core/prisma.js';
import { config } from '../config.js';
import { sanitizeReplyText } from '../tools/index.js';
import { ExecutiveBriefingService } from './executive-briefing.service.js';
import { isImportantEmail } from './gmail.service.js';
import { defaultEmailTriageService, EmailCategory, EmailUrgency } from './email-triage.service.js';

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
    this.emailTriageService = opts.emailTriageService || defaultEmailTriageService;
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
    this.isTickRunning = false;
    this.isChecking = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isTickRunning = false;
    console.log(`⏱️ [Scheduler] Motor proactivo y las 7 rutinas cardinales iniciadas (pulso cada ${this.intervalMs / 1000}s)`);

    this.timer = setInterval(async () => {
      if (this.isTickRunning) {
        console.warn('⚠️ [Scheduler] Ciclo previo aún en ejecución. Omitiendo tick para evitar contención de event loop.');
        return;
      }
      this.isTickRunning = true;
      try {
        await Promise.allSettled([
          this.checkPendingTasks(),
          this.checkMeetingAlerts(),
          this.checkMorningBrief(),
          this.checkMiddaySync(),
          this.checkEveningDebrief(),
          this.checkInboxWatchdog(),
          this.checkNightlyMaintenance(),
        ]);
      } catch (err) {
        console.error('[Scheduler] Error en ciclo periódico del scheduler:', err.message);
      } finally {
        this.isTickRunning = false;
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
    this.isTickRunning = false;
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
        where: {
          status: 'PENDIENTE',
          dueDate: { lte: referenceDate },
          OR: [
            { notifiedAt: null },
            { isRecurring: true },
          ],
        },
        orderBy: { dueDate: 'asc' },
      });
      if (!dueTasks || dueTasks.length === 0) return [];

      console.log(`🔔 [Scheduler] ${dueTasks.length} tarea(s) pendiente(s) vencidas detectadas para notificación.`);
      for (const task of dueTasks) {
        try {
          await this._notifyTask(task);

          if (task.isRecurring) {
            const intervalHours = task.intervalHours || 2;
            const nextDue = new Date(referenceDate.getTime() + intervalHours * 60 * 60 * 1000);
            const updated = await this.prisma.task.update({
              where: { id: task.id },
              data: {
                dueDate: nextDue,
                lastNotifiedAt: new Date(),
                executionCount: { increment: 1 },
                notifiedAt: new Date(),
              },
            });
            notifiedTasks.push(updated);
          } else {
            const updated = await this.prisma.task.update({
              where: { id: task.id },
              data: {
                notifiedAt: new Date(),
                lastNotifiedAt: new Date(),
                executionCount: { increment: 1 },
              },
            });
            notifiedTasks.push(updated);
          }
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

  // ----------------- RUTINA 3: RADAR DE BANDEJA GMAIL [DEKO-CARMEN-047] -----------------
  async checkInboxWatchdog(referenceDate = new Date(), force = false) {
    if (!this.gmailService) return [];
    const { hour } = getGuatemalaTimeParts(referenceDate);
    const isNightTime = !force && (hour < 8 || hour >= 20);
    // Si es horario nocturno, NO se apaga el radar; opera en modo centinela exclusivo para Nivel 1 [Punto 13]

    const nowMs = referenceDate.getTime();
    const THROTTLE_MS = 5 * 60 * 1000;
    if (!force && (nowMs - this.lastInboxCheckTime < THROTTLE_MS)) return [];

    let messages = [];
    try {
      if (typeof this.gmailService.getUnreadInboxMessages === 'function') {
        messages = await this.gmailService.getUnreadInboxMessages({ maxResults: 25, onlyImportant: false });
      } else if (typeof this.gmailService.getInboxSummary === 'function') {
        const summary = await this.gmailService.getInboxSummary({ maxResults: 25 });
        messages = summary?.messages || [];
      }
    } catch (err) {
      console.warn('[Scheduler] Error en radar de bandeja Gmail:', err.message);
      return [];
    }

    const notified = [];
    const priorityBatch = [];

    for (const m of messages) {
      if (!m || !m.id) continue;

      let alreadyNotified = false;
      if (this.prisma?.notifiedEmail?.findUnique) {
        try {
          const record = await this.prisma.notifiedEmail.findUnique({ where: { emailId: m.id } });
          if (record) alreadyNotified = true;
        } catch (dbErr) {
          console.warn('[Scheduler] Error consultando NotifiedEmail en DB:', dbErr.message);
        }
      }

      if (alreadyNotified || this.notifiedEmailIds?.has(m.id)) continue;

      let triageResult = null;
      if (this.emailTriageService?.classifyEmail) {
        try {
          triageResult = await this.emailTriageService.classifyEmail({
            from: m.from || '',
            subject: m.subject || '',
            snippet: m.snippet || '',
            bodyText: m.bodyText || '',
          });
        } catch (triageErr) {
          console.warn(`[Scheduler] Error en triaje cognitivo para correo ${m.id}:`, triageErr.message);
        }
      }

      if (!triageResult) {
        const legacyPrio = isImportantEmail({ from: m.from || '', subject: m.subject || '', snippet: m.snippet || '' });
        triageResult = {
          category: legacyPrio ? 'CLIENTE_NEGOCIO' : 'RUIDO',
          urgency: legacyPrio ? 'ALTA' : 'RUIDO',
          isActionable: legacyPrio,
          oneLineSummary: m.subject || '',
          executiveReason: legacyPrio ? 'Prioritario por filtro heurístico' : 'Ruido descartado',
        };
      }

      // Triaje Criterial por Reputación y Urgencia [Puntos 04 y 13]
      const isNivel1 = triageResult.category === 'INFRAESTRUCTURA' ||
                      triageResult.category === 'FINANCIERO' ||
                      triageResult.category === 'EMERGENCIA_SEBASTIAN' ||
                      triageResult.urgency === 'CRITICO';

      const isNivel2 = triageResult.category === 'CLIENTE_NEGOCIO' ||
                      triageResult.category === 'SUSCRIPCION' ||
                      triageResult.urgency === 'ALTA';

      // En horario nocturno solo se despachan alertas Nivel 1 [Punto 13]
      // Nivel 2 y 3 no se tocan de noche ni se marcan como notificados para evaluarse a las 8 AM
      if (isNightTime && !isNivel1) {
        continue;
      }

      // Triaje Criterial por Antigüedad [Punto 04]:
      // Nivel 1: Ventana de hasta 48 horas (resiliencia ante reinicios y caídas de servidor)
      // Nivel 2: Ventana de 24 horas (horario laboral)
      // Nivel 3: Ventana de 6 horas
      const emailDate = m.date ? new Date(m.date) : null;
      const maxAgeHours = isNivel1 ? 48 : (isNivel2 ? 24 : 6);
      const maxAgeMs = nowMs - (maxAgeHours * 60 * 60 * 1000);

      if (emailDate && !isNaN(emailDate.getTime()) && emailDate.getTime() < maxAgeMs) {
        const fromClean = m.from ? m.from.replace(/<[^>]+>/, '').trim() : 'Remitente';
        await this._recordNotifiedEmail(m, fromClean);
        continue;
      }

      // Si no es Nivel 1 ni Nivel 2, es Nivel 3 (ruido/promociones): registrar silenciosamente sin alertar
      if (!isNivel1 && !isNivel2) {
        const fromClean = m.from ? m.from.replace(/<[^>]+>/, '').trim() : 'Remitente';
        await this._recordNotifiedEmail(m, fromClean);
        continue;
      }

      // Canal Asíncrono de Emergencia de Sebastián
      if (triageResult.category === EmailCategory.EMERGENCIA_SEBASTIAN || triageResult.category === 'EMERGENCIA_SEBASTIAN') {
        let emailBody = m.bodyText || '';
        if (!emailBody && typeof this.gmailService.getEmailDetails === 'function') {
          try {
            const details = await this.gmailService.getEmailDetails({ messageId: m.id });
            emailBody = details?.bodyText || '';
          } catch {}
        }
        if (!emailBody) emailBody = m.snippet || m.subject || '';

        let agentReply = '';
        const rawOwner = config.ownerEmail || process.env.OWNER_EMAIL || m.from || 'owner@internal';
        const ownerEmail = (rawOwner.match(/<([^>]+)>/)?.[1] || rawOwner).trim();
        if (this.brain?.processTextMessage) {
          try {
            const res = await this.brain.processTextMessage({ channel: 'email', senderId: ownerEmail, senderName: 'Sebastián Jiménez', text: emailBody });
            agentReply = typeof res === 'string' ? res : (res?.reply || res?.text || '');
          } catch {
            try {
              const res = await this.brain.processTextMessage(emailBody);
              agentReply = typeof res === 'string' ? res : (res?.reply || res?.text || '');
            } catch {
              agentReply = '¡Hola Sebastián! He recibido tu instrucción de emergencia por correo y estoy ejecutándola de inmediato.';
            }
          }
        } else {
          agentReply = '¡Hola Sebastián! He recibido tu instrucción de emergencia por correo.';
        }

        if (typeof this.gmailService.sendEmail === 'function') {
          try {
            await this.gmailService.sendEmail({ to: ownerEmail, subject: `Carmencita Comunica: Re: ${m.subject || 'Directiva de Emergencia'}`, bodyText: agentReply });
          } catch (sendErr) {
            console.error('[Scheduler] Error enviando respuesta a correo de emergencia:', sendErr.message);
          }
        }

        await this._recordNotifiedEmail(m, m.from || 'Sebastián Jiménez');
        notified.push({ email: m, classification: triageResult, reply: agentReply, isEmergency: true });
        continue;
      }

      const isPriority = isNivel1 || isNivel2 ||
                         triageResult.urgency === EmailUrgency.CRITICO ||
                         triageResult.urgency === EmailUrgency.ALTA ||
                         triageResult.urgency === 'CRITICO' ||
                         triageResult.urgency === 'ALTA';

      if (isPriority) {
        priorityBatch.push({ email: m, classification: triageResult });
      }
    }

    if (priorityBatch.length > 0) {
      const naturalBriefing = typeof this.emailTriageService?.generateExecutiveEmailBriefing === 'function'
        ? await this.emailTriageService.generateExecutiveEmailBriefing(priorityBatch)
        : null;

      if (naturalBriefing) {
        await this._dispatchTelegram(naturalBriefing);
        for (const item of priorityBatch) {
          const fromClean = item.email.from ? item.email.from.replace(/<[^>]+>/, '').trim() : 'Remitente';
          await this._recordNotifiedEmail(item.email, fromClean);
          notified.push({ email: item.email, message: naturalBriefing, classification: item.classification });
        }
      }
    }

    this.lastInboxCheckTime = nowMs;
    return notified;
  }

  async _recordNotifiedEmail(email, senderName) {
    if (this.prisma?.notifiedEmail?.create) {
      await this.prisma.notifiedEmail.create({
        data: {
          emailId: email.id,
          sender: senderName || 'Desconocido',
          subject: email.subject || '(Sin Asunto)',
          notifiedAt: new Date(),
        },
      }).catch((err) => console.warn('[Scheduler] Error registrando notifiedEmail:', err.message));
    }
    if (this.notifiedEmailIds?.add) {
      this.notifiedEmailIds.add(email.id);
    }
  }

  // ----------------- RUTINA 4: CHECK-IN DE MEDIODÍA (24/7/365) -----------------
  async checkMiddaySync(referenceDate = new Date()) {
    const { todayStr, hour, minute } = getGuatemalaTimeParts(referenceDate);

    if (hour === 13 && minute <= 10 && this.lastMiddayDate !== todayStr) {
      this._syncBriefingService();
      const middayBrief = await this.executiveBriefingService.buildMiddayBriefing({ date: referenceDate });
      await this._dispatchTelegram(middayBrief.text);
      this.lastMiddayDate = todayStr;
      return middayBrief.text;
    }
    return null;
  }

  // ----------------- RUTINA 5: DEBRIEFING CIERRE DE JORNADA (24/7/365) -----------------
  async checkEveningDebrief(referenceDate = new Date()) {
    const { todayStr, hour, minute } = getGuatemalaTimeParts(referenceDate);

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

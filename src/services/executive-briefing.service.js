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

/**
 * Servicio Centralizador de Briefings Ejecutivos de Carmencita 2.0 (Deko Labs Standard).
 * Genera el Morning Briefing (07:30 AM) y el End-of-Day Wrap-Up (07:00 PM),
 * combinando agenda, tareas críticas, Gmail y síntesis multimodal de alta dirección.
 */
export class ExecutiveBriefingService {
  /**
   * @param {{
   *   ai?: unknown,
   *   calendarService?: unknown,
   *   taskService?: unknown,
   *   gmailService?: unknown,
   *   voiceService?: unknown,
   *   telegramAdapter?: unknown,
   *   weatherFetcher?: () => Promise<string>,
   *   brain?: unknown,
   * }} options
   */
  constructor({
    ai = null,
    calendarService = null,
    taskService = null,
    gmailService = null,
    voiceService = null,
    telegramAdapter = null,
    weatherFetcher = null,
    brain = null,
  } = {}) {
    this.ai = ai;
    this.calendarService = calendarService;
    this.taskService = taskService;
    this.gmailService = gmailService;
    this.voiceService = voiceService;
    this.telegramAdapter = telegramAdapter;
    this.weatherFetcher = weatherFetcher;
    this.brain = brain;
  }

  /**
   * Obtiene el clima en tiempo real de Ciudad de Guatemala vía Open-Meteo o inyector mock.
   */
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
      return `${temp}°C, ${mapWeatherCode(code)}`;
    } catch {
      return '21°C, Parcialmente nublado';
    }
  }

  /**
   * Genera el Morning Briefing (07:30 AM Guatemala) con triage inteligente.
   * @param {{ date?: Date }} [opts]
   * @returns {Promise<{ text: string, voicePrompt: string, data: Record<string, unknown> }>}
   */
  async buildMorningBriefing({ date = new Date() } = {}) {
    const weatherStr = await this.fetchGuatemalaWeather();

    let events = [];
    if (this.calendarService?.getTodayEvents) {
      try {
        events = await this.calendarService.getTodayEvents({ timeZone: 'America/Guatemala' });
      } catch (err) {
        console.warn('[ExecutiveBriefing] Error consultando agenda:', err.message);
      }
    }

    let tasks = [];
    if (this.taskService?.listTasks) {
      try {
        tasks = await this.taskService.listTasks({ onlyPending: true, limit: 5 });
      } catch (err) {
        console.warn('[ExecutiveBriefing] Error consultando tareas:', err.message);
      }
    }

    let unreadEmails = [];
    try {
      if (this.gmailService?.getInboxSummary) {
        const summary = await this.gmailService.getInboxSummary({ maxResults: 5 });
        unreadEmails = summary?.messages || [];
      } else if (this.gmailService?.getUnreadInboxMessages) {
        unreadEmails = await this.gmailService.getUnreadInboxMessages({ maxResults: 5, onlyImportant: true });
      }
    } catch (err) {
      console.warn('[ExecutiveBriefing] Error consultando Gmail:', err.message);
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

    const aiClient = this.ai || this.brain?.ai;
    if (aiClient?.models?.generateContent) {
      try {
        const prompt = `Eres Carmencita, la secretaria ejecutiva de Sebastián Jiménez. Redacta el Briefing Matutino de las 07:30 AM con zalamería reactiva, calidez ejecutiva y aire visual.\nDatos:\n- Clima: ${weatherStr}\n- Citas: ${eventsFormatted}\n- Tareas: ${tasksFormatted}\n- Correos: ${unreadEmails.map((m) => `${m.from}: ${m.subject}`).join(', ') || 'Bandeja limpia'}\n\nDirectivas: Saludo cariñoso y dinámico, párrafos cortos con doble salto (\\n\\n), HTML limpio (<b>, <i>) y emoticones sobrios (☕, 🌤️, 📅, 📋, ✉️). CERO asteriscos.`;
        const res = await aiClient.models.generateContent({
          model: config.ai.modelName,
          contents: prompt,
          config: { temperature: 0.6 },
        });
        const aiText = typeof res?.text === 'function' ? res.text() : (res?.text || '');
        if (aiText && aiText.trim().length > 20) {
          message = sanitizeReplyText(aiText.trim());
        }
      } catch (aiErr) {
        console.warn('[ExecutiveBriefing] Falló síntesis de briefing con IA, usando fallback estructurado:', aiErr.message);
      }
    }

    const voicePrompt = message
      .replace(/<[^>]+>/g, '')
      .replace(/[•\-\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      text: sanitizeReplyText(message),
      voicePrompt,
      data: {
        events,
        tasks,
        unreadEmails,
        weather: weatherStr,
      },
    };
  }

  /**
   * Genera el End-of-Day Wrap-Up (07:00 PM Guatemala) con balance y vista del día siguiente.
   * @param {{ date?: Date }} [opts]
   * @returns {Promise<{ text: string, data: Record<string, unknown> }>}
   */
  async buildEveningBriefing({ date = new Date() } = {}) {
    let pendingTasks = [];
    if (this.taskService?.listTasks) {
      try {
        pendingTasks = await this.taskService.listTasks({ onlyPending: true, limit: 5 });
      } catch (err) {
        console.warn('[ExecutiveBriefing] Error consultando tareas pendientes:', err.message);
      }
    }

    let tomorrowEvents = [];
    let tomorrowSummary = '• Mañana tienes tu agenda despejada para crear y avanzar.';
    if (this.calendarService?.getTomorrowEvents) {
      try {
        tomorrowEvents = await this.calendarService.getTomorrowEvents({ excludeBirthdays: true });
        if (tomorrowEvents && tomorrowEvents.length > 0) {
          tomorrowSummary = tomorrowEvents.map((e) => `• ${e.summary}`).join('\n');
        }
      } catch (err) {
        console.warn('[ExecutiveBriefing] Error consultando citas de mañana:', err.message);
      }
    }

    let message = [
      '✨ <b>¡Mi jefe consentido, hora de cerrar jornada por hoy!</b>',
      '',
      '📅 <b>Para mañana:</b>',
      tomorrowSummary,
      '',
      '¿Quedó algún acuerdo importante, cotización o apunte de hoy que quieras que te resguarde en tu bóveda de Obsidian antes de descansar?',
    ].join('\n');

    const aiClient = this.ai || this.brain?.ai;
    if (aiClient?.models?.generateContent) {
      try {
        const prompt = `Eres Carmencita, la secretaria ejecutiva de Sebastián Jiménez. Redacta el Debriefing de Cierre de Jornada (Wrap-Up) de las 07:00 PM con zalamería reactiva, calidez ejecutiva y aire visual.\nDatos:\n- Agenda para mañana:\n${tomorrowSummary}\n- Tareas pendientes a reprogramar: ${pendingTasks.map((t) => t.description).join(', ') || 'Ninguna'}\n\nDirectivas: Saludo cariñoso, balance del día, vista ejecutiva de mañana, párrafos cortos con doble salto (\\n\\n), HTML limpio (<b>, <i>). CERO asteriscos.`;
        const res = await aiClient.models.generateContent({
          model: config.ai.modelName,
          contents: prompt,
          config: { temperature: 0.6 },
        });
        const aiText = typeof res?.text === 'function' ? res.text() : (res?.text || '');
        if (aiText && aiText.trim().length > 20) {
          message = sanitizeReplyText(aiText.trim());
        }
      } catch (aiErr) {
        console.warn('[ExecutiveBriefing] Falló síntesis de evening debrief con IA:', aiErr.message);
      }
    }

    return {
      text: sanitizeReplyText(message),
      data: {
        tomorrowEvents,
        pendingTasks,
      },
    };
  }
}

import { config } from '../config.js';

export function toGuatemalaIso(dateStr, timeZone = 'America/Guatemala') {
  if (!dateStr) return dateStr;
  if (dateStr instanceof Date) return dateStr.toISOString();
  if (typeof dateStr === 'string') {
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T00:00:00-06:00`;
    }
    if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed)) {
      return new Date(trimmed).toISOString();
    }
    return new Date(`${trimmed}-06:00`).toISOString();
  }
  return new Date(dateStr).toISOString();
}

export class CalendarService {
  constructor(opts = {}) {
    this.clientId = opts.clientId ?? config.google?.clientId ?? '';
    this.clientSecret = opts.clientSecret ?? config.google?.clientSecret ?? '';
    this.refreshToken = opts.refreshToken ?? config.google?.refreshToken ?? '';
    this.calendarClient = opts.calendarClient || null;
  }

  isConfigured() {
    return Boolean(this.calendarClient || (this.refreshToken && this.clientId && this.clientSecret));
  }

  async _getCalendarClient() {
    if (this.calendarClient) return this.calendarClient;
    if (!this.refreshToken) return null;

    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
      oauth2Client.setCredentials({ refresh_token: this.refreshToken });
      this.calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });
      return this.calendarClient;
    } catch (err) {
      console.warn('[CalendarService] Google Calendar API no disponible o googleapis ausente:', err.message);
      return null;
    }
  }

  async createEvent({
    summary, description = '', startDateTime, endDateTime = null, location = '',
    calendarId = 'primary', timeZone = 'America/Guatemala', checkExisting = true,
  }) {
    const calendar = await this._getCalendarClient();
    if (!calendar) {
      throw new Error('Google Calendar no está configurado (falta GOOGLE_REFRESH_TOKEN o cliente OAuth).');
    }

    const startIso = toGuatemalaIso(startDateTime, timeZone);
    let endIso = endDateTime ? toGuatemalaIso(endDateTime, timeZone) : null;
    if (!endIso) {
      const startObj = new Date(startIso);
      endIso = !isNaN(startObj.getTime()) ? new Date(startObj.getTime() + 60 * 60 * 1000).toISOString() : startIso;
    }

    if (checkExisting) {
      try {
        let existingEvents = [];
        const startDateObj = new Date(startIso);
        if (!isNaN(startDateObj.getTime())) {
          const dayStart = new Date(startDateObj);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(startDateObj);
          dayEnd.setHours(23, 59, 59, 999);
          existingEvents = await this.getEventsForDateRange({
            startDate: dayStart.toISOString(), endDate: dayEnd.toISOString(), calendarId, timeZone,
          });
        }
        if (!existingEvents || existingEvents.length === 0) {
          existingEvents = await this.listUpcomingEvents({ maxResults: 30, calendarId });
        }

        const normalize = (str) => (str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
        const targetNorm = normalize(summary);
        if (targetNorm && existingEvents && existingEvents.length > 0) {
          const existing = existingEvents.find((ev) => {
            const evNorm = normalize(ev.summary);
            return evNorm && (evNorm.includes(targetNorm) || targetNorm.includes(evNorm));
          });

          if (existing) {
            const startVal = typeof existing.start === 'object' ? (existing.start?.dateTime || existing.start?.date) : existing.start;
            const endVal = typeof existing.end === 'object' ? (existing.end?.dateTime || existing.end?.date) : existing.end;
            return {
              alreadyExisted: true, id: existing.id, summary: existing.summary,
              start: startVal || startIso, end: endVal || endIso,
              location: existing.location || location,
              htmlLink: existing.htmlLink || `https://calendar.google.com/calendar/event?eid=${existing.id}`,
              status: 'confirmed',
            };
          }
        }
      } catch (checkErr) {
        console.warn('[CalendarService] Error verificando eventos existentes:', checkErr.message);
      }
    }

    const eventResource = {
      summary, description: description || undefined, location: location || undefined,
      start: { dateTime: startIso, timeZone },
      end: { dateTime: endIso, timeZone },
    };

    const res = await calendar.events.insert({ calendarId, requestBody: eventResource });
    const event = res.data;
    return {
      id: event.id, summary: event.summary || summary,
      start: event.start?.dateTime || startIso, end: event.end?.dateTime || endIso,
      htmlLink: event.htmlLink || `https://calendar.google.com/calendar/event?eid=${event.id}`,
      status: event.status || 'confirmed',
    };
  }

  async listUpcomingEvents({
    maxResults = 10,
    calendarId = 'primary',
    timeMin = new Date().toISOString(),
    timeMax = null,
    excludeBirthdays = true,
  } = {}) {
    const calendar = await this._getCalendarClient();
    if (!calendar) {
      return [];
    }

    const listParams = {
      calendarId,
      timeMin,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    };
    if (timeMax) {
      listParams.timeMax = typeof timeMax === 'string' ? timeMax : new Date(timeMax).toISOString();
    }

    const res = await calendar.events.list(listParams);

    const items = res.data?.items || [];
    let mapped = items.map((item) => ({
      id: item.id,
      summary: item.summary || '(Sin título)',
      isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
      eventType: item.eventType || 'default',
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      htmlLink: item.htmlLink,
      location: item.location || null,
    }));

    if (excludeBirthdays) {
      mapped = mapped.filter(
        (item) => item.eventType !== 'birthday' && !/cumpleaños/i.test(item.summary || '')
      );
    }

    return mapped;
  }

  async getEventsForDateRange({
    startDate,
    endDate,
    calendarId = 'primary',
    timeZone = 'America/Guatemala',
  }) {
    const calendar = await this._getCalendarClient();
    if (!calendar) {
      return [];
    }

    const timeMin = new Date(startDate).toISOString();
    const timeMax = new Date(endDate).toISOString();

    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const items = res.data?.items || [];
    return items.map((item) => ({
      id: item.id,
      summary: item.summary || '(Sin título)',
      description: item.description || '',
      isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
      eventType: item.eventType || 'default',
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      location: item.location || null,
      htmlLink: item.htmlLink || `https://calendar.google.com/calendar/event?eid=${item.id}`,
    }));
  }

  async getMonthEvents({
    month = null,
    year = null,
    calendarId = 'primary',
    timeZone = 'America/Guatemala',
    excludeBirthdays = true,
  } = {}) {
    const now = new Date();
    const targetYear = year ?? now.getFullYear();
    const targetMonth = month !== null ? month : now.getMonth(); // 0-indexed

    // Primer día del mes a las 00:00:00 en timeZone (UTC-6)
    const startDate = new Date(Date.UTC(targetYear, targetMonth, 1, 6, 0, 0));
    // Último día del mes a las 23:59:59 en timeZone
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const endDate = new Date(Date.UTC(targetYear, targetMonth, lastDay, 29, 59, 59, 999));

    const events = await this.getEventsForDateRange({ startDate, endDate, calendarId, timeZone });
    if (excludeBirthdays) {
      return events.filter((e) => e.eventType !== 'birthday' && !/cumpleaños/i.test(e.summary || ''));
    }
    return events;
  }

  async getTodayEvents({ calendarId = 'primary', timeZone = 'America/Guatemala', excludeBirthdays = true } = {}) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const startDate = new Date(`${parts}T00:00:00-06:00`), endDate = new Date(`${parts}T23:59:59.999-06:00`);
    const events = await this.getEventsForDateRange({ startDate, endDate, calendarId, timeZone });
    return excludeBirthdays ? events.filter((e) => e.eventType !== 'birthday' && !/cumpleaños/i.test(e.summary || '')) : events;
  }

  async getTomorrowEvents({ calendarId = 'primary', timeZone = 'America/Guatemala', excludeBirthdays = true } = {}) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
    const startDate = new Date(`${parts}T00:00:00-06:00`), endDate = new Date(`${parts}T23:59:59.999-06:00`);
    const events = await this.getEventsForDateRange({ startDate, endDate, calendarId, timeZone });
    return excludeBirthdays ? events.filter((e) => e.eventType !== 'birthday' && !/cumpleaños/i.test(e.summary || '')) : events;
  }

  async rescheduleEvent({ eventId = null, query = null, newStartDateTime, newEndDateTime = null, calendarId = 'primary', timeZone = 'America/Guatemala' }) {
    const calendar = await this._getCalendarClient();
    if (!calendar) throw new Error('Google Calendar no configurado');

    let targetEventId = eventId;
    if (!targetEventId && query) {
      const upcoming = await this.listUpcomingEvents({ maxResults: 15, calendarId });
      const found = upcoming.find((e) => e.summary.toLowerCase().includes(query.toLowerCase()));
      if (found) targetEventId = found.id;
    }

    if (!targetEventId) throw new Error(`Evento no encontrado${query ? `: "${query}"` : ''}`);

    const startIso = toGuatemalaIso(newStartDateTime, timeZone);
    let endIso = newEndDateTime ? toGuatemalaIso(newEndDateTime, timeZone) : null;
    if (!endIso) {
      const startObj = new Date(startIso);
      endIso = new Date(startObj.getTime() + 60 * 60 * 1000).toISOString();
    }

    const res = await calendar.events.patch({
      calendarId,
      eventId: targetEventId,
      requestBody: {
        start: { dateTime: startIso, timeZone },
        end: { dateTime: endIso, timeZone },
      },
    });

    return {
      id: res.data.id,
      summary: res.data.summary,
      start: res.data.start?.dateTime || startIso,
      end: res.data.end?.dateTime || endIso,
      htmlLink: res.data.htmlLink,
    };
  }

  async cancelEvent({ eventId = null, query = null, calendarId = 'primary' }) {
    const calendar = await this._getCalendarClient();
    if (!calendar) throw new Error('Google Calendar no configurado');

    let targetEventId = eventId;
    if (!targetEventId && query) {
      const upcoming = await this.listUpcomingEvents({ maxResults: 15, calendarId });
      const found = upcoming.find((e) => e.summary.toLowerCase().includes(query.toLowerCase()));
      if (found) targetEventId = found.id;
    }

    if (!targetEventId) throw new Error(`Evento no encontrado${query ? `: "${query}"` : ''}`);

    await calendar.events.delete({ calendarId, eventId: targetEventId });
    return { success: true, eventId: targetEventId };
  }
}

export const defaultCalendarService = new CalendarService();

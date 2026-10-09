import { config } from '../config.js';

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
    summary,
    description = '',
    startDateTime,
    endDateTime = null,
    location = '',
    calendarId = 'primary',
    timeZone = 'America/Guatemala',
    checkExisting = true,
  }) {
    const calendar = await this._getCalendarClient();
    if (!calendar) {
      throw new Error('Google Calendar no está configurado (falta GOOGLE_REFRESH_TOKEN o cliente OAuth).');
    }

    let endIso = endDateTime;
    if (!endIso) {
      const start = new Date(startDateTime);
      if (!isNaN(start.getTime())) {
        endIso = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
      } else {
        endIso = startDateTime;
      }
    }

    if (checkExisting) {
      try {
        let existingEvents = [];
        const startDateObj = new Date(startDateTime);
        if (!isNaN(startDateObj.getTime())) {
          const dayStart = new Date(startDateObj);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(startDateObj);
          dayEnd.setHours(23, 59, 59, 999);
          existingEvents = await this.getEventsForDateRange({
            startDate: dayStart.toISOString(),
            endDate: dayEnd.toISOString(),
            calendarId,
            timeZone,
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
              alreadyExisted: true,
              id: existing.id,
              summary: existing.summary,
              start: startVal || startDateTime,
              end: endVal || endIso,
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
      summary,
      description: description || undefined,
      location: location || undefined,
      start: {
        dateTime: new Date(startDateTime).toISOString(),
        timeZone,
      },
      end: {
        dateTime: new Date(endIso).toISOString(),
        timeZone,
      },
    };

    const res = await calendar.events.insert({
      calendarId,
      requestBody: eventResource,
    });

    const event = res.data;
    return {
      id: event.id,
      summary: event.summary || summary,
      start: event.start?.dateTime || startDateTime,
      end: event.end?.dateTime || endIso,
      htmlLink: event.htmlLink || `https://calendar.google.com/calendar/event?eid=${event.id}`,
      status: event.status || 'confirmed',
    };
  }

  async listUpcomingEvents({ maxResults = 10, calendarId = 'primary', timeMin = new Date().toISOString() } = {}) {
    const calendar = await this._getCalendarClient();
    if (!calendar) {
      return [];
    }

    const res = await calendar.events.list({
      calendarId,
      timeMin,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const items = res.data?.items || [];
    return items.map((item) => ({
      id: item.id,
      summary: item.summary || '(Sin título)',
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      htmlLink: item.htmlLink,
      location: item.location || null,
    }));
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
      start: item.start?.dateTime || item.start?.date,
      end: item.end?.dateTime || item.end?.date,
      location: item.location || null,
      htmlLink: item.htmlLink || `https://calendar.google.com/calendar/event?eid=${item.id}`,
    }));
  }

  async getTodayEvents({ calendarId = 'primary', timeZone = 'America/Guatemala' } = {}) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const startDate = new Date(`${parts}T00:00:00-06:00`);
    const endDate = new Date(`${parts}T23:59:59.999-06:00`);

    return await this.getEventsForDateRange({ startDate, endDate, calendarId, timeZone });
  }

  async getTomorrowEvents({ calendarId = 'primary', timeZone = 'America/Guatemala' } = {}) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(tomorrow);

    const startDate = new Date(`${parts}T00:00:00-06:00`);
    const endDate = new Date(`${parts}T23:59:59.999-06:00`);

    return await this.getEventsForDateRange({ startDate, endDate, calendarId, timeZone });
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

    let endIso = newEndDateTime;
    if (!endIso) {
      const start = new Date(newStartDateTime);
      endIso = new Date(start.getTime() + 60 * 60 * 1000).toISOString();
    }

    const res = await calendar.events.patch({
      calendarId,
      eventId: targetEventId,
      requestBody: {
        start: { dateTime: new Date(newStartDateTime).toISOString(), timeZone },
        end: { dateTime: new Date(endIso).toISOString(), timeZone },
      },
    });

    return {
      id: res.data.id,
      summary: res.data.summary,
      start: res.data.start?.dateTime,
      end: res.data.end?.dateTime,
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

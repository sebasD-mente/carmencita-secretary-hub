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
}

export const defaultCalendarService = new CalendarService();

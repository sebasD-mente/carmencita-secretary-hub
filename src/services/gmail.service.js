import { config } from '../config.js';

export class GmailService {
  constructor(opts = {}) {
    this.clientId = opts.clientId ?? config.google?.clientId ?? '';
    this.clientSecret = opts.clientSecret ?? config.google?.clientSecret ?? '';
    this.refreshToken = opts.refreshToken ?? config.google?.refreshToken ?? '';
    this.gmailClient = opts.gmailClient || null;
  }

  isConfigured() {
    return Boolean(this.gmailClient || (this.refreshToken && this.clientId && this.clientSecret));
  }

  async _getGmailClient() {
    if (this.gmailClient) return this.gmailClient;
    if (!this.refreshToken) return null;

    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
      oauth2Client.setCredentials({ refresh_token: this.refreshToken });
      this.gmailClient = google.gmail({ version: 'v1', auth: oauth2Client });
      return this.gmailClient;
    } catch (err) {
      console.warn('[GmailService] Google Gmail API no disponible o googleapis ausente:', err.message);
      return null;
    }
  }

  /**
   * Obtiene los correos no leídos de la bandeja de entrada
   * @param {Object} options
   * @param {number} [options.maxResults=5]
   * @param {string} [options.query='is:unread label:INBOX']
   * @returns {Promise<Array<{id: string, threadId: string, from: string, subject: string, date: string, snippet: string}>>}
   */
  async getUnreadInboxMessages({ maxResults = 5, query = 'is:unread label:INBOX' } = {}) {
    const gmail = await this._getGmailClient();
    if (!gmail) return [];

    try {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      const messages = listRes.data?.messages || [];
      if (messages.length === 0) return [];

      const detailedMessages = await Promise.all(
        messages.map(async (msg) => {
          try {
            const detail = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date'],
            });
            const headers = detail.data?.payload?.headers || [];
            const getHeader = (name) =>
              headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

            return {
              id: msg.id,
              threadId: msg.threadId,
              from: getHeader('From'),
              subject: getHeader('Subject') || '(Sin Asunto)',
              date: getHeader('Date'),
              snippet: detail.data?.snippet || '',
            };
          } catch (err) {
            console.warn(`[GmailService] Error obteniendo detalle de correo ${msg.id}:`, err.message);
            return null;
          }
        })
      );

      return detailedMessages.filter(Boolean);
    } catch (err) {
      console.error('[GmailService] Error consultando mensajes de Gmail:', err.message);
      return [];
    }
  }

  /**
   * Resumen para el Briefing Matutino
   */
  async getInboxSummary({ maxResults = 5 } = {}) {
    const messages = await this.getUnreadInboxMessages({ maxResults });
    return {
      totalUnread: messages.length,
      messages,
    };
  }
}

export const defaultGmailService = new GmailService();

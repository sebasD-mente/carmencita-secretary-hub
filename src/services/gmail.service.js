import { config } from '../config.js';

export const DEFAULT_GMAIL_QUERY = 'is:unread label:INBOX category:primary -category:social -category:promotions -category:forums';

/**
 * Determina si un correo es publicidad, red social, boletín masivo o spam
 * @param {Object} params
 * @param {string} [params.from='']
 * @param {string} [params.subject='']
 * @param {string} [params.snippet='']
 * @param {boolean} [params.hasUnsubscribe=false]
 * @returns {boolean}
 */
export function isPromotionalOrNoise({ from = '', subject = '', snippet = '', hasUnsubscribe = false } = {}) {
  const fromLower = from.toLowerCase();
  const subLower = subject.toLowerCase();
  const snipLower = snippet.toLowerCase();

  // 1. Redes sociales
  if (/facebookmail|linkedin\.com|twitter\.com|instagram\.com|tiktok\.com|pinterest\.com|youtube\.com/i.test(fromLower)) {
    return true;
  }

  // 2. Remitentes de marketing / publicidad / newsletters
  if (/marketing|newsletter|promocion|promo@|ofertas@|deals@|campaign|notifyemail\.microsoftrewards|realpython\.com/i.test(fromLower)) {
    return true;
  }

  // 3. Patrones de ofertas y publicidad en el asunto
  if (/% (off|descuento)|descuento exclusivo|reclama tus puntos|días gratis|unrestricted learning|live shop|oferta exclusiva|weekly digest|boletín semanal/i.test(subLower)) {
    return true;
  }

  // 4. Campañas masivas con cabecera List-Unsubscribe
  if (hasUnsubscribe && /newsletter|artículos de la semana|updates waiting|weekly digest|unrestricted learning|cursos de la semana/i.test(snipLower + subLower)) {
    return true;
  }

  return false;
}

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
   * Obtiene los correos no leídos de la bandeja de entrada filtrando publicidad y redes
   * @param {Object} options
   * @param {number} [options.maxResults=5]
   * @param {string} [options.query=DEFAULT_GMAIL_QUERY]
   * @param {boolean} [options.onlyImportant=true]
   * @returns {Promise<Array<{id: string, threadId: string, from: string, subject: string, date: string, snippet: string}>>}
   */
  async getUnreadInboxMessages({
    maxResults = 5,
    query = DEFAULT_GMAIL_QUERY,
    onlyImportant = true,
  } = {}) {
    const gmail = await this._getGmailClient();
    if (!gmail) return [];

    try {
      // Buffer para compensar descartes por filtrado de ruido
      const fetchLimit = onlyImportant ? Math.max(maxResults * 3, 15) : maxResults;

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: fetchLimit,
      });

      const messages = listRes.data?.messages || [];
      if (messages.length === 0) return [];

      const candidateMessages = await Promise.all(
        messages.map(async (msg) => {
          try {
            const detail = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date', 'List-Unsubscribe'],
            });
            const headers = detail.data?.payload?.headers || [];
            const getHeader = (name) =>
              headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

            const from = getHeader('From');
            const subject = getHeader('Subject') || '(Sin Asunto)';
            const date = getHeader('Date');
            const snippet = detail.data?.snippet || '';
            const hasUnsubscribe = Boolean(getHeader('List-Unsubscribe'));

            if (onlyImportant && isPromotionalOrNoise({ from, subject, snippet, hasUnsubscribe })) {
              return null;
            }

            return {
              id: msg.id,
              threadId: msg.threadId,
              from,
              subject,
              date,
              snippet,
            };
          } catch (err) {
            console.warn(`[GmailService] Error obteniendo detalle de correo ${msg.id}:`, err.message);
            return null;
          }
        })
      );

      const filtered = candidateMessages.filter(Boolean);
      return filtered.slice(0, maxResults);
    } catch (err) {
      console.error('[GmailService] Error consultando mensajes de Gmail:', err.message);
      return [];
    }
  }

  /**
   * Resumen para el Briefing Matutino (correos principales)
   * @param {Object} options
   * @param {number} [options.maxResults=5]
   * @param {boolean} [options.onlyImportant=true]
   */
  async getInboxSummary({ maxResults = 5, onlyImportant = true } = {}) {
    const messages = await this.getUnreadInboxMessages({ maxResults, onlyImportant });
    return {
      totalUnread: messages.length,
      messages,
    };
  }
}

export const defaultGmailService = new GmailService();

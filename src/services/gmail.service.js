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

export function extractBodyFromPayload(payload) {
  if (!payload) return '';
  let textPlain = '';
  let textHtml = '';

  function traverse(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      try {
        const decoded = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        textPlain += (textPlain ? '\n' : '') + decoded;
      } catch {}
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      try {
        const decoded = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        textHtml += (textHtml ? '\n' : '') + decoded;
      } catch {}
    }

    if (Array.isArray(part.parts)) {
      for (const childPart of part.parts) {
        traverse(childPart);
      }
    }
  }

  traverse(payload);

  if (textPlain.trim()) {
    return textPlain.trim();
  }

  if (textHtml.trim()) {
    return textHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return '';
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
   * Búsqueda flexible de correos (incluye leídos y no leídos si hay query específico)
   * @param {Object} options
   * @param {string} [options.query='']
   * @param {number} [options.maxResults=5]
   * @param {boolean} [options.onlyImportant=false]
   * @param {boolean} [options.includeRead=true]
   * @returns {Promise<Array<{id: string, threadId: string, from: string, subject: string, date: string, snippet: string}>>}
   */
  async searchEmails({
    query = '',
    maxResults = 5,
    onlyImportant = false,
    includeRead = true,
  } = {}) {
    const gmail = await this._getGmailClient();
    if (!gmail) return [];

    try {
      const cleanQuery = (query || '').trim();
      const hasSpecificQuery = cleanQuery.length > 0;

      let q = '';
      if (hasSpecificQuery) {
        const mentionsSocial = /facebook|instagram|redes/i.test(cleanQuery);
        const noiseExclusion = mentionsSocial
          ? ''
          : ' -category:social -category:promotions -from:facebookmail -from:instagram -from:tiktok';
        q = `${cleanQuery}${noiseExclusion}`;
      } else {
        q = includeRead
          ? 'label:INBOX -category:social -category:promotions -category:forums -from:facebookmail -from:instagram -from:tiktok'
          : 'label:INBOX is:unread -category:social -category:promotions -category:forums -from:facebookmail -from:instagram -from:tiktok';
      }

      const parsedMax = Number(maxResults) || 5;
      const effectiveMax = Math.min(Math.max(parsedMax, 1), 30);
      const fetchLimit = (!hasSpecificQuery && onlyImportant) ? Math.max(effectiveMax * 3, 15) : effectiveMax;

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q,
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

            // Si es búsqueda específica por término/remitente, NO descartar con isPromotionalOrNoise
            if (!hasSpecificQuery && onlyImportant && isPromotionalOrNoise({ from, subject, snippet, hasUnsubscribe })) {
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
            console.warn(`[GmailService] Error obteniendo metadata de correo ${msg.id}:`, err.message);
            return null;
          }
        })
      );

      const filtered = candidateMessages.filter(Boolean);
      return filtered.slice(0, effectiveMax);
    } catch (err) {
      console.error('[GmailService] Error consultando mensajes en searchEmails:', err.message);
      return [];
    }
  }

  /**
   * Obtiene los detalles completos de un correo específico, decodificando el cuerpo en base64url
   * @param {Object} options
   * @param {string} options.messageId
   */
  async getEmailDetails({ messageId }) {
    if (!messageId) throw new Error('messageId es obligatorio');
    const gmail = await this._getGmailClient();
    if (!gmail) throw new Error('Gmail API no configurado');

    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = detail.data?.payload?.headers || [];
    const getHeader = (name) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('From');
    const subject = getHeader('Subject') || '(Sin Asunto)';
    const date = getHeader('Date');
    const snippet = detail.data?.snippet || '';
    const extractedBodyText = extractBodyFromPayload(detail.data?.payload) || snippet;

    return {
      id: detail.data?.id,
      threadId: detail.data?.threadId,
      from,
      subject,
      date,
      snippet,
      bodyText: extractedBodyText.slice(0, 4000),
      labels: detail.data?.labelIds || [],
    };
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

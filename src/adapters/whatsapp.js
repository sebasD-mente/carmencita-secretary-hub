import { config } from '../config.js';

export class WhatsAppAdapter {
  constructor(brainService, storageService = null) {
    this.brain = brainService;
    this.storage = storageService;
    this.baseUrl = config.whatsapp.evolutionUrl;
    this.apiKey = config.whatsapp.apiKey;
    this.instance = config.whatsapp.instanceName;
  }

  _extractMessageText(reply) {
    if (!reply) return '';
    return typeof reply === 'object' ? (reply.reply || reply.text || '') : String(reply);
  }

  // --- ENVIAR MENSAJE DE TEXTO ---
  async sendMessage(toPhone, text) {
    const cleanNumber = toPhone.replace(/\D/g, '');
    const url = `${this.baseUrl}/message/sendText/${this.instance}`;
    const cleanText = this._extractMessageText(text);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey,
        },
        body: JSON.stringify({
          number: cleanNumber,
          text: cleanText,
          delay: 1200,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[WhatsApp] Error enviando mensaje a ${cleanNumber}:`, errorText);
        return false;
      }

      return true;
    } catch (err) {
      console.error(`[WhatsApp] Error de red enviando a ${cleanNumber}:`, err.message);
      return false;
    }
  }

  // --- ENVIAR ARCHIVO MULTIMEDIA / DOCUMENTO ---
  async sendMedia(toPhone, { buffer, fileName, mimeType = 'application/octet-stream', caption = '' }) {
    const cleanNumber = toPhone.replace(/\D/g, '');
    const url = `${this.baseUrl}/message/sendMedia/${this.instance}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey,
        },
        body: JSON.stringify({
          number: cleanNumber,
          mediatype: 'document',
          mimetype: mimeType,
          caption: this._extractMessageText(caption),
          media: buffer.toString('base64'),
          fileName: fileName || 'documento.bin',
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[WhatsApp] Error enviando documento a ${cleanNumber}:`, errorText);
        return false;
      }

      return true;
    } catch (err) {
      console.error(`[WhatsApp] Error de red enviando media a ${cleanNumber}:`, err.message);
      return false;
    }
  }

  // --- PROCESAR WEBHOOK RECIBIDO DE EVOLUTION API ---
  async handleWebhook(payload) {
    const event = payload?.event;

    if (event === 'qrcode.updated') {
      console.log('📲 [WhatsApp QR] Nuevo código QR generado en Evolution API.');
      return { status: 'qr_received' };
    }

    if (event === 'connection.update') {
      const state = payload.data?.state;
      console.log(`📡 [WhatsApp Conexión] Estado actual: ${state}`);
      return { status: 'connection_update', state };
    }

    if (event === 'messages.upsert') {
      const messageData = payload.data;
      if (!messageData || !messageData.key) return { status: 'ignored' };

      const remoteJid = messageData.key.remoteJid || '';
      if (remoteJid.includes('@g.us') || remoteJid.includes('broadcast')) {
        return { status: 'ignored_group' };
      }

      const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
      const senderName = messageData.pushName || 'Sebastián';
      if (messageData.key.fromMe) return { status: 'ignored_from_me' };

      // Filtro de Seguridad (Whitelist)
      if (config.whatsapp.allowedNumbers.length > 0) {
        if (!config.whatsapp.allowedNumbers.includes(senderPhone)) {
          console.warn(`[WhatsApp Security] Mensaje no autorizado: ${senderPhone}`);
          return { status: 'unauthorized' };
        }
      }

      const message = messageData.message;
      if (!message) return { status: 'empty_message' };

      // Caso A: Mensaje de Texto
      const text = message.conversation || message.extendedTextMessage?.text;
      if (text) {
        console.log(`💬 [WhatsApp] Texto recibido de ${senderPhone}: "${text}"`);
        const reply = await this.brain.processTextMessage({
          channel: 'whatsapp',
          senderId: senderPhone,
          senderName,
          text,
          onProgress: async (ackText) => {
            const messageText = this._extractMessageText(ackText);
            await this.sendMessage(senderPhone, messageText);
          },
        });

        if (reply?.hasExcel && reply?.excelFile) {
          await this.sendMedia(senderPhone, {
            buffer: reply.excelFile.buffer,
            fileName: reply.excelFile.fileName,
            mimeType: reply.excelFile.mimeType,
            caption: this._extractMessageText(reply),
          });
        } else {
          const messageText = this._extractMessageText(reply);
          await this.sendMessage(senderPhone, messageText);
        }
        return { status: 'processed_text' };
      }

      // Caso B: Imagen (Foto / Factura)
      if (message.imageMessage) {
        console.log(`📷 [WhatsApp] Foto recibida de ${senderPhone}`);
        const caption = message.imageMessage.caption || '';
        const buffer = await this._downloadMediaBase64(messageData);

        if (buffer) {
          const reply = await this.brain.processImage({
            channel: 'whatsapp',
            senderId: senderPhone,
            senderName,
            buffer,
            mimeType: message.imageMessage.mimetype || 'image/jpeg',
            caption,
          });
          const messageText = this._extractMessageText(reply);
          await this.sendMessage(senderPhone, messageText);
          return { status: 'processed_image' };
        }
      }

      // Caso C: Documentos Universales (PDF, Excel, Cotizaciones, etc.)
      if (message.documentMessage) {
        console.log(`📑 [WhatsApp] Documento recibido de ${senderPhone}`);
        const docMsg = message.documentMessage;
        const fileName = docMsg.fileName || 'documento.pdf';
        const mimeType = docMsg.mimetype || 'application/pdf';
        const caption = docMsg.caption || '';
        const buffer = await this._downloadMediaBase64(messageData);

        if (buffer) {
          const reply = await this.brain.processDocument({
            channel: 'whatsapp',
            senderId: senderPhone,
            senderName,
            buffer,
            mimeType,
            originalName: fileName,
            caption,
          });
          const messageText = this._extractMessageText(reply);
          await this.sendMessage(senderPhone, messageText);
          return { status: 'processed_document' };
        }
      }

      // Caso D: Nota de voz / Audio
      if (message.audioMessage) {
        console.log(`🎙️ [WhatsApp] Audio recibido de ${senderPhone}`);
        const buffer = await this._downloadMediaBase64(messageData);

        if (buffer) {
          const reply = await this.brain.processAudio({
            channel: 'whatsapp',
            senderId: senderPhone,
            senderName,
            buffer,
            mimeType: message.audioMessage.mimetype || 'audio/ogg',
            onProgress: async (ackText) => {
              const messageText = this._extractMessageText(ackText);
              await this.sendMessage(senderPhone, messageText);
            },
          });

          if (reply?.hasExcel && reply?.excelFile) {
            await this.sendMedia(senderPhone, {
              buffer: reply.excelFile.buffer,
              fileName: reply.excelFile.fileName,
              mimeType: reply.excelFile.mimeType,
              caption: this._extractMessageText(reply),
            });
          } else {
            const messageText = this._extractMessageText(reply);
            await this.sendMessage(senderPhone, messageText);
          }
          return { status: 'processed_audio' };
        }
      }
    }

    return { status: 'unhandled_event' };
  }

  async _downloadMediaBase64(messageData) {
    try {
      const url = `${this.baseUrl}/chat/findMediaBase64/${this.instance}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey,
        },
        body: JSON.stringify({
          message: messageData,
          convertToMp4: false,
        }),
      });

      if (!res.ok) {
        console.error('[WhatsApp] Error obteniendo base64:', await res.text());
        return null;
      }

      const json = await res.json();
      return json.base64 ? Buffer.from(json.base64, 'base64') : null;
    } catch (err) {
      console.error('[WhatsApp] Excepción descargando media:', err.message);
      return null;
    }
  }
}

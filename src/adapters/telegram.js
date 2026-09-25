import { Bot, InputFile } from 'grammy';
import { config } from '../config.js';

export class TelegramAdapter {
  constructor(brainService, storageService = null) {
    this.brain = brainService;
    this.storage = storageService;
    this.bot = null;
    this.isRunning = false;
  }

  init() {
    if (!config.telegram.token) {
      console.warn('[Telegram] No TELEGRAM_BOT_TOKEN provided. Telegram adapter disabled.');
      return false;
    }

    this.bot = new Bot(config.telegram.token);

    // Middleware de Seguridad Estricta (Whitelist de Sebastián)
    this.bot.use(async (ctx, next) => {
      const fromId = String(ctx.from?.id || '');
      const fromName = ctx.from?.first_name || 'Desconocido';

      if (config.telegram.allowedUsers.length > 0) {
        if (!config.telegram.allowedUsers.includes(fromId)) {
          console.warn(`[Telegram Security] Acceso denegado: ${fromName} (ID: ${fromId})`);
          await ctx.reply('🔒 Acceso restringido. Este asistente personal pertenece exclusivamente a Sebastián Jiménez.');
          return;
        }
      } else {
        console.log(`\n🔔 TELEGRAM ID DETECTADO: ${fromId} (${fromName})`);
      }

      await next();
    });

    this.bot.catch((err) => {
      console.error('[Telegram Bot Catch]', err.message || err);
    });

    this._registerCommands();
    this._registerMessageHandlers();

    return true;
  }

  async _safeReply(ctx, text) {
    const str = String(text || '');
    const maxLength = 3900;
    if (str.length <= maxLength) {
      await this._sendSingleChunk(ctx, str);
      return;
    }

    const chunks = [];
    let current = '';
    const lines = str.split('\n');
    for (const line of lines) {
      if ((current + '\n' + line).length > maxLength) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = current ? current + '\n' + line : line;
      }
    }
    if (current) chunks.push(current);

    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i];
      const openCount = (chunk.match(/<pre>/g) || []).length;
      const closeCount = (chunk.match(/<\/pre>/g) || []).length;
      if (openCount > closeCount) chunk += '</pre>';
      else if (closeCount > openCount) chunk = '<pre>' + chunk;
      await this._sendSingleChunk(ctx, chunk);
    }
  }

  async _sendSingleChunk(ctx, text) {
    try {
      await ctx.reply(text, { parse_mode: 'HTML' });
    } catch {
      try {
        await ctx.reply(text, { parse_mode: 'Markdown' });
      } catch {
        const plain = text
          .replace(/<pre>/gi, '```\n')
          .replace(/<\/pre>/gi, '\n```')
          .replace(/<[^>]+>/g, '');
        await ctx.reply(plain);
      }
    }
  }

  _registerCommands() {
    this.bot.command('start', async (ctx) => {
      const name = ctx.from?.first_name || 'Sebastián';
      await this._safeReply(
        ctx,
        `👋 ¡Hola <b>${name}</b>! Soy <b>Carmencita</b>, tu secretaria ejecutiva 24/7 (Deko Labs Standard).\n\n` +
        `Capacidades activas:\n` +
        `📑 <b>Bóveda Documental:</b> Envíame PDFs, contratos, cotizaciones o facturas y los clasificaré con OCR.\n` +
        `📊 <b>Hojas de Cálculo:</b> Pídeme tablas, presupuestos o listas y generaré archivos .xlsx reales.\n` +
        `💡 <b>Ideas & Tareas:</b> Guarda proyectos y pendientes en PostgreSQL con transacciones ACID.\n` +
        `⚡ <b>Terminal Autónoma:</b> Ejecuto diagnósticos de servidor sin comandos rígidos.\n\n` +
        `<b>Comandos:</b> /facturas, /documentos, /ideas, /tareas, /mi_id`
      );
    });

    this.bot.command('mi_id', async (ctx) => {
      await this._safeReply(ctx, `Tu Telegram ID es: <code>${ctx.from.id}</code>`);
    });

    this.bot.command('facturas', async (ctx) => {
      try {
        const list = await this.brain.documentService.listInvoices({ limit: 5 });
        if (list.length === 0) {
          return ctx.reply('📁 No tienes facturas registradas todavía.');
        }
        let msg = '📂 <b>Últimas facturas resguardadas (PostgreSQL):</b>\n\n';
        list.forEach((f, i) => {
          msg += `${i + 1}. <b>${f.item}</b> (${f.vendor})\n` +
            `   💰 ${f.currency} ${f.totalAmount} | 🛡️ ${f.warrantyMonths}m garantía\n` +
            `   📅 Fecha: ${f.purchaseDate ? new Date(f.purchaseDate).toISOString().slice(0, 10) : 'N/A'}\n\n`;
        });
        await this._safeReply(ctx, msg);
      } catch (err) {
        await ctx.reply(`Error consultando facturas: ${err.message}`);
      }
    });

    this.bot.command('documentos', async (ctx) => {
      try {
        const list = await this.brain.documentService.listDocuments({ limit: 5 });
        if (list.length === 0) {
          return ctx.reply('📑 La bóveda documental está vacía.');
        }
        let msg = '📑 <b>Últimos documentos en Bóveda:</b>\n\n';
        list.forEach((d, i) => {
          msg += `${i + 1}. <b>${d.originalName}</b> [${d.category}]\n` +
            `   ${d.summary || 'Sin resumen'}\n\n`;
        });
        await this._safeReply(ctx, msg);
      } catch (err) {
        await ctx.reply(`Error consultando documentos: ${err.message}`);
      }
    });

    this.bot.command('ideas', async (ctx) => {
      try {
        const list = await this.brain.ideaService.listIdeas({ limit: 5 });
        if (list.length === 0) {
          return ctx.reply('💡 No hay ideas registradas todavía.');
        }
        let msg = '💡 <b>Banco de ideas (PostgreSQL):</b>\n\n';
        list.forEach((idea, i) => {
          msg += `${i + 1}. <b>${idea.title}</b> [${idea.priority}]\n` +
            `   ${idea.summary}\n\n`;
        });
        await this._safeReply(ctx, msg);
      } catch (err) {
        await ctx.reply(`Error consultando ideas: ${err.message}`);
      }
    });

    this.bot.command('tareas', async (ctx) => {
      try {
        const list = await this.brain.taskService.listTasks({ onlyPending: true, limit: 10 });
        if (list.length === 0) {
          return ctx.reply('✅ No tienes tareas pendientes. ¡Todo al día!');
        }
        let msg = '📋 <b>Tareas pendientes (PostgreSQL):</b>\n\n';
        list.forEach((t, i) => {
          const due = t.dueDate ? ` (Vence: ${new Date(t.dueDate).toISOString().slice(0, 10)})` : '';
          msg += `${i + 1}. [ ] <b>${t.description}</b>${due} [${t.priority}]\n`;
        });
        await this._safeReply(ctx, msg);
      } catch (err) {
        await ctx.reply(`Error consultando tareas: ${err.message}`);
      }
    });
  }

  _registerMessageHandlers() {
    // 1. MENSAJES DE TEXTO
    this.bot.on('message:text', async (ctx) => {
      const senderId = ctx.from.id;
      const senderName = ctx.from.first_name || 'Sebastián';
      const text = ctx.message.text;

      console.log(`📩 [Telegram Texto] De ${senderName} (${senderId}): "${text}"`);
      await ctx.replyWithChatAction('typing');

      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction('typing').catch(() => {});
      }, 4000);

      try {
        const reply = await this.brain.processTextMessage({
          channel: 'telegram',
          senderId,
          senderName,
          text,
          onProgress: async (ackText) => {
            await this._safeReply(ctx, ackText);
            await ctx.replyWithChatAction('typing').catch(() => {});
          },
        });

        if (reply?.hasExcel && reply?.excelFile) {
          await ctx.replyWithDocument(new InputFile(reply.excelFile.buffer, reply.excelFile.fileName), {
            caption: reply.reply,
          });
        } else {
          await this._safeReply(ctx, reply?.reply || reply);
        }
      } finally {
        clearInterval(typingInterval);
      }
    });

    // 2. FOTOS (FACTURAS / RECIBOS)
    this.bot.on('message:photo', async (ctx) => {
      const senderId = ctx.from.id;
      const senderName = ctx.from.first_name || 'Sebastián';
      console.log(`📸 [Telegram Foto] Recibida de ${senderName} (${senderId})`);
      await ctx.replyWithChatAction('upload_photo');
      const caption = ctx.message.caption || '';

      const photos = ctx.message.photo;
      const bestPhoto = photos[photos.length - 1];
      const file = await ctx.api.getFile(bestPhoto.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;

      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());

      const reply = await this.brain.processImage({
        channel: 'telegram',
        senderId,
        senderName,
        buffer,
        mimeType: 'image/jpeg',
        caption,
      });

      await this._safeReply(ctx, reply);
    });

    // 3. DOCUMENTOS UNIVERSALES (PDF, EXCEL, CONTRATOS, COTIZACIONES)
    this.bot.on('message:document', async (ctx) => {
      const senderId = ctx.from.id;
      const senderName = ctx.from.first_name || 'Sebastián';
      const doc = ctx.message.document;
      const originalName = doc.file_name || 'documento.bin';
      const mimeType = doc.mime_type || 'application/octet-stream';
      const caption = ctx.message.caption || '';

      console.log(`📑 [Telegram Documento] De ${senderName}: ${originalName} (${mimeType})`);
      await ctx.replyWithChatAction('upload_document');

      try {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;

        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());

        const reply = await this.brain.processDocument({
          channel: 'telegram',
          senderId,
          senderName,
          buffer,
          mimeType,
          originalName,
          caption,
        });

        await this._safeReply(ctx, reply);
      } catch (err) {
        console.error('[Telegram Document Error]', err);
        await ctx.reply(`❌ Ocurrió un error al procesar el documento: ${err.message}`);
      }
    });

    // 4. NOTAS DE VOZ (AUDIO)
    this.bot.on(['message:voice', 'message:audio'], async (ctx) => {
      const senderId = ctx.from.id;
      const senderName = ctx.from.first_name || 'Sebastián';
      console.log(`🎙️ [Telegram Audio] Recibido de ${senderName} (${senderId})`);
      await ctx.replyWithChatAction('record_voice');

      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction('typing').catch(() => {});
      }, 4000);

      try {
        const audioObj = ctx.message.voice || ctx.message.audio;
        const file = await ctx.api.getFile(audioObj.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;

        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());

        const reply = await this.brain.processAudio({
          channel: 'telegram',
          senderId,
          senderName,
          buffer,
          mimeType: ctx.message.voice ? 'audio/ogg' : (audioObj.mime_type || 'audio/mp3'),
          onProgress: async (ackText) => {
            await this._safeReply(ctx, ackText);
            await ctx.replyWithChatAction('typing').catch(() => {});
          },
        });

        if (reply?.hasExcel && reply?.excelFile) {
          await ctx.replyWithDocument(new InputFile(reply.excelFile.buffer, reply.excelFile.fileName), {
            caption: reply.reply,
          });
        } else {
          await this._safeReply(ctx, reply?.reply || reply);
        }
      } finally {
        clearInterval(typingInterval);
      }
    });
  }

  async start() {
    if (!this.bot) return;
    try {
      this.isRunning = true;
      console.log('🤖 [Telegram] Iniciando bot con Long Polling...');
      this.bot.start({
        drop_pending_updates: false,
        onStart: (botInfo) => {
          console.log(`✅ [Telegram] Conectado exitosamente como @${botInfo.username}`);
        },
      }).catch((err) => {
        console.error('[Telegram Polling Loop Error]', err.message);
      });
    } catch (err) {
      console.error('[Telegram] Error al iniciar bot:', err);
    }
  }

  async stop() {
    if (this.bot && this.isRunning) {
      await this.bot.stop();
      this.isRunning = false;
    }
  }

  async sendMessage(chatId, text) {
    if (!this.bot) return false;
    await this._safeReply({ reply: (msg, opts) => this.bot.api.sendMessage(chatId, msg, opts) }, text);
    return true;
  }
}

import { prisma } from '../core/prisma.js';
import { config } from '../config.js';
import { defaultObsidianDriveService } from '../services/obsidian-drive.service.js';
import { defaultEmbeddingService } from '../services/embedding.service.js';

export function registerRoutes(fastify, { brain, documentService, taskService, ideaService, calendarService, contactService, telegramAdapter, whatsappAdapter }) {
  // --- MIDDLEWARE GLOBAL DE SEGURIDAD PARA RUTAS /api/* ---
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      const authHeader = request.headers.authorization;
      const apiKeyHeader = request.headers['x-api-key'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : apiKeyHeader;
      const expectedKey = config.apiKey || process.env.CARMENCITA_API_KEY;
      const isProd = process.env.NODE_ENV === 'production';

      if (isProd || expectedKey) {
        if (!token || !expectedKey || token !== expectedKey) {
          return reply.code(401).send({
            error: 'Acceso no autorizado. Se requiere cabecera Authorization: Bearer <CARMENCITA_API_KEY> o x-api-key válida.',
          });
        }
      }
    }
  });

  // 1. Health Check (Público para probes / Dokploy)
  fastify.get('/health', async () => {
    let dbStatus = 'disconnected';
    try {
      if (prisma?.$queryRaw) {
        await prisma.$queryRaw`SELECT 1`;
        dbStatus = 'connected';
      }
    } catch {
      dbStatus = 'offline';
    }

    return {
      status: 'ok',
      service: 'carmencita-secretary-hub',
      standard: 'Deko Labs Enterprise',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      channels: {
        telegram: telegramAdapter?.isRunning ? 'active' : 'idle',
        whatsapp: whatsappAdapter?.instance ? 'configured' : 'disabled',
      },
    };
  });

  // 2. Webhook para Evolution API (WhatsApp) con validación de secreto
  fastify.post('/webhooks/whatsapp', async (request, reply) => {
    // Verificación de autenticidad del webhook
    if (config.whatsapp.apiKey) {
      const receivedKey = request.headers['apikey'] || request.headers['x-api-key'] || request.headers['x-webhook-secret'];
      if (!receivedKey || receivedKey !== config.whatsapp.apiKey) {
        return reply.code(401).send({ error: 'Acceso no autorizado: Webhook secret inválido o ausente.' });
      }
    }

    try {
      const result = await whatsappAdapter.handleWebhook(request.body);
      return reply.code(200).send(result);
    } catch (err) {
      request.log.error({ err }, 'Error procesando webhook de WhatsApp');
      return reply.code(500).send({ error: err.message });
    }
  });

  // 3. Bóveda Documental y Facturas
  fastify.get('/api/facturas', async (request) => {
    const limit = parseInt(request.query.limit || '10', 10);
    const vendor = request.query.vendor || null;
    const docSvc = documentService || brain?.documentService;
    return await docSvc.listInvoices({ limit, vendor });
  });

  fastify.get('/api/documents', async (request) => {
    const limit = parseInt(request.query.limit || '20', 10);
    const category = request.query.category || null;
    const query = request.query.q || request.query.query || null;
    const docSvc = documentService || brain?.documentService;
    if (query && typeof docSvc.searchDocumentsSemantic === 'function') {
      return await docSvc.searchDocumentsSemantic({ query, category, limit });
    }
    return await docSvc.listDocuments({ limit, category });
  });

  // 4. Banco de Ideas
  fastify.get('/api/ideas', async (request) => {
    const limit = parseInt(request.query.limit || '10', 10);
    const priority = request.query.priority || null;
    const tag = request.query.tag || null;
    const idSvc = ideaService || brain?.ideaService;
    return await idSvc.listIdeas({ limit, priority, tag });
  });

  // 5. Tareas y Agenda
  fastify.get('/api/tasks', async (request) => {
    const onlyPending = request.query.pending !== 'false';
    const tSvc = taskService || brain?.taskService;
    return await tSvc.listTasks({ onlyPending });
  });

  // 6. Directorio de Contactos
  fastify.get('/api/contacts', async (request) => {
    const q = request.query.q || request.query.query || null;
    const limit = parseInt(request.query.limit || '20', 10);
    const cntSvc = contactService || brain?.contactService;
    if (!cntSvc) return [];
    if (q) {
      return await cntSvc.searchContacts({ query: q, limit });
    }
    return await cntSvc.listContacts({ limit });
  });

  // 7. Agenda de Google Calendar (Eventos de Hoy)
  fastify.get('/api/calendar/today', async () => {
    const calSvc = calendarService || brain?.calendarService;
    if (!calSvc?.getTodayEvents) return [];
    return await calSvc.getTodayEvents();
  });

  // 8. Envío manual / API de despacho omnicanal
  fastify.post('/api/send', async (request, reply) => {
    const { channel, recipient, text } = request.body || {};
    if (!channel || !recipient || !text) {
      return reply.code(400).send({ error: 'Campos requeridos: channel, recipient, text' });
    }

    if (channel === 'telegram') {
      const sent = await telegramAdapter.sendMessage(recipient, text);
      return { success: sent, channel: 'telegram' };
    }

    if (channel === 'whatsapp') {
      const sent = await whatsappAdapter.sendMessage(recipient, text);
      return { success: sent, channel: 'whatsapp' };
    }

    return reply.code(400).send({ error: 'Canal no soportado. Usa telegram o whatsapp' });
  });

  // 9. Sincronización RAG masiva e idempotente de Obsidian Vault
  fastify.post('/api/obsidian/sync-rag', async (request, reply) => {
    const obsSvc = brain?.obsidianService || defaultObsidianDriveService;
    const embSvc = brain?.embeddingService || defaultEmbeddingService;

    if (!obsSvc) {
      return reply.status(503).send({ error: 'ObsidianDriveService no disponible' });
    }

    const force = Boolean(request.body?.force);
    const result = await obsSvc.syncVaultToVector({ embeddingService: embSvc, force });
    return {
      success: true,
      message: 'Sincronización de Obsidian Vault a SemanticMemory completada exitosamente.',
      data: result,
    };
  });
}

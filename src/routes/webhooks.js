import { prisma } from '../core/prisma.js';

export function registerRoutes(fastify, { brain, documentService, taskService, ideaService, telegramAdapter, whatsappAdapter }) {
  // 1. Health Check
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

  // 2. Webhook para Evolution API (WhatsApp)
  fastify.post('/webhooks/whatsapp', async (request, reply) => {
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
    const docSvc = documentService || brain?.documentService;
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

  // 6. Envío manual / API de despacho omnicanal
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
}

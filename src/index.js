import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { prisma } from './core/prisma.js';
import { defaultStorageProvider } from './services/storage.provider.js';
import { documentService } from './services/document.service.js';
import { taskService } from './services/task.service.js';
import { ideaService } from './services/idea.service.js';
import { excelService } from './services/excel.service.js';
import { AgyBridge } from './core/agy-bridge.js';
import { CarmencitaBrain } from './core/brain.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';
import { registerRoutes } from './routes/webhooks.js';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

async function main() {
  console.log('🚀 Iniciando Carmencita Secretary Hub (Deko Labs Standard)...');

  // 1. Conexión a Base de Datos Relacional PostgreSQL (Cold Start Prevention)
  try {
    await prisma.$connect();
    console.log('✅ [Database] Conexión establecida con PostgreSQL.');
  } catch (err) {
    console.warn('⚠️ [Database] Conexión diferida a PostgreSQL:', err.message);
  }

  // 2. Inicializar Almacenamiento Físico
  await defaultStorageProvider.init();
  fastify.log.info(`[Storage] Bóveda y volúmenes inicializados en: ${defaultStorageProvider.baseDir}`);

  // 2. Inicializar Puente de Terminal y Cerebro Carmencita
  const agyBridge = new AgyBridge();
  const brain = new CarmencitaBrain(
    {
      prisma,
      documentService,
      taskService,
      ideaService,
      excelService,
    },
    agyBridge
  );
  fastify.log.info(`[Brain] Motor de razonamiento multimodal activo (Modelo: ${config.ai.modelName})`);

  // 3. Inicializar Adaptadores Omnicanal
  const telegramAdapter = new TelegramAdapter(brain, defaultStorageProvider);
  const whatsappAdapter = new WhatsAppAdapter(brain, defaultStorageProvider);

  // 4. Registrar Plugins de Fastify
  await fastify.register(cors, { origin: true });
  await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max para documentos

  // 5. Registrar Rutas HTTP
  registerRoutes(fastify, {
    brain,
    documentService,
    taskService,
    ideaService,
    telegramAdapter,
    whatsappAdapter,
  });

  // 6. Arrancar Servidor HTTP
  try {
    await fastify.listen({ port: config.port, host: config.host });
    console.log(`🌐 [HTTP] Hub escuchando en http://${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // 7. Arrancar Bot de Telegram (si hay token configurado)
  if (telegramAdapter.init()) {
    await telegramAdapter.start();
  }

  // 8. Apagado Limpio y Transaccional (Graceful Shutdown)
  const shutdown = async (signal) => {
    console.log(`\n🛑 Recibida señal ${signal}. Apagando Carmencita Hub limpiamente...`);
    await telegramAdapter.stop();
    await fastify.close();
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

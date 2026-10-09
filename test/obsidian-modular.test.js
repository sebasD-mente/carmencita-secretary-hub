import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MarkdownSerializer, normalizeNoteTitle, matchesSearchTerm, _chunkMarkdown, serializeMarkdownNote, sanitizeFileName } from '../src/services/obsidian/markdown-serializer.js';
import { DriveVaultClient } from '../src/services/obsidian/drive-vault.client.js';
import { ObsidianDriveService, defaultObsidianDriveService } from '../src/services/obsidian-drive.service.js';
import { UserSessionQueue } from '../src/adapters/session-queue.js';
import { DiagnosticsService } from '../src/services/diagnostics.service.js';
import { GeminiPoolService } from '../src/services/gemini-pool.service.js';
import { registerRoutes } from '../src/routes/webhooks.js';
import { verifyProd } from '../scripts/verify-prod.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('MarkdownSerializer: Normalización y parseo de títulos y búsquedas', () => {
  const serializer = new MarkdownSerializer();

  // 1. Normalización de títulos (diacríticos, em-dash, guiones, extensión .md)
  assert.equal(normalizeNoteTitle('STAND IA — Visión General.md'), 'stand-ia-vision-general');
  assert.equal(serializer.normalizeTitle('Deco Vintage – Tienda de Cuadros.md'), 'deco-vintage-tienda-de-cuadros');
  assert.equal(normalizeNoteTitle('   ---Mi_Nota   Especial---   '), 'mi-nota-especial');
  assert.equal(normalizeNoteTitle(null), '');

  // 2. matchesSearchTerm (palabras cortas con límites de palabra y búsqueda normal insensible a acentos)
  assert.equal(matchesSearchTerm('IA y Tecnología en Stands', 'ia'), true);
  assert.equal(matchesSearchTerm('Hacer inventario de cuadros', 'ia'), false);
  assert.equal(matchesSearchTerm('STAND IA — Visión General', 'vision'), true);
  assert.equal(matchesSearchTerm('Nota general', ''), false);

  // 3. sanitizeFileName
  assert.equal(sanitizeFileName('Proyecto / Secreto * 2026?'), 'Proyecto - Secreto - 2026-.md');
  assert.equal(sanitizeFileName('Nota.md'), 'Nota.md');
});

test('MarkdownSerializer: Segmentación (_chunkMarkdown) y Serialización Frontmatter', () => {
  const serializer = new MarkdownSerializer();

  // 1. Chunking respetando párrafos
  const markdownText = `Párrafo 1 con información relevante sobre arquitectura y diseño de sistemas modulares en Carmencita Hub.

Párrafo 2 con detalles técnicos acerca del protocolo zero-trust y aislamiento estricto entre proyectos.

Párrafo 3 con directivas cardinales de Deko Labs Enterprise.`;

  const chunks = serializer.chunkMarkdown(markdownText, 120);
  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length >= 2, 'Debe segmentar en múltiples chunks según maxChunkLength');
  assert.ok(chunks[0].includes('Párrafo 1'));

  // 2. Serialización con Frontmatter YAML y Wikilinks
  const serialized = serializeMarkdownNote({
    title: 'Arquitectura Hexagonal',
    content: 'Detalles del desacople del monolito de Obsidian.',
    folder: '02_Projects',
    tags: ['#arquitectura', 'deko'],
    wikilinks: ['[[STAND IA]]', 'Deco Vintage'],
  });

  assert.ok(serialized.includes('title: "Arquitectura Hexagonal"'));
  assert.ok(serialized.includes('folder: "02_Projects"'));
  assert.ok(serialized.includes('- arquitectura'));
  assert.ok(serialized.includes('- deko'));
  assert.ok(serialized.includes('[[STAND IA]]'));
  assert.ok(serialized.includes('[[Deco Vintage]]'));
  assert.ok(serialized.includes('# Arquitectura Hexagonal'));
});

test('DriveVaultClient: Jerarquía, listado, búsqueda y manejo de archivos', async () => {
  const mockFiles = [
    { id: 'f1', name: 'STAND IA — General.md', mimeType: 'text/markdown', modifiedTime: '2026-10-08T10:00:00Z', webViewLink: 'https://drive/f1' },
    { id: 'f2', name: 'Deco Vintage Tienda.md', mimeType: 'text/markdown', modifiedTime: '2026-10-07T10:00:00Z', webViewLink: 'https://drive/f2' },
  ];

  let createdPayload = null;
  let updatedPayload = null;

  const mockDrive = {
    files: {
      list: async ({ q }) => {
        if (q?.includes('mimeType = \'application/vnd.google-apps.folder\'')) {
          return { data: { files: [{ id: 'mock_root_folder_id', name: 'vault' }] } };
        }
        return { data: { files: mockFiles } };
      },
      get: async ({ fileId }) => ({ data: `# Nota ${fileId}\nContenido simulado.` }),
      create: async (payload) => {
        createdPayload = payload;
        return { data: { id: 'new_file_id', name: payload.requestBody?.name, webViewLink: 'https://drive/new' } };
      },
      update: async (payload) => {
        updatedPayload = payload;
        return { data: { id: payload.fileId, name: 'NotaActualizada.md', webViewLink: 'https://drive/upd' } };
      },
      delete: async ({ fileId }) => ({ data: { success: true, deleted: fileId } }),
    },
  };

  const client = new DriveVaultClient({ driveClient: mockDrive, vaultFolderName: 'vault' });

  // 1. Obtener carpeta raíz
  const rootId = await client.getOrCreateVaultFolder();
  assert.equal(rootId, 'mock_root_folder_id');

  // 2. Listar todas las notas
  const notes = await client.listAllNotes();
  assert.equal(notes.length, 2);
  assert.equal(notes[0].cleanTitle, 'STAND IA — General');

  // 3. Buscar notas por término
  const searchResults = await client.searchNotes({ query: 'STAND' });
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, 'f1');

  // 4. Lectura de nota
  const readRes = await client.readNote({ fileId: 'f1' });
  assert.ok(readRes.content.includes('# Nota f1'));

  // 5. Creación de nota vía saveFile
  const saveCreate = await client.saveFile({ name: 'NuevaNota.md', folderId: rootId, content: 'Texto nuevo' });
  assert.equal(saveCreate.fileId, 'new_file_id');
  assert.equal(createdPayload.requestBody.name, 'NuevaNota.md');

  // 6. Actualización vía saveFile
  const saveUpdate = await client.saveFile({ fileId: 'f1', content: 'Texto actualizado' });
  assert.equal(saveUpdate.fileId, 'f1');
  assert.equal(updatedPayload.fileId, 'f1');

  // 7. Borrado de nota
  const deleted = await client.deleteFile('f1');
  assert.equal(deleted, true);
});

test('ObsidianDriveService: Fachada compacta con delegación y compatibilidad', async () => {
  let savedFiles = {};
  const mockDrive = {
    files: {
      list: async ({ q } = {}) => {
        if (q?.includes('mimeType = \'application/vnd.google-apps.folder\'')) {
          return { data: { files: [{ id: 'vault_root', name: 'vault' }] } };
        }
        return {
          data: {
            files: [
              { id: 'n1', name: 'Directiva Deko.md', mimeType: 'text/markdown', modifiedTime: '2026-10-08T12:00:00Z' },
            ],
          },
        };
      },
      get: async ({ fileId }) => ({ data: savedFiles[fileId] || '# Directiva Deko\nContenido base.' }),
      create: async ({ requestBody, media }) => {
        const id = `file_${Date.now()}`;
        savedFiles[id] = media.body;
        return { data: { id, name: requestBody.name, webViewLink: `https://drive/${id}` } };
      },
      update: async ({ fileId, media }) => {
        savedFiles[fileId] = media.body;
        return { data: { id: fileId, name: 'Directiva Deko.md', webViewLink: `https://drive/${fileId}` } };
      },
    },
  };

  const service = new ObsidianDriveService({ driveClient: mockDrive });

  // 1. Verificación de delegaciones y getters
  assert.ok(service.vaultClient instanceof DriveVaultClient);
  assert.ok(service.serializer instanceof MarkdownSerializer);
  assert.equal(service.driveClient, mockDrive);

  // 2. Creación de nota
  const created = await service.createNote({
    title: 'Manual de Procedimientos',
    content: 'Procedimientos operativos estándar.',
    folder: '01_Inbox',
  });
  assert.ok(created.fileId);
  assert.equal(created.fileName, 'Manual de Procedimientos.md');

  // 3. Lectura de nota
  const read = await service.readNote({ fileId: created.fileId });
  assert.ok(read.content.includes('Procedimientos operativos estándar.'));

  // 4. Anexo a nota
  const appended = await service.appendToNote({
    fileId: created.fileId,
    contentToAppend: '## Anexo 1: Criterios de Aceptación',
  });
  assert.ok(appended.content.includes('Criterios de Aceptación'));

  // 5. Búsqueda difusa
  const found = await service.findNoteFuzzy({ title: 'Directiva Deko' });
  assert.ok(found);
  assert.equal(found.id, 'n1');

  // 6. Verificación de chunking backward-compatible
  const longText = 'Primer párrafo con suficiente texto explicativo.\n\nSegundo párrafo con detalles adicionales del sistema modular.';
  const chunks = service._chunkMarkdown(longText, 40);
  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length >= 2);
});

test('UserSessionQueue: Telemetría SRE y contadores de ciclo de vida', async () => {
  const queue = new UserSessionQueue();

  // 1. Estado inicial
  const initMetrics = queue.getMetrics();
  assert.equal(initMetrics.activeTasks, 0);
  assert.equal(initMetrics.activeUsers, 0);
  assert.equal(initMetrics.totalEnqueued, 0);
  assert.equal(initMetrics.totalCompleted, 0);
  assert.equal(initMetrics.totalRejected, 0);

  // 2. Ejecución exitosa
  const resSuccess = await queue.enqueue('user_100', async () => {
    return 'exito_sre';
  });
  assert.equal(resSuccess, 'exito_sre');

  // 3. Ejecución fallida con captura
  await assert.rejects(
    async () => {
      await queue.enqueue('user_100', async () => {
        throw new Error('Fallo simulado en tarea de usuario');
      });
    },
    /Fallo simulado en tarea de usuario/
  );

  // 4. Verificación de métricas acumuladas
  const afterMetrics = queue.getMetrics();
  assert.equal(afterMetrics.totalEnqueued, 2);
  assert.equal(afterMetrics.totalCompleted, 1);
  assert.equal(afterMetrics.totalRejected, 1);
  assert.equal(afterMetrics.activeTasks, 0);
  assert.equal(afterMetrics.activeUsers, 0);
});

test('DiagnosticsService & /api/metrics: Exposición de telemetría completa', async () => {
  const mockPrisma = {
    $queryRaw: async () => [{ '?column?': 1 }],
    $queryRawUnsafe: async (sql) => {
      if (sql.includes('pg_extension')) return [{ extname: 'vector', extversion: '0.8.0' }];
      if (sql.includes('vector')) return [{ dist: 0 }];
      return [{ ok: 1 }];
    },
  };

  const pool = new GeminiPoolService({
    apiKeys: ['key_sre_1', 'key_sre_2'],
    clientFactory: () => ({}),
  });

  const sessionQueue = new UserSessionQueue();
  await sessionQueue.enqueue('u_telemetry', () => 'ok');

  const diagnostics = new DiagnosticsService({
    prisma: mockPrisma,
    geminiPool: pool,
    sessionQueue,
  });

  // 1. collectMetrics
  const metrics = await diagnostics.collectMetrics({
    telegramAdapter: { isRunning: true },
    whatsappAdapter: { instance: 'inst_carmencita' },
  });

  assert.equal(metrics.status, 'HEALTHY');
  assert.ok(metrics.process.uptimeSeconds >= 0);
  assert.ok(metrics.process.memoryUsage.heapUsedMb > 0);
  assert.equal(metrics.geminiPool.totalKeys, 2);
  assert.equal(metrics.geminiPool.healthy, true);
  assert.equal(metrics.sessionQueue.totalCompleted, 1);
  assert.equal(metrics.connections.database.status, 'CONNECTED');
  assert.equal(metrics.connections.database.pgvector, true);
  assert.equal(metrics.connections.telegram.status, 'active');
  assert.equal(metrics.connections.whatsapp.status, 'configured');

  // 2. Verificación de ruta HTTP Fastify /api/metrics
  const app = Fastify();
  registerRoutes(app, {
    brain: {},
    documentService: {},
    taskService: {},
    ideaService: {},
    telegramAdapter: { isRunning: true },
    whatsappAdapter: { instance: true },
    diagnosticsService: diagnostics,
  });

  const response = await app.inject({
    method: 'GET',
    url: '/api/metrics',
  });

  assert.equal(response.statusCode, 200);
  const json = response.json();
  assert.equal(json.status, 'HEALTHY');
  assert.equal(json.geminiPool.totalKeys, 2);
  assert.equal(json.connections.telegram.status, 'active');

  await app.close();
});

test('scripts/verify-prod.js: Certificación mecánica post-deploy con reporte inmutable', async () => {
  // 1. Crear servidor Fastify temporal para simular endpoints /health y /api/metrics
  const testApp = Fastify();
  const mockPrisma = {
    $queryRawUnsafe: async (sql) => {
      if (sql.includes('pg_extension')) return [{ extname: 'vector', extversion: '0.8.0' }];
      if (sql.includes('vector')) return [{ dist: 0 }];
      return [{ 1: 1 }];
    },
  };

  const diagnostics = new DiagnosticsService({
    prisma: mockPrisma,
    geminiPool: new GeminiPoolService({ apiKeys: ['test_k'], clientFactory: () => ({}) }),
    sessionQueue: new UserSessionQueue(),
  });

  registerRoutes(testApp, {
    brain: {},
    documentService: {},
    taskService: {},
    ideaService: {},
    telegramAdapter: { isRunning: true },
    whatsappAdapter: { instance: true },
    diagnosticsService: diagnostics,
  });

  await testApp.listen({ port: 0, host: '127.0.0.1' });
  const testAddress = testApp.server.address();
  const testBaseUrl = `http://127.0.0.1:${testAddress.port}`;

  const tempReportsDir = path.join(rootDir, 'reports', 'test-run');

  // Ejecutar verifyProd contra el servidor temporal y mocks
  const verification = await verifyProd({
    baseUrl: testBaseUrl,
    prisma: mockPrisma,
    checkFfmpeg: async () => ({ status: 'PASS', libopus: true, testBytes: 1024 }),
    reportsDir: tempReportsDir,
    exitOnFinish: false,
  });

  assert.ok(verification);
  assert.equal(verification.checks.health.status, 'PASS');
  assert.equal(verification.checks.metrics.status, 'PASS');
  assert.equal(verification.checks.databasePgvector.status, 'PASS');
  assert.equal(verification.checks.databasePgvector.pgvector, true);
  assert.equal(verification.checks.ffmpeg.status, 'PASS');
  assert.equal(verification.allPassed, true);

  // Verificar que el reporte JSON inmutable se generó en disco
  const latestReport = path.join(tempReportsDir, 'latest-certification.json');
  assert.ok(fs.existsSync(latestReport), 'latest-certification.json debe existir');
  const reportData = JSON.parse(fs.readFileSync(latestReport, 'utf-8'));
  assert.equal(reportData.checks.health.status, 'PASS');
  assert.equal(reportData.checks.metrics.status, 'PASS');

  // Limpieza de directorio de test
  try {
    fs.rmSync(tempReportsDir, { recursive: true, force: true });
  } catch {}

  await testApp.close();
});

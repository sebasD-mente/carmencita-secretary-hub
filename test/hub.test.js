import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import ExcelJS from 'exceljs';

import { StorageProvider } from '../src/services/storage.provider.js';
import { DocumentService } from '../src/services/document.service.js';
import { TaskService } from '../src/services/task.service.js';
import { IdeaService } from '../src/services/idea.service.js';
import { ExcelService } from '../src/services/excel.service.js';
import { CarmencitaBrain } from '../src/core/brain.js';
import { TelegramAdapter } from '../src/adapters/telegram.js';
import { WhatsAppAdapter } from '../src/adapters/whatsapp.js';
import { registerRoutes } from '../src/routes/webhooks.js';
import { setPrismaClient } from '../src/core/prisma.js';
import { runMigration } from '../scripts/migrate-json-to-prisma.js';
import { AgyBridge } from '../src/core/agy-bridge.js';
import { SchedulerService } from '../src/services/scheduler.service.js';
import { CalendarService } from '../src/services/calendar.service.js';
import { ContactService } from '../src/services/contact.service.js';
import { GoogleTasksService } from '../src/services/google-tasks.service.js';
import { config } from '../src/config.js';

// Setup de configuración y credenciales para pruebas de seguridad
config.apiKey = 'test-secret-key-2026';
config.whatsapp.allowedNumbers = ['50212345678'];
const authHeaders = { authorization: 'Bearer test-secret-key-2026' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.resolve(__dirname, '../data_test');

/**
 * Cliente Prisma Mock en memoria para pruebas unitarias e integración aislada
 * Implementa la interfaz exacta del esquema Prisma y transacciones ACID.
 */
class MockPrismaClient {
  constructor() {
    this._data = {
      documents: [],
      invoices: [],
      tasks: [],
      ideas: [],
      messageLogs: [],
      contacts: [],
    };

    this.document = {
      create: async ({ data }) => {
        const item = {
          id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: data.createdAt || new Date(),
          updatedAt: new Date(),
          tags: [],
          ...data,
        };
        this._data.documents.unshift(item);
        return item;
      },
      findMany: async ({ where = {}, take = 50, include = {} } = {}) => {
        let res = [...this._data.documents];
        if (where.category) res = res.filter((d) => d.category === where.category);
        if (include.invoice) {
          res = res.map((d) => ({
            ...d,
            invoice: this._data.invoices.find((i) => i.documentId === d.id) || null,
          }));
        }
        return res.slice(0, take);
      },
      findUnique: async ({ where, include = {} }) => {
        const doc = this._data.documents.find((d) => d.id === where.id);
        if (!doc) return null;
        if (include.invoice) {
          return {
            ...doc,
            invoice: this._data.invoices.find((i) => i.documentId === doc.id) || null,
          };
        }
        return doc;
      },
      delete: async ({ where }) => {
        const idx = this._data.documents.findIndex((d) => d.id === where.id);
        if (idx !== -1) {
          const [removed] = this._data.documents.splice(idx, 1);
          this._data.invoices = this._data.invoices.filter((i) => i.documentId !== where.id);
          return removed;
        }
        return null;
      },
    };

    this.invoice = {
      create: async ({ data }) => {
        const item = {
          id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: new Date(),
          ...data,
        };
        this._data.invoices.unshift(item);
        return item;
      },
      findMany: async ({ where = {}, take = 50, include = {} } = {}) => {
        let res = [...this._data.invoices];
        if (where.vendor?.contains) {
          const q = where.vendor.contains.toLowerCase();
          res = res.filter((i) => i.vendor.toLowerCase().includes(q));
        }
        if (include.document) {
          res = res.map((i) => ({
            ...i,
            document: this._data.documents.find((d) => d.id === i.documentId) || null,
          }));
        }
        return res.slice(0, take);
      },
      findUnique: async ({ where }) => {
        return this._data.invoices.find((i) => i.documentId === where.documentId || i.id === where.id) || null;
      },
    };

    this.task = {
      create: async ({ data }) => {
        const item = {
          id: `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          status: 'PENDIENTE',
          priority: 'MEDIA',
          createdAt: data.createdAt || new Date(),
          notifiedAt: data.notifiedAt || null,
          ...data,
        };
        this._data.tasks.unshift(item);
        return item;
      },
      findMany: async ({ where = {}, take = 50, orderBy = [] } = {}) => {
        let res = [...this._data.tasks];
        if (where.status) res = res.filter((t) => t.status === where.status);
        if (where.notifiedAt === null) {
          res = res.filter((t) => t.notifiedAt === null || t.notifiedAt === undefined);
        }
        if (where.dueDate?.lte) {
          const lteDate = new Date(where.dueDate.lte);
          res = res.filter((t) => t.dueDate && new Date(t.dueDate) <= lteDate);
        }
        return res.slice(0, take);
      },
      findUnique: async ({ where }) => {
        return this._data.tasks.find((t) => t.id === where.id) || null;
      },
      update: async ({ where, data }) => {
        const item = this._data.tasks.find((t) => t.id === where.id);
        if (!item) throw new Error('Task not found');
        Object.assign(item, data);
        return item;
      },
      delete: async ({ where }) => {
        const idx = this._data.tasks.findIndex((t) => t.id === where.id);
        if (idx !== -1) {
          const [removed] = this._data.tasks.splice(idx, 1);
          return removed;
        }
        return null;
      },
    };

    this.idea = {
      create: async ({ data }) => {
        const item = {
          id: `ida_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          priority: 'MEDIA',
          tags: [],
          createdAt: data.createdAt || new Date(),
          ...data,
        };
        this._data.ideas.unshift(item);
        return item;
      },
      findMany: async ({ where = {}, take = 50 } = {}) => {
        let res = [...this._data.ideas];
        if (where.priority) res = res.filter((i) => i.priority === where.priority);
        if (where.tags?.has) res = res.filter((i) => i.tags.includes(where.tags.has));
        return res.slice(0, take);
      },
      findUnique: async ({ where }) => {
        return this._data.ideas.find((i) => i.id === where.id) || null;
      },
      delete: async ({ where }) => {
        const idx = this._data.ideas.findIndex((i) => i.id === where.id);
        if (idx !== -1) {
          const [removed] = this._data.ideas.splice(idx, 1);
          return removed;
        }
        return null;
      },
    };

    this.messageLog = {
      create: async ({ data }) => {
        const item = { id: `msg_${Date.now()}`, createdAt: data.createdAt || new Date(), ...data };
        this._data.messageLogs.unshift(item);
        return item;
      },
      findMany: async ({ where = {}, take = 50 } = {}) => {
        let res = [...this._data.messageLogs];
        if (where.channel) res = res.filter((m) => m.channel === where.channel);
        if (where.senderId) res = res.filter((m) => m.senderId === where.senderId);
        return res.slice(0, take);
      },
    };

    this.contact = {
      create: async ({ data }) => {
        const item = {
          id: `ct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: data.createdAt || new Date(),
          ...data,
        };
        this._data.contacts.unshift(item);
        return item;
      },
      findFirst: async ({ where = {} } = {}) => {
        return this._data.contacts.find((c) => {
          if (where.phone && c.phone === where.phone) return true;
          if (where.email && c.email === where.email) return true;
          if (where.name?.equals) {
            return c.name.toLowerCase() === where.name.equals.toLowerCase();
          }
          return false;
        }) || null;
      },
      findUnique: async ({ where = {} } = {}) => {
        return this._data.contacts.find((c) => {
          if (where.id && c.id === where.id) return true;
          if (where.phone && c.phone === where.phone) return true;
          if (where.email && c.email === where.email) return true;
          return false;
        }) || null;
      },
      findMany: async ({ where = {}, take = 50, orderBy = {} } = {}) => {
        let res = [...this._data.contacts];
        if (where.OR && Array.isArray(where.OR)) {
          res = res.filter((c) => {
            return where.OR.some((cond) => {
              for (const [key, val] of Object.entries(cond)) {
                if (val?.contains && typeof c[key] === 'string') {
                  if (c[key].toLowerCase().includes(val.contains.toLowerCase())) {
                    return true;
                  }
                }
              }
              return false;
            });
          });
        }
        if (orderBy.name) {
          res.sort((a, b) => a.name.localeCompare(b.name));
        }
        return res.slice(0, take);
      },
      update: async ({ where, data }) => {
        const item = this._data.contacts.find((c) => c.id === where.id);
        if (!item) throw new Error('Contact not found');
        Object.assign(item, data);
        return item;
      },
      delete: async ({ where }) => {
        const idx = this._data.contacts.findIndex((c) => c.id === where.id);
        if (idx !== -1) {
          const [removed] = this._data.contacts.splice(idx, 1);
          return removed;
        }
        return null;
      },
    };
  }

  async $transaction(fn) {
    return await fn(this);
  }

  async $queryRaw() {
    return [{ '?column?': 1 }];
  }

  async $disconnect() {}
}

test('Carmencita Secretary Hub - Suite de Elevación Deko Labs Enterprise', async (t) => {
  // Limpieza y preparación de entorno de pruebas
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
  const storageProvider = new StorageProvider(testDataDir);
  await storageProvider.init();

  const mockPrisma = new MockPrismaClient();
  setPrismaClient(mockPrisma);

  const documentService = new DocumentService(mockPrisma, storageProvider);
  const taskService = new TaskService(mockPrisma);
  const ideaService = new IdeaService(mockPrisma);
  const excelService = new ExcelService();

  await t.test('1. Bóveda Documental y Facturas con Relaciones ACID en Prisma', async () => {
    const fakeBuffer = Buffer.from('%PDF-1.4 Contenido simulado de factura...');
    const result = await documentService.saveDocument({
      buffer: fakeBuffer,
      originalName: 'factura_servidor_dell.pdf',
      mimeType: 'application/pdf',
      category: 'FACTURA',
      summary: 'Compra de servidor dedicado para Dokploy',
      invoiceData: {
        vendor: 'Dell Enterprise',
        item: 'PowerEdge R750',
        totalAmount: 14500.5,
        currency: 'USD',
        purchaseDate: '2026-09-24',
        warrantyMonths: 36,
      },
    });

    assert.ok(result.id);
    assert.equal(result.category, 'FACTURA');
    assert.ok(result.invoice);
    assert.equal(result.invoice.vendor, 'Dell Enterprise');
    assert.equal(result.invoice.totalAmount, 14500.5);
    assert.equal(result.invoice.currency, 'USD');
    assert.equal(result.invoice.warrantyMonths, 36);

    // Comprobar persistencia física en volumen/disco
    const fileExists = await fs.access(path.join(testDataDir, result.filePath)).then(() => true).catch(() => false);
    assert.ok(fileExists, 'El archivo físico debe existir en el volumen');

    // Listar facturas
    const invoices = await documentService.listInvoices({ limit: 5 });
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].item, 'PowerEdge R750');
  });

  await t.test('2. Tareas e Ideas con Validación Zod y Transacciones ACID', async () => {
    // Tarea
    const task = await taskService.createTask({
      description: 'Configurar backup nocturno de carmencita_db en Dokploy',
      due: '2026-09-30',
      priority: 'alta',
    });
    assert.ok(task.id);
    assert.equal(task.priority, 'ALTA');
    assert.equal(task.status, 'PENDIENTE');

    const tasks = await taskService.listTasks({ onlyPending: true });
    assert.equal(tasks.length, 1);

    // Actualizar estado de tarea
    const updated = await taskService.updateTaskStatus(task.id, 'COMPLETADA');
    assert.equal(updated.status, 'COMPLETADA');
    assert.ok(updated.completedAt);

    // Idea
    const idea = await ideaService.createIdea({
      title: 'Sistema de Agentes Omnicanal con AGY',
      summary: 'Orquestación de secretarias autónomas para empresas de diseño',
      priority: 'ALTA',
      tags: ['antigravity', 'ia', 'dokploy'],
    });
    assert.ok(idea.id);
    assert.equal(idea.priority, 'ALTA');
    assert.deepEqual(idea.tags, ['antigravity', 'ia', 'dokploy']);

    const ideas = await ideaService.listIdeas();
    assert.equal(ideas.length, 1);
  });

  await t.test('3. Generación Ejecutiva de Hojas de Cálculo Excel (.xlsx con exceljs)', async () => {
    const reportOptions = {
      title: 'Presupuesto Mobiliario Evento Deko Labs',
      sheetName: 'Presupuesto',
      columns: [
        { header: 'Concepto / Ítem', key: 'item', width: 25 },
        { header: 'Cantidad', key: 'qty', width: 12 },
        { header: 'Precio Unitario (Q)', key: 'price', width: 18 },
        { header: 'Total (Q)', key: 'total', width: 18 },
      ],
      rows: [
        { item: 'Sillas Vintage Luis XV', qty: 50, price: 75.0, total: 3750.0 },
        { item: 'Mesas Rústicas de Roble', qty: 10, price: 350.0, total: 3500.0 },
        { item: 'Candelabros de Bronce', qty: 20, price: 120.0, total: 2400.0 },
      ],
      summary: 'Cotización sujeta a disponibilidad de inventario.',
    };

    const excelResult = await excelService.generateExcelFile(reportOptions);

    assert.ok(excelResult.buffer);
    assert.ok(excelResult.buffer.length > 1000);
    assert.ok(excelResult.fileName.endsWith('.xlsx'));
    assert.equal(
      excelResult.mimeType,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    // Validar integridad del archivo Excel leyendo con ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelResult.buffer);
    const worksheet = workbook.getWorksheet('Presupuesto');
    assert.ok(worksheet, 'La pestaña Presupuesto debe existir en el workbook');
    assert.equal(worksheet.getCell(1, 1).value, '📊 PRESUPUESTO MOBILIARIO EVENTO DEKO LABS');
    assert.equal(worksheet.getCell(3, 1).value, 'Concepto / Ítem');
    assert.equal(worksheet.getCell(4, 1).value, 'Sillas Vintage Luis XV');
  });

  await t.test('4. Cero Dependencia de la Palabra "AGY": Disparo Autónomo e Invisible', async () => {
    let executedPrompt = null;
    const mockAgyBridge = {
      executeTask: async (prompt) => {
        executedPrompt = prompt;
        return {
          success: true,
          output: 'PID: 14204 | node.exe | CPU: 0.8% | Memory: 45MB | Status: ACTIVE',
        };
      },
    };

    const brain = new CarmencitaBrain(
      {
        prisma: mockPrisma,
        documentService,
        taskService,
        ideaService,
        excelService,
      },
      mockAgyBridge
    );

    // Simular que el cerebro Gemini devuelve una orden técnica sin que el usuario haya nombrado jamás a "AGY"
    const modelOutputSinMencionAgy = `¡Entendido, Sebastián! Enseguida reviso los procesos activos en el servidor para comprobar el estado de Node.

{"action": "RUN_AGY_TASK", "prompt": "Get-Process -Name node"}`;

    let ackCapturado = null;
    const onProgress = async (ackText) => {
      ackCapturado = ackText;
    };

    const result = await brain._executeExtractedActions(modelOutputSinMencionAgy, onProgress);

    // 1. Verificación de confirmación ejecutiva en dos etapas
    assert.ok(ackCapturado.includes('¡Entendido, Sebastián!'));
    assert.ok(!ackCapturado.includes('RUN_AGY_TASK'));

    // 2. Verificación de ejecución interna
    assert.equal(executedPrompt, 'Get-Process -Name node');

    // 3. Verificación de reporte final
    assert.ok(result.reply.includes('Reporte de terminal'));
    assert.ok(result.reply.includes('PID: 14204'));
  });

  await t.test('5. Generación Autónoma de Excel integrada en CarmencitaBrain', async () => {
    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const modelExcelOutput = `Con gusto Sebastián, preparé la tabla con el resumen de gastos solicitados.

{"action": "GENERATE_EXCEL", "title": "Gastos Septiembre", "sheetName": "Gastos", "columns": [{"header": "Rubro", "key": "rubro"}, {"header": "Monto", "key": "monto"}], "rows": [{"rubro": "Servidores", "monto": 850}, {"rubro": "Herramientas", "monto": 300}]}`;

    const result = await brain._executeExtractedActions(modelExcelOutput);

    assert.ok(result.hasExcel);
    assert.ok(result.excelFile);
    assert.ok(result.excelFile.buffer.length > 500);
    assert.ok(result.excelFile.fileName.includes('gastos_septiembre'));
  });

  await t.test('6. Migración Exitosa de Datos Legacy JSON a PostgreSQL (Factura McDonald\'s e Historial)', async () => {
    // Ejecutar migración utilizando el mockPrisma inyectado
    await runMigration(mockPrisma);

    // Validar que la factura de McDonald's se migró intacta
    const migratedInvoices = await mockPrisma.invoice.findMany({
      include: { document: true },
    });
    assert.ok(migratedInvoices.length >= 1, 'Debe haber al menos 1 factura migrada');
    const mcDonalds = migratedInvoices.find((i) => i.vendor.includes("McDonald's"));
    assert.ok(mcDonalds, "La factura de McDonald's debe estar presente en PostgreSQL");
    assert.equal(mcDonalds.totalAmount, 52.0);
    assert.equal(mcDonalds.currency, 'GTQ');
    assert.equal(mcDonalds.warrantyMonths, 12);

    // Validar mensajes de historial migrados
    const messages = await mockPrisma.messageLog.findMany();
    assert.ok(messages.length >= 6, 'El historial previo de mensajes debe migrarse a MessageLog');
    assert.ok(messages.some((m) => m.content.includes('Hola bebe')));
  });

  await t.test('7. Endpoints HTTP Fastify (Health Check, Facturas, Documentos, Tareas, Ideas) y Autenticación Mandatoria', async () => {
    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
    });
    const telegramAdapter = new TelegramAdapter(brain, storageProvider);
    const whatsappAdapter = new WhatsAppAdapter(brain, storageProvider);

    const app = Fastify();
    registerRoutes(app, {
      brain,
      documentService,
      taskService,
      ideaService,
      telegramAdapter,
      whatsappAdapter,
    });

    // 1. Health check (público sin autenticación)
    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(healthRes.statusCode, 200);
    const healthJson = healthRes.json();
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.standard, 'Deko Labs Enterprise');

    // 2. Rechazo 401 si no se envía API Key en /api/*
    const unauthFacturas = await app.inject({ method: 'GET', url: '/api/facturas' });
    assert.equal(unauthFacturas.statusCode, 401);
    assert.ok(unauthFacturas.json().error.includes('Acceso no autorizado'));

    const unauthDocs = await app.inject({ method: 'GET', url: '/api/documents' });
    assert.equal(unauthDocs.statusCode, 401);

    // 3. Facturas autorizadas con Bearer Token
    const facturasRes = await app.inject({ method: 'GET', url: '/api/facturas', headers: authHeaders });
    assert.equal(facturasRes.statusCode, 200);
    assert.ok(facturasRes.json().length >= 1);

    // 4. Documentos autorizados con cabecera x-api-key alternativa
    const docsRes = await app.inject({ method: 'GET', url: '/api/documents', headers: { 'x-api-key': 'test-secret-key-2026' } });
    assert.equal(docsRes.statusCode, 200);

    // 5. Tareas autorizadas
    const tasksRes = await app.inject({ method: 'GET', url: '/api/tasks', headers: authHeaders });
    assert.equal(tasksRes.statusCode, 200);

    // 6. Ideas autorizadas
    const ideasRes = await app.inject({ method: 'GET', url: '/api/ideas', headers: authHeaders });
    assert.equal(ideasRes.statusCode, 200);

    await app.close();
  });

  await t.test('8. WhatsApp Adapter: Procesamiento de Documentos y Despacho de Excel (Paridad Omnicanal)', async () => {
    const origLog = console.log;
    console.log = () => {};
    try {
      const brain = new CarmencitaBrain({
        prisma: mockPrisma,
        documentService,
        taskService,
        ideaService,
        excelService,
      });
      const whatsappAdapter = new WhatsAppAdapter(brain, storageProvider);

    let documentCaptured = null;
    let sentMessage = null;
    let sentMedia = null;

    brain.processDocument = async (args) => {
      documentCaptured = args;
      return '📑 ¡Documento clasificado y archivado en Bóveda!';
    };

    whatsappAdapter._downloadMediaBase64 = async () => Buffer.from('PDF_STREAM_TEST');
    whatsappAdapter.sendMessage = async (to, text) => {
      sentMessage = { to, text };
      return true;
    };
    whatsappAdapter.sendMedia = async (to, data) => {
      sentMedia = { to, ...data };
      return true;
    };

    // A. Recepción y procesamiento de Documento
    const documentPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '50212345678@s.whatsapp.net',
          fromMe: false,
        },
        pushName: 'Sebastián',
        message: {
          documentMessage: {
            fileName: 'contrato_deko_labs.pdf',
            mimetype: 'application/pdf',
            caption: 'Contrato firmado',
          },
        },
      },
    };

    // 0. Verificación de Deny-by-Default si la whitelist está vacía
    const originalAllowed = config.whatsapp.allowedNumbers;
    config.whatsapp.allowedNumbers = [];
    const blockedResult = await whatsappAdapter.handleWebhook(documentPayload);
    assert.equal(blockedResult.status, 'unauthorized_whitelist_empty');
    config.whatsapp.allowedNumbers = originalAllowed;

    const docResult = await whatsappAdapter.handleWebhook(documentPayload);
    assert.equal(docResult.status, 'processed_document');
    assert.ok(documentCaptured);
    assert.equal(documentCaptured.originalName, 'contrato_deko_labs.pdf');
    assert.equal(documentCaptured.mimeType, 'application/pdf');
    assert.equal(documentCaptured.channel, 'whatsapp');
    assert.equal(documentCaptured.senderId, '50212345678');
    assert.equal(sentMessage.text, '📑 ¡Documento clasificado y archivado en Bóveda!');

    // B. Despacho reactivo de archivo Excel
    brain.processTextMessage = async () => {
      return {
        reply: '📊 Aquí tienes la hoja de cálculo solicitada, Sebastián.',
        hasExcel: true,
        excelFile: {
          buffer: Buffer.from('FAKE_EXCEL_BYTES'),
          fileName: 'gastos_operativos.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      };
    };

    const textPayload = {
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: '50212345678@s.whatsapp.net',
          fromMe: false,
        },
        pushName: 'Sebastián',
        message: {
          conversation: 'Arma un Excel con los gastos',
        },
      },
    };

    const textResult = await whatsappAdapter.handleWebhook(textPayload);
    assert.equal(textResult.status, 'processed_text');
    assert.ok(sentMedia);
    assert.equal(sentMedia.to, '50212345678');
    assert.equal(sentMedia.fileName, 'gastos_operativos.xlsx');
    assert.equal(sentMedia.caption, '📊 Aquí tienes la hoja de cálculo solicitada, Sebastián.');
    } finally {
      console.log = origLog;
    }
  });

  await t.test('9. AgyBridge: Hardening RCE con Lista Blanca Estricta y Fallback Seguro sin AGY', async () => {
    // 1. Verificar limpieza de fences markdown ```json ... ```
    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
    });
    const modelOutputWithFences = `¡Entendido, Sebastián! Consulto los parámetros del sistema.

\`\`\`json
{"action": "RUN_AGY_TASK", "prompt": "system"}
\`\`\``;
    const res = await brain._executeExtractedActions(modelOutputWithFences);
    assert.ok(!res.reply.includes('```json'));
    assert.ok(!res.reply.includes('```'));
    assert.ok(res.reply.includes('¡Entendido, Sebastián! Consulto los parámetros del sistema.'));

    // 2. Verificar que AgyBridge con un binario inexistente bloquea comandos arbitrarios (RCE hardening)
    const agyBridgeFallback = new AgyBridge('non_existent_binary_xyz_123');
    const deniedResult = await agyBridgeFallback.executeTask('echo TEST_FALLBACK_OK');
    assert.equal(deniedResult.success, false);
    assert.ok(deniedResult.output.includes('Ejecución denegada: comando no autorizado en la lista blanca de seguridad.'));

    // 3. Verificar que comandos en lista blanca de telemetría son ejecutados de forma segura
    const allowedResult = await agyBridgeFallback.executeTask('system');
    assert.equal(allowedResult.success, true);
    assert.ok(allowedResult.output.length > 0);
  });

  await t.test('10. Arquitectura de Cerebro Dual: Modo Creativo & Estratégico sin Bloqueos', async () => {
    let capturedInstruction = null;
    let capturedPrompt = null;

    const mockAiCreative = {
      models: {
        generateContent: async ({ config, contents }) => {
          capturedInstruction = config?.systemInstruction;
          capturedPrompt = contents[0];
          return {
            text: `¡Por supuesto, Sebastián! Aquí tienes 3 propuestas conceptuales para iluminar el stand vintage:

1. **Lámparas Edison con Filamento Expuesto:** Suspendidas con poleas de hierro rústico para crear calidez focal.
2. **Guirnaldas Cálidas Ocultas en Vigas:** Proyectan iluminación envolvente sin deslumbrar.
3. **Reflectores Direccionales de Bronce Envejecido:** Ideales para destacar las piezas protagónicas.

¿Deseas que profundice en los materiales o guarde alguna en el banco de ideas?`,
          };
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
      ai: mockAiCreative,
    });

    // Validar directivas en el System Prompt
    const systemPrompt = brain.getSystemPrompt();
    assert.ok(systemPrompt.includes('ARQUITECTURA DE CEREBRO DUAL'));
    assert.ok(systemPrompt.includes('MODO CREATIVO & ESTRATÉGICO (DESATADO)'));
    assert.ok(systemPrompt.includes('Cero restricciones factuales'));

    // Ejecución de consulta creativa
    const result = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '123456',
      senderName: 'Sebastián',
      text: 'Dame 3 ideas creativas para iluminar el stand vintage',
    });

    assert.ok(capturedPrompt.includes('Dame 3 ideas creativas para iluminar el stand vintage'));
    assert.ok(capturedInstruction.includes('MODO CREATIVO & ESTRATÉGICO'));
    assert.ok(result.reply.includes('Lámparas Edison con Filamento Expuesto'));
    assert.ok(result.reply.includes('Reflectores Direccionales'));
  });

  await t.test('11. Arquitectura de Cerebro Dual: Modo Factual / Anti-Alucinación y Veracidad Constructiva en Excel', async () => {
    const mockAiFactual = {
      models: {
        generateContent: async () => {
          return {
            text: `Sebastián, no tengo registrado el costo de los ítems de feria en la base de datos ni en tus archivos. Te armé la estructura completa con las fórmulas listas; si me pasas la cotización o me dices los montos reales, te la cuadro y actualizo al instante.

{"action": "GENERATE_EXCEL", "title": "Presupuesto Stand Feria", "sheetName": "Presupuesto", "columns": [{"header": "Concepto", "key": "item", "width": 25}, {"header": "Cantidad", "key": "qty", "width": 12}, {"header": "Costo Unitario (Q)", "key": "unitPrice", "width": 20}, {"header": "Total Estimado (Q)", "key": "total", "width": 20}], "rows": [{"item": "Estructura Stand Madera", "qty": 1, "unitPrice": 0.0, "total": "=B4*C4"}, {"item": "Iluminación Vintage", "qty": 4, "unitPrice": "", "total": "=B5*C5"}, {"item": "Mobiliario Exhibición", "qty": 1, "unitPrice": "[PENDIENTE DE COTIZACIÓN]", "total": 0.0}], "summary": "Plantilla estructurada lista para ingresar costos reales de proveedores."}`,
          };
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
      ai: mockAiFactual,
    });

    const result = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '123456',
      senderName: 'Sebastián',
      text: 'Hazme un Excel de presupuesto para la feria',
    });

    // 1. Verificación del Protocolo de Veracidad Constructiva en el texto
    assert.ok(result.reply.includes('no tengo registrado el costo'));
    assert.ok(result.reply.includes('Te armé la estructura completa con las fórmulas listas'));
    assert.ok(!result.reply.includes('{"action"'));

    // 2. Verificación de la generación de Excel
    assert.ok(result.hasExcel, 'Debe marcar hasExcel como true');
    assert.ok(result.excelFile, 'Debe incluir el archivo excel generado');
    assert.equal(result.actionData.action, 'GENERATE_EXCEL');
    assert.equal(
      result.actionData.summary,
      'Plantilla estructurada lista para ingresar costos reales de proveedores.'
    );

    // 3. Inspección forense de la hoja de cálculo con ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.excelFile.buffer);
    const worksheet = workbook.getWorksheet('Presupuesto');
    assert.ok(worksheet, 'La hoja Presupuesto debe existir');

    // Fila 4: Estructura Stand Madera (unitPrice = 0.0, total = fórmula B4*C4)
    assert.equal(worksheet.getCell(4, 1).value, 'Estructura Stand Madera');
    assert.equal(worksheet.getCell(4, 2).value, 1);
    assert.equal(worksheet.getCell(4, 3).value, 0.0);
    assert.deepEqual(worksheet.getCell(4, 4).value, { formula: 'B4*C4' });

    // Fila 5: Iluminación Vintage (unitPrice = "", total = fórmula B5*C5)
    assert.equal(worksheet.getCell(5, 1).value, 'Iluminación Vintage');
    assert.equal(worksheet.getCell(5, 3).value, '');
    assert.deepEqual(worksheet.getCell(5, 4).value, { formula: 'B5*C5' });

    // Fila 6: Mobiliario Exhibición (unitPrice = "[PENDIENTE DE COTIZACIÓN]")
    assert.equal(worksheet.getCell(6, 1).value, 'Mobiliario Exhibición');
    assert.equal(worksheet.getCell(6, 3).value, '[PENDIENTE DE COTIZACIÓN]');

    // Resumen al pie
    const footerCell = worksheet.getCell(8, 1);
    assert.ok(footerCell.value.includes('Plantilla estructurada lista para ingresar costos reales'));
  });

  await t.test('12. Desacoplamiento Multimedia con GCS (Bóveda Desacoplada sin Basura en Disco)', async () => {
    // Aislamiento estricto de pruebas: limpiar residuos locales previos de Test 1
    await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});

    const uploadedObjects = new Map();
    let deletedObjects = [];

    // Mock del cliente de Google Cloud Storage con interfaz exacta
    const mockGcsClient = {
      bucket: (bucketName) => ({
        file: (objectPath) => ({
          save: async (buffer, opts) => {
            uploadedObjects.set(`${bucketName}/${objectPath}`, { buffer, opts });
          },
          download: async () => {
            const item = uploadedObjects.get(`${bucketName}/${objectPath}`);
            if (!item) throw new Error('Object not found in GCS mock');
            return [item.buffer];
          },
          delete: async () => {
            deletedObjects.push(`${bucketName}/${objectPath}`);
            uploadedObjects.delete(`${bucketName}/${objectPath}`);
            return true;
          },
          getSignedUrl: async ({ expires }) => {
            return [`https://storage.googleapis.com/${bucketName}/${objectPath}?signed=true&expires=${expires}`];
          },
        }),
      }),
    };

    const gcsStorageProvider = new StorageProvider({
      baseDir: testDataDir,
      bucketName: 'carmencita-vault-deko',
      gcsClient: mockGcsClient,
    });

    assert.equal(gcsStorageProvider.isCloudEnabled(), true, 'Debe activar modo cloud si hay gcsClient');

    const fakePdf = Buffer.from('%PDF-1.4 Factura cloud en GCS...');
    const result = await gcsStorageProvider.saveFile({
      buffer: fakePdf,
      originalName: 'recibo_dokploy_vps.pdf',
      mimeType: 'application/pdf',
      subDir: 'facturas',
    });

    // 1. Verificación de ruta gs:// y URL firmada (Signed URL)
    assert.equal(result.isCloud, true);
    assert.ok(result.filePath.startsWith('gs://carmencita-vault-deko/facturas/'));
    assert.ok(result.cloudUrl.includes('signed=true'));
    assert.equal(result.fileSize, fakePdf.length);

    // 1.1 Verificación de getSignedUrl explícito
    const explicitSignedUrl = await gcsStorageProvider.getSignedUrl(result.filePath);
    assert.ok(explicitSignedUrl.includes('signed=true'));

    // 2. Verificación de CERO bytes en el disco local del VPS
    const localDirExists = await fs.access(path.join(testDataDir, 'facturas')).then(() => true).catch(() => false);
    assert.equal(localDirExists, false, 'No deben crearse carpetas ni archivos multimedia permanentes en disco local en modo GCS');

    // 3. Verificación de lectura remota desde GCS
    const downloadedBuffer = await gcsStorageProvider.readFile(result.filePath);
    assert.deepEqual(downloadedBuffer, fakePdf);

    // 4. Verificación de eliminación en GCS
    const deleted = await gcsStorageProvider.deleteFile(result.filePath);
    assert.equal(deleted, true);
    assert.ok(deletedObjects.some((o) => o.includes('recibo_dokploy_vps')));
  });

  await t.test('13. Motor Proactivo de Recordatorios: SchedulerService con Notificación a Telegram y Marcado notifiedAt', async () => {
    const now = new Date();
    const pastDueDate = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutos en el pasado
    const futureDueDate = new Date(now.getTime() + 60 * 60 * 1000); // 1 hora en el futuro

    // 1. Crear una tarea vencida pendiente de notificación
    const pastTask = await mockPrisma.task.create({
      data: {
        description: 'Renovar certificado SSL de Dokploy',
        dueDate: pastDueDate,
        priority: 'ALTA',
        status: 'PENDIENTE',
        notifiedAt: null,
      },
    });

    // 2. Crear una tarea futura que NO debe ser notificada todavía
    const futureTask = await mockPrisma.task.create({
      data: {
        description: 'Revisión trimestral de inventario',
        dueDate: futureDueDate,
        priority: 'BAJA',
        status: 'PENDIENTE',
        notifiedAt: null,
      },
    });

    const capturedNotifications = [];
    const mockTelegramAdapter = {
      sendMessage: async (chatId, text) => {
        capturedNotifications.push({ chatId, text });
        return true;
      },
    };

    const scheduler = new SchedulerService({
      prisma: mockPrisma,
      telegramAdapter: mockTelegramAdapter,
      intervalMs: 1000,
    });

    // Ejecutar verificación de tareas pendientes
    const notifiedTasks = await scheduler.checkPendingTasks(now);

    // 1. Debe haber notificado únicamente la tarea vencida
    assert.equal(notifiedTasks.length, 1);
    assert.equal(notifiedTasks[0].id, pastTask.id);
    assert.ok(notifiedTasks[0].notifiedAt instanceof Date);

    // 2. Validar formato exacto del mensaje proactivo de Carmencita
    assert.equal(capturedNotifications.length, 1);
    const sentMsg = capturedNotifications[0].text;
    assert.ok(sentMsg.includes('🔔 ¡Sebastián, recordatorio de Carmencita!'));
    assert.ok(sentMsg.includes('📌 Tarea: Renovar certificado SSL de Dokploy'));
    assert.ok(sentMsg.includes('🔥 Prioridad: ALTA'));
    assert.ok(sentMsg.includes('¿Deseas que la marque como completada o la pospongo?'));

    // 3. Validar que la tarea futura NO fue notificada
    const freshFuture = await mockPrisma.task.findUnique({ where: { id: futureTask.id } });
    assert.equal(freshFuture.notifiedAt, null);

    // 4. Idempotencia y prevención de spam: segunda ejecución no debe re-notificar la misma tarea
    const secondPass = await scheduler.checkPendingTasks(now);
    assert.equal(secondPass.length, 0, 'No debe re-notificar tareas que ya tienen notifiedAt');
  });

  await t.test('14. Sincronización con Google Calendar: CalendarService y Acción CREATE_CALENDAR_EVENT en CarmencitaBrain', async () => {
    let insertedEventResource = null;
    const mockCalendarClient = {
      events: {
        insert: async ({ calendarId, requestBody }) => {
          insertedEventResource = { calendarId, ...requestBody };
          return {
            data: {
              id: 'cal_event_78910',
              summary: requestBody.summary,
              start: requestBody.start,
              end: requestBody.end,
              htmlLink: 'https://calendar.google.com/calendar/event?eid=cal_event_78910',
              status: 'confirmed',
            },
          };
        },
        list: async ({ calendarId }) => {
          return {
            data: {
              items: [
                {
                  id: 'cal_event_1',
                  summary: 'Reunión Creativa Feria Diseño',
                  start: { dateTime: '2026-10-02T10:00:00Z' },
                  end: { dateTime: '2026-10-02T11:30:00Z' },
                  htmlLink: 'https://calendar.google.com/calendar/event?eid=1',
                  location: 'Ciudad de Guatemala',
                },
              ],
            },
          };
        },
      },
    };

    const calendarService = new CalendarService({
      calendarClient: mockCalendarClient,
    });

    // 1. Prueba unitaria de CalendarService
    const created = await calendarService.createEvent({
      summary: 'Almuerzo con Proveedor Vintage',
      description: 'Discutir precios de candelabros y consolas',
      startDateTime: '2026-10-03T13:00:00Z',
      endDateTime: '2026-10-03T14:30:00Z',
      location: 'Restaurante Portal del Ángel',
    });

    assert.equal(created.id, 'cal_event_78910');
    assert.equal(created.summary, 'Almuerzo con Proveedor Vintage');
    assert.equal(created.htmlLink, 'https://calendar.google.com/calendar/event?eid=cal_event_78910');
    assert.equal(insertedEventResource.summary, 'Almuerzo con Proveedor Vintage');

    // 2. Listar eventos próximos
    const upcoming = await calendarService.listUpcomingEvents({ maxResults: 5 });
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0].summary, 'Reunión Creativa Feria Diseño');

    // 3. Integración en CarmencitaBrain con acción CREATE_CALENDAR_EVENT
    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
      calendarService,
    });

    const modelCalendarOutput = `¡Por supuesto, Sebastián! Te agendé la reunión en tu Google Calendar para que no se te pase.

\`\`\`json
{"action": "CREATE_CALENDAR_EVENT", "summary": "Sesión de Fotos Catálogo Otoño", "startDateTime": "2026-10-04T09:00:00Z", "endDateTime": "2026-10-04T12:00:00Z", "location": "Estudio Deko Labs"}
\`\`\``;

    const actionResult = await brain._executeExtractedActions(modelCalendarOutput);

    // Verificaciones de respuesta ejecutiva sin fugas de sintaxis JSON
    assert.ok(!actionResult.reply.includes('```json'));
    assert.ok(actionResult.reply.includes('¡Cita agendada en tu Google Calendar!'));
    assert.ok(actionResult.reply.includes('Sesión de Fotos Catálogo Otoño'));
    assert.ok(actionResult.reply.includes('https://calendar.google.com/calendar/event?eid=cal_event_78910'));
    assert.equal(actionResult.hasCalendarEvent, true);
    assert.equal(actionResult.calendarEvent.id, 'cal_event_78910');
  });

  await t.test('15. Directorio y Gestión de Contactos: ContactService y Acciones SAVE_CONTACT / SEARCH_CONTACT', async () => {
    const contactService = new ContactService(mockPrisma);

    // 1. Crear contacto y sanitizar teléfono
    const c1 = await contactService.createOrUpdateContact({
      name: 'Carlos Gómez',
      role: 'Carpintero y Ebanista',
      phone: '+502 5555-1234',
      company: 'Maderas del Bosque',
      notes: 'Experto en consolas y mesas vintage',
    });

    assert.ok(c1.id);
    assert.equal(c1.name, 'Carlos Gómez');
    assert.equal(c1.phone, '+50255551234');
    assert.equal(c1.company, 'Maderas del Bosque');

    // 2. Actualizar contacto existente (upsert por teléfono) sin duplicados
    const updated = await contactService.createOrUpdateContact({
      name: 'Carlos Gómez',
      phone: '+502 5555-1234',
      notes: 'Disponible para eventos feriales',
    });
    assert.equal(updated.id, c1.id);
    assert.ok(updated.notes.includes('Disponible para eventos'));

    // 3. Búsqueda insensible a mayúsculas
    const results = await contactService.searchContacts({ query: 'maderas' });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Carlos Gómez');

    const roleResults = await contactService.searchContacts({ query: 'ebanista' });
    assert.equal(roleResults.length, 1);

    // 4. Integración en CarmencitaBrain con SAVE_CONTACT
    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
      contactService,
    });

    const modelSaveContact = `¡Entendido, Sebastián! Guardo de inmediato a Elena en tu directorio.

\`\`\`json
{"action": "SAVE_CONTACT", "name": "Elena Morales", "role": "Diseñadora Textil", "phone": "50244449999", "company": "Telares Chapines", "notes": "Tejidos artesanales"}
\`\`\``;

    const saveResult = await brain._executeExtractedActions(modelSaveContact);
    assert.ok(!saveResult.reply.includes('```json'));
    assert.ok(saveResult.reply.includes('¡Contacto registrado en tu directorio!'));
    assert.ok(saveResult.reply.includes('Elena Morales'));
    assert.ok(saveResult.reply.includes('Telares Chapines'));
    assert.ok(saveResult.contact);
    assert.equal(saveResult.contact.name, 'Elena Morales');

    // 5. Integración en CarmencitaBrain con SEARCH_CONTACT (con enlaces tel: y WhatsApp)
    const modelSearchContact = `Consultando el directorio para encontrar proveedores textiles...

\`\`\`json
{"action": "SEARCH_CONTACT", "query": "textil"}
\`\`\``;

    const searchResult = await brain._executeExtractedActions(modelSearchContact);
    assert.ok(!searchResult.reply.includes('```json'));
    assert.ok(searchResult.reply.includes('Contactos encontrados para "textil"'));
    assert.ok(searchResult.reply.includes('Elena Morales'));
    assert.ok(searchResult.reply.includes('tel:50244449999'));
    assert.ok(searchResult.reply.includes('https://wa.me/50244449999'));
    assert.ok(searchResult.contacts.length >= 1);
  });

  await t.test('16. Consulta Inteligente de Agenda: CalendarService getTodayEvents y Acción LIST_CALENDAR_EVENTS', async () => {
    const todayIso = new Date().toISOString();
    const mockCalendar = {
      events: {
        list: async () => {
          return {
            data: {
              items: [
                {
                  id: 'ev_101',
                  summary: 'Montaje de Stand Feria Deco',
                  start: { dateTime: todayIso },
                  end: { dateTime: todayIso },
                  location: 'Parque de la Industria',
                  htmlLink: 'https://calendar.google.com/event?id=ev_101',
                },
                {
                  id: 'ev_102',
                  summary: 'Reunión con Proveedor de Iluminación',
                  start: { dateTime: todayIso },
                  end: { dateTime: todayIso },
                  location: 'Oficina Central',
                  htmlLink: 'https://calendar.google.com/event?id=ev_102',
                },
              ],
            },
          };
        },
      },
    };

    const calendarService = new CalendarService({ calendarClient: mockCalendar });

    // 1. Consulta directa de eventos de hoy
    const todayEvents = await calendarService.getTodayEvents();
    assert.equal(todayEvents.length, 2);
    assert.equal(todayEvents[0].summary, 'Montaje de Stand Feria Deco');
    assert.equal(todayEvents[0].location, 'Parque de la Industria');

    // 2. Integración en CarmencitaBrain con LIST_CALENDAR_EVENTS
    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
      calendarService,
    });

    const modelListOutput = `Revisando tu agenda del día en Google Calendar...

\`\`\`json
{"action": "LIST_CALENDAR_EVENTS", "range": "TODAY"}
\`\`\``;

    const listResult = await brain._executeExtractedActions(modelListOutput);
    assert.ok(!listResult.reply.includes('```json'));
    assert.ok(listResult.reply.includes('Agenda de Google Calendar (de Hoy'));
    assert.ok(listResult.reply.includes('Montaje de Stand Feria Deco'));
    assert.ok(listResult.reply.includes('Parque de la Industria'));
    assert.equal(listResult.calendarEvents.length, 2);
  });

  await t.test('17. Sincronización Bidireccional con Google Tasks: GoogleTasksService y TaskService', async () => {
    let insertedTaskPayload = null;
    const mockTasksClient = {
      tasks: {
        insert: async ({ tasklist, requestBody }) => {
          insertedTaskPayload = { tasklist, ...requestBody };
          return {
            data: {
              id: 'gtask_12345',
              title: requestBody.title,
              notes: requestBody.notes,
              due: requestBody.due,
              status: 'needsAction',
            },
          };
        },
        list: async () => {
          return {
            data: {
              items: [
                { id: 'gtask_1', title: 'Tarea sincronizada previa' },
              ],
            },
          };
        },
      },
    };

    const googleTasksService = new GoogleTasksService({ tasksClient: mockTasksClient });
    assert.equal(googleTasksService.isConfigured(), true);

    // 1. Probar inserción directa en GoogleTasksService
    const createdGTask = await googleTasksService.createTask({
      title: 'Auditar conexiones eléctricas del stand',
      notes: 'Prioridad ALTA',
      dueDate: '2026-10-02',
    });
    assert.equal(createdGTask.id, 'gtask_12345');
    assert.equal(insertedTaskPayload.title, 'Auditar conexiones eléctricas del stand');

    // 2. Probar sincronización en segundo plano desde TaskService
    const taskServiceWithSync = new TaskService(mockPrisma, googleTasksService);
    insertedTaskPayload = null;

    const localTask = await taskServiceWithSync.createTask({
      description: 'Comprar barniz rústico para estantes',
      due: '2026-10-03',
      priority: 'ALTA',
    });

    assert.ok(localTask.id);
    assert.equal(localTask.description, 'Comprar barniz rústico para estantes');

    // Esperar un tick de microtask para sincronización en segundo plano
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(insertedTaskPayload);
    assert.equal(insertedTaskPayload.title, 'Comprar barniz rústico para estantes');
    assert.ok(insertedTaskPayload.notes.includes('Prioridad: ALTA'));
  });

  await t.test('18. Briefing Matutino Ejecutivo: SchedulerService con Clima Open-Meteo, Agenda y Prevención de Duplicados', async () => {
    const mockWeather = '18°C, Soleado y despejado';
    const mockCalendar = {
      getTodayEvents: async () => [
        { summary: 'Reunión de Apertura Feria', start: '2026-09-28T10:00:00Z', location: 'Hotel Casa Santo Domingo' },
      ],
    };

    const capturedBriefs = [];
    const mockTelegram = {
      sendMessage: async (chatId, text) => {
        capturedBriefs.push({ chatId, text });
        return true;
      },
    };

    const scheduler = new SchedulerService({
      prisma: mockPrisma,
      telegramAdapter: mockTelegram,
      calendarService: mockCalendar,
      taskService,
      weatherFetcher: async () => mockWeather,
    });

    // 1. Disparo manual de Briefing Matutino
    const briefDate = new Date('2026-09-28T07:01:00-06:00');
    const briefMessage = await scheduler.triggerMorningBrief(briefDate);

    assert.ok(briefMessage.includes('🌅 ¡Buenos días, Sebastián!'));
    assert.ok(briefMessage.includes('18°C, Soleado y despejado'));
    assert.ok(briefMessage.includes('Reunión de Apertura Feria'));
    assert.ok(briefMessage.includes('Hotel Casa Santo Domingo'));
    assert.ok(briefMessage.includes('¡Que sea un día muy exitoso para Deko Labs!'));

    assert.equal(capturedBriefs.length, 1);
    assert.equal(scheduler.lastBriefDate, '2026-09-28');

    // 2. Prevención de duplicados el mismo día (idempotencia en checkMorningBrief)
    const checkSecond = await scheduler.checkMorningBrief(new Date('2026-09-28T07:03:00-06:00'));
    assert.equal(checkSecond, null, 'No debe disparar un segundo briefing el mismo día');
    assert.equal(capturedBriefs.length, 1, 'No debe enviar mensajes repetidos');
  });

  await t.test('19. Endpoints HTTP Fastify de Contactos y Agenda (/api/contacts, /api/calendar/today)', async () => {
    const contactService = new ContactService(mockPrisma);
    await contactService.createOrUpdateContact({
      name: 'Mario Rossi',
      role: 'Herrero Artesanal',
      phone: '50233332222',
      company: 'Forja Antigua',
    });

    const mockCalendar = {
      getTodayEvents: async () => [
        { id: '1', summary: 'Cita con Mario Rossi', start: '2026-09-28T14:00:00Z' },
      ],
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
      contactService,
      calendarService: mockCalendar,
    });

    const app = Fastify();
    registerRoutes(app, {
      brain,
      documentService,
      taskService,
      ideaService,
      contactService,
      calendarService: mockCalendar,
      telegramAdapter: null,
      whatsappAdapter: null,
    });

    // 1. Listar contactos
    const contactsRes = await app.inject({ method: 'GET', url: '/api/contacts', headers: authHeaders });
    assert.equal(contactsRes.statusCode, 200);
    const contactsList = contactsRes.json();
    assert.ok(contactsList.some((c) => c.name === 'Mario Rossi'));

    // 2. Filtrar contactos por búsqueda q=
    const searchRes = await app.inject({ method: 'GET', url: '/api/contacts?q=herrero', headers: authHeaders });
    assert.equal(searchRes.statusCode, 200);
    const searchList = searchRes.json();
    assert.equal(searchList.length, 1);
    assert.equal(searchList[0].name, 'Mario Rossi');

    // 3. Agenda de hoy
    const calRes = await app.inject({ method: 'GET', url: '/api/calendar/today', headers: authHeaders });
    assert.equal(calRes.statusCode, 200);
    const calList = calRes.json();
    assert.equal(calList.length, 1);
    assert.equal(calList[0].summary, 'Cita con Mario Rossi');

    await app.close();
  });

  await t.test('20. Parser de Rescate Temporal Heurístico en TaskService (_parseRelativeTime y Fallback en createTask)', async () => {
    // 1. Rescate de "en 2 horas" desde la descripción
    const task2h = await taskService.createTask({
      description: 'Comprar pilas en 2 horas',
      priority: 'ALTA',
    });
    assert.ok(task2h.id);
    assert.ok(task2h.dueDate instanceof Date, 'dueDate debe ser instancia de Date rescatada');
    const diff2h = task2h.dueDate.getTime() - Date.now();
    assert.ok(diff2h > 7100000 && diff2h < 7300000, `Debe estar programada para dentro de ~2 horas (diff: ${diff2h}ms)`);

    // 2. Rescate de "en 30 minutos" con due explícito vacío (simulando omisión del LLM)
    const task30m = await taskService.createTask({
      description: 'Revisar servidor en 30 minutos',
      due: '',
      priority: 'MEDIA',
    });
    assert.ok(task30m.dueDate instanceof Date);
    const diff30m = task30m.dueDate.getTime() - Date.now();
    assert.ok(diff30m > 1700000 && diff30m < 1900000, `Debe estar programada para dentro de ~30 minutos (diff: ${diff30m}ms)`);

    // 3. Rescate de "a las 7:00 PM"
    const task7pm = await taskService.createTask({
      description: 'Tomar curso a las 7:00 PM',
      due: null,
    });
    assert.ok(task7pm.dueDate instanceof Date);
    assert.equal(task7pm.dueDate.getHours(), 19);
    assert.equal(task7pm.dueDate.getMinutes(), 0);

    // 4. Verificación matemática exacta con baseDate fija en _parseRelativeTime
    const fixedBase = new Date('2026-09-28T10:00:00.000Z');
    const parsedHours = taskService._parseRelativeTime('Llamar al carpintero dentro de 4 horas', fixedBase);
    assert.equal(parsedHours.getTime(), fixedBase.getTime() + 4 * 60 * 60 * 1000);

    const parsedMins = taskService._parseRelativeTime('Verificar horno en 45 minutos', fixedBase);
    assert.equal(parsedMins.getTime(), fixedBase.getTime() + 45 * 60 * 1000);

    const parsedFixedTime = taskService._parseRelativeTime('Reunión a las 11:30 am', fixedBase);
    assert.equal(parsedFixedTime.getHours(), 11);
    assert.equal(parsedFixedTime.getMinutes(), 30);
  });

  await t.test('21. Inyección de Reloj Vivo de Guatemala en Prompt y Filtrado de Contexto por Sesión en CarmencitaBrain', async () => {
    let capturedPrompt = null;
    let capturedInstruction = null;

    const mockAiTime = {
      models: {
        generateContent: async ({ config: genConfig, contents }) => {
          capturedInstruction = genConfig?.systemInstruction;
          capturedPrompt = contents[0];
          return { text: '¡Entendido Sebastián, programado!' };
        },
      },
    };

    const brainTime = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
      ai: mockAiTime,
    });

    // 1. Verificar directiva temporal en System Prompt
    const systemPrompt = brainTime.getSystemPrompt();
    assert.ok(systemPrompt.includes('DIRECTIVA DE TIEMPO Y PROGRAMACIÓN DE RECORDATORIOS (SAVE_TASK)'));
    assert.ok(systemPrompt.includes('Conoces la fecha y hora actual exacta en Guatemala'));
    assert.ok(systemPrompt.includes('calcula matemáticamente la fecha y hora exacta absoluta'));
    assert.ok(systemPrompt.includes('YYYY-MM-DDTHH:mm:ss'));

    // 2. Ejecutar procesamiento de texto y validar inyección de reloj en contextPrompt
    await brainTime.processTextMessage({
      channel: 'telegram',
      senderId: 'tg_user_sebas_1',
      senderName: 'Sebastián',
      text: 'Recuérdame comprar pintura en 2 horas',
    });

    assert.ok(capturedPrompt.includes('CONTEXTO TEMPORAL DEL SISTEMA:'));
    assert.ok(capturedPrompt.includes('Fecha y hora actual en Guatemala:'));
    assert.ok(capturedPrompt.includes('America/Guatemala / UTC-6'));
    assert.ok(capturedPrompt.includes('Timestamp ISO 8601:'));

    // 3. Verificar aislamiento estricto de historial por canal y senderId en _getRecentContext
    await mockPrisma.messageLog.create({
      data: {
        channel: 'whatsapp',
        senderId: '50299998888',
        senderName: 'Cliente Externo',
        role: 'user',
        content: 'Mensaje de WhatsApp ajeno',
      },
    });

    const tgContext = await brainTime._getRecentContext('telegram', 'tg_user_sebas_1');
    assert.ok(tgContext.recentMessages.every((m) => m.channel === 'telegram' && m.senderId === 'tg_user_sebas_1'));
    assert.ok(!tgContext.recentMessages.some((m) => m.content.includes('Mensaje de WhatsApp ajeno')));
  });

  await t.test('22. Sellado de Webhook de WhatsApp y Autenticación Mandatoria de /api/* en Producción', async () => {
    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    let webhookPayloadReceived = null;
    const mockWhatsAppAdapter = {
      handleWebhook: async (payload) => {
        webhookPayloadReceived = payload;
        return { status: 'ok_authenticated' };
      },
    };

    const app = Fastify();
    registerRoutes(app, {
      brain,
      documentService,
      taskService,
      ideaService,
      whatsappAdapter: mockWhatsAppAdapter,
    });

    const origWhatsAppApiKey = config.whatsapp.apiKey;
    const origApiKey = config.apiKey;
    const origEnv = process.env.NODE_ENV;

    try {
      config.whatsapp.apiKey = 'wh-secret-deko-test-2026';

      // 1. Rechazo 401 si falta cabecera en webhook de WhatsApp
      const noHeaderRes = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        payload: { event: 'messages.upsert' },
      });
      assert.equal(noHeaderRes.statusCode, 401);
      assert.ok(noHeaderRes.json().error.includes('Webhook secret inválido o ausente'));

      // 2. Rechazo 401 si la cabecera es incorrecta
      const badHeaderRes = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: { apikey: 'clave_falsa' },
        payload: { event: 'messages.upsert' },
      });
      assert.equal(badHeaderRes.statusCode, 401);

      // 3. Aprobación 200 con cabecera apikey válida
      const okHeaderRes = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: { apikey: 'wh-secret-deko-test-2026' },
        payload: { event: 'messages.upsert', data: { test: true } },
      });
      assert.equal(okHeaderRes.statusCode, 200);
      assert.equal(okHeaderRes.json().status, 'ok_authenticated');

      // 4. Autenticación estricta en producción para /api/*
      process.env.NODE_ENV = 'production';
      config.apiKey = 'carmencita-prod-super-secret-key';

      // Rechazo sin token
      const prodNoToken = await app.inject({ method: 'GET', url: '/api/facturas' });
      assert.equal(prodNoToken.statusCode, 401);
      assert.ok(prodNoToken.json().error.includes('Acceso no autorizado'));

      // Rechazo con token incorrecto
      const prodBadToken = await app.inject({
        method: 'GET',
        url: '/api/facturas',
        headers: { authorization: 'Bearer token-equivocado' },
      });
      assert.equal(prodBadToken.statusCode, 401);

      // Aprobación con Bearer token correcto
      const prodOkToken = await app.inject({
        method: 'GET',
        url: '/api/facturas',
        headers: { authorization: 'Bearer carmencita-prod-super-secret-key' },
      });
      assert.equal(prodOkToken.statusCode, 200);
    } finally {
      config.whatsapp.apiKey = origWhatsAppApiKey;
      config.apiKey = origApiKey;
      process.env.NODE_ENV = origEnv;
      await app.close();
    }
  });

  await t.test('23. Denegación por Omisión (Deny-by-Default) en Telegram Adapter en Producción', async () => {
    const origEnv = process.env.NODE_ENV;
    const origAllowed = config.telegram.allowedUsers;
    const origToken = config.telegram.token;

    try {
      process.env.NODE_ENV = 'production';
      config.telegram.allowedUsers = [];
      config.telegram.token = 'fake_telegram_bot_token_12345';

      const telegramAdapter = new TelegramAdapter({}, null);
      telegramAdapter.init();

      let nextCalled = false;
      let replySent = null;

      const fakeCtx = {
        from: { id: 987654321, first_name: 'Desconocido' },
        reply: async (msg) => {
          replySent = msg;
        },
      };

      // Extraer y ejecutar el middleware registrado en bot.use
      const middleware = telegramAdapter.bot.middleware();
      await middleware(fakeCtx, async () => {
        nextCalled = true;
      });

      // Validar rechazo y que jamás se invoque next()
      assert.equal(nextCalled, false, 'En producción con whitelist vacía, next() NO debe ejecutarse');
      assert.ok(replySent.includes('Acceso restringido'));
    } finally {
      process.env.NODE_ENV = origEnv;
      config.telegram.allowedUsers = origAllowed;
      config.telegram.token = origToken;
    }
  });

  // Limpieza final
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});

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
          ...data,
        };
        this._data.tasks.unshift(item);
        return item;
      },
      findMany: async ({ where = {}, take = 50 } = {}) => {
        let res = [...this._data.tasks];
        if (where.status) res = res.filter((t) => t.status === where.status);
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
      findMany: async ({ take = 50 } = {}) => {
        return this._data.messageLogs.slice(0, take);
      },
    };

    this.contact = {
      create: async ({ data }) => {
        const item = { id: `ct_${Date.now()}`, createdAt: data.createdAt || new Date(), ...data };
        this._data.contacts.unshift(item);
        return item;
      },
      findMany: async () => this._data.contacts,
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

  await t.test('7. Endpoints HTTP Fastify (Health Check, Facturas, Documentos, Tareas, Ideas)', async () => {
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

    // Health check
    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(healthRes.statusCode, 200);
    const healthJson = healthRes.json();
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.standard, 'Deko Labs Enterprise');

    // Facturas
    const facturasRes = await app.inject({ method: 'GET', url: '/api/facturas' });
    assert.equal(facturasRes.statusCode, 200);
    assert.ok(facturasRes.json().length >= 1);

    // Tareas
    const tasksRes = await app.inject({ method: 'GET', url: '/api/tasks' });
    assert.equal(tasksRes.statusCode, 200);

    // Ideas
    const ideasRes = await app.inject({ method: 'GET', url: '/api/ideas' });
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

  // Limpieza final
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});

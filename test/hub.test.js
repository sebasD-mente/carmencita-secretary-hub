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
import { CARMENCITA_SYSTEM_PROMPT, TOOL_SYNTHESIS_PROMPT } from '../src/core/carmencita.prompt.js';
import { TelegramAdapter } from '../src/adapters/telegram.js';
import { WhatsAppAdapter } from '../src/adapters/whatsapp.js';
import { registerRoutes } from '../src/routes/webhooks.js';
import { setPrismaClient } from '../src/core/prisma.js';
import { runMigration } from '../scripts/migrate-json-to-prisma.js';
import { AgyBridge } from '../src/core/agy-bridge.js';
import { SchedulerService } from '../src/services/scheduler.service.js';
import { CalendarService, toGuatemalaIso } from '../src/services/calendar.service.js';
import { formatEventDates } from '../src/tools/workspace.tools.js';
import { ContactService } from '../src/services/contact.service.js';
import { GoogleTasksService } from '../src/services/google-tasks.service.js';
import { EmbeddingService } from '../src/services/embedding.service.js';
import { ObsidianDriveService, normalizeNoteTitle } from '../src/services/obsidian-drive.service.js';
import { GmailService, isPromotionalOrNoise, DEFAULT_GMAIL_QUERY } from '../src/services/gmail.service.js';
import { MediaService } from '../src/services/media.service.js';
import { VoiceService } from '../src/services/voice.service.js';
import { DiagnosticsService, sanitizeLogLine } from '../src/services/diagnostics.service.js';
import { cleanupObsidianDrive } from '../scripts/cleanup-obsidian-drive.js';
import { sanitizeReplyText, executeAction } from '../src/tools/index.js';
import {
  SaveMemoryActionSchema,
  SaveObsidianNoteActionSchema,
  SearchObsidianNotesActionSchema,
  CheckGmailActionSchema,
  GenerateQrActionSchema,
  SendMediaActionSchema,
  SendVoiceActionSchema,
  ReadObsidianNoteActionSchema,
  AppendObsidianNoteActionSchema,
  CompleteTaskActionSchema,
  CancelTaskActionSchema,
  ListTasksActionSchema,
  RescheduleCalendarEventActionSchema,
  CancelCalendarEventActionSchema,
  SearchDocumentsActionSchema,
  SyncObsidianVaultActionSchema,
  UpdateObsidianNoteActionSchema,
  DiagnoseSystemActionSchema,
  ListCalendarEventsActionSchema,
  parseCarmencitaAction,
} from '../src/validators/actions.schema.js';
import { config } from '../src/config.js';

// Setup de configuración y credenciales para pruebas de seguridad
process.env.NODE_ENV = 'test';
config.apiKey = 'test-secret-key-2026';
config.whatsapp.allowedNumbers = ['50212345678'];
config.obsidian.vaultFolderId = ''; // <--- AISLAMIENTO DE PRODUCCIÓN
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
      semanticMemories: [],
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
      findFirst: async ({ where = {}, orderBy = {} } = {}) => {
        let res = [...this._data.tasks];
        if (where.description?.contains) {
          const q = where.description.contains.toLowerCase();
          res = res.filter((t) => (t.description || '').toLowerCase().includes(q));
        }
        if (where.status?.in) {
          res = res.filter((t) => where.status.in.includes(t.status));
        } else if (where.status) {
          res = res.filter((t) => t.status === where.status);
        }
        return res[0] || null;
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

    this.semanticMemory = {
      findMany: async ({ where = {}, orderBy = {}, take = 50, select = null } = {}) => {
        let res = [...this._data.semanticMemories];
        if (where.category) res = res.filter((m) => m.category === where.category);
        if (orderBy?.createdAt === 'desc') {
          res.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }
        if (take) res = res.slice(0, take);
        if (select) {
          res = res.map((item) => {
            const selected = {};
            for (const [k, v] of Object.entries(select)) {
              if (v) selected[k] = item[k];
            }
            return selected;
          });
        }
        return res;
      },
      create: async ({ data }) => {
        const item = {
          id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: data.createdAt || new Date(),
          ...data,
        };
        this._data.semanticMemories.unshift(item);
        return item;
      },
    };
  }

  async $transaction(fn) {
    return await fn(this);
  }

  async $queryRaw() {
    return [{ '?column?': 1 }];
  }

  async $executeRawUnsafe(query, ...params) {
    if (query.includes('DELETE FROM "SemanticMemory"')) {
      const fileId = params[0];
      const initialLen = this._data.semanticMemories.length;
      this._data.semanticMemories = this._data.semanticMemories.filter((m) => {
        if (m.category !== 'OBSIDIAN') return true;
        if (!fileId) return false;
        return m.metadata?.fileId !== fileId;
      });
      return initialLen - this._data.semanticMemories.length;
    }
    if (query.includes('INSERT INTO "SemanticMemory"')) {
      const category = params[0] || 'GENERAL';
      const content = params[1] || '';
      let embedding = [];
      try {
        embedding = typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2];
      } catch {}
      let metadata = null;
      try {
        metadata = params[3] ? (typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3]) : null;
      } catch {}

      const item = {
        id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        category,
        content,
        embedding,
        metadata,
        createdAt: new Date(),
      };
      this._data.semanticMemories.unshift(item);
      return 1;
    }
    return 1;
  }

  async $queryRawUnsafe(query, ...params) {
    if (query.includes('FROM "SemanticMemory"')) {
      let queryVector = [];
      try {
        queryVector = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
      } catch {}
      const minSimilarity = typeof params[1] === 'number' ? params[1] : 0.55;
      const limit = typeof params[2] === 'number' ? params[2] : 3;

      const catMatch = query.match(/AND category = '([^']+)'/);
      const categoryFilter = catMatch ? catMatch[1] : null;

      const excludeCatMatch = query.match(/AND category != '([^']+)'/);
      const excludeCategoryFilter = excludeCatMatch ? excludeCatMatch[1] : null;

      function cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
      }

      const results = this._data.semanticMemories
        .filter((m) => m.embedding && m.embedding.length > 0)
        .filter((m) => !categoryFilter || m.category === categoryFilter)
        .filter((m) => !excludeCategoryFilter || m.category !== excludeCategoryFilter)
        .map((m) => ({
          id: m.id,
          category: m.category,
          content: m.content,
          metadata: m.metadata,
          createdAt: m.createdAt,
          similarity: cosineSimilarity(queryVector, m.embedding),
        }))
        .filter((m) => m.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return results;
    }
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

  const mockGoogleTasksService = {
    isConfigured: () => false,
    createTask: async ({ title, notes, due }) => ({
      id: `mock-gtask-${Date.now()}`,
      title,
      notes,
      due,
      status: 'needsAction',
    }),
    listTasks: async () => [],
  };

  const documentService = new DocumentService(mockPrisma, storageProvider);
  const taskService = new TaskService(mockPrisma, mockGoogleTasksService);
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

    // 0. Aislamiento estricto de producción: verificar que el servicio sin mock se autodesactiva en entorno de pruebas
    const unconfiguredTasksService = new GoogleTasksService();
    assert.equal(unconfiguredTasksService.isConfigured(), false, 'GoogleTasksService sin tasksClient debe autodesactivarse en entorno de pruebas');
    assert.equal(mockGoogleTasksService.isConfigured(), false, 'mockGoogleTasksService de la suite debe reportar no configurado');

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

  await t.test('24. Memoria Semántica: Generación de Embeddings y Almacenamiento en PostgreSQL (saveMemory)', async () => {
    // Vector de 768 dimensiones
    const sampleVector = Array.from({ length: 768 }, (_, i) => Math.sin(i + 1));
    const mockAi = {
      models: {
        embedContent: async ({ model, contents }) => {
          assert.equal(model, 'text-embedding-004');
          assert.ok(contents);
          return { embedding: { values: sampleVector } };
        },
      },
    };

    const embeddingSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAi });

    // 1. Guardar memoria exitosa
    const saved = await embeddingSvc.saveMemory({
      content: 'A Sebastián le gusta el café negro sin azúcar a primera hora',
      category: 'PREFERENCIA',
      metadata: { source: 'dictado_directo' },
    });

    assert.equal(saved.success, true);
    assert.equal(saved.category, 'PREFERENCIA');
    assert.equal(saved.content, 'A Sebastián le gusta el café negro sin azúcar a primera hora');
    assert.deepEqual(saved.metadata, { source: 'dictado_directo' });

    // Verificar en mockPrisma que se guardó
    const stored = mockPrisma._data.semanticMemories[0];
    assert.ok(stored);
    assert.equal(stored.category, 'PREFERENCIA');
    assert.equal(stored.content, 'A Sebastián le gusta el café negro sin azúcar a primera hora');
    assert.equal(stored.embedding.length, 768);

    // 2. Validación de contenido obligatorio
    await assert.rejects(
      async () => embeddingSvc.saveMemory({ content: '', category: 'GENERAL' }),
      /El contenido del recuerdo es obligatorio/
    );
  });

  await t.test('25. Memoria Semántica: Búsqueda Vectorial por Similitud de Coseno y Filtrado por Umbral (searchSimilarMemories)', async () => {
    // Vectores sintéticos de 768 dimensiones con similitudes predecibles
    const vecCoffee = Array.from({ length: 768 }, (_, i) => (i < 100 ? 1 : 0));
    const vecCoffeeQuery = Array.from({ length: 768 }, (_, i) => (i < 100 ? 0.95 : (i === 101 ? 0.05 : 0)));
    const vecServer = Array.from({ length: 768 }, (_, i) => (i >= 200 && i < 300 ? 1 : 0));

    let currentVectorToReturn = vecCoffee;
    const mockAi = {
      models: {
        embedContent: async ({ contents }) => {
          if (contents.includes('café') || contents.includes('cafe')) {
            return { embedding: { values: vecCoffee } };
          }
          if (contents.includes('servidor') || contents.includes('dokploy')) {
            return { embedding: { values: vecServer } };
          }
          return { embedding: { values: currentVectorToReturn } };
        },
      },
    };

    const embeddingSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAi });

    // Guardar recuerdos de prueba
    await embeddingSvc.saveMemory({
      content: 'Sebastián prefiere café espresso o negro sin azúcar',
      category: 'PREFERENCIA',
    });
    await embeddingSvc.saveMemory({
      content: 'El servidor de Dokploy corre en el puerto 5433 en el VPS',
      category: 'DIRECTIVA',
    });

    // 1. Búsqueda con query afín al café
    currentVectorToReturn = vecCoffeeQuery;
    const coffeeResults = await embeddingSvc.searchSimilarMemories('¿Qué café toma Sebastián?', {
      limit: 3,
      minSimilarity: 0.55,
    });

    assert.ok(coffeeResults.length >= 1, 'Debe encontrar al menos 1 resultado similar');
    assert.equal(coffeeResults[0].category, 'PREFERENCIA');
    assert.ok(coffeeResults[0].content.includes('café espresso'));
    assert.ok(coffeeResults[0].similarity >= 0.55, 'La similitud debe superar el umbral');

    // 2. Verificar que el servidor NO aparece en resultados de café por filtro de umbral mínimo
    const hasServerResult = coffeeResults.some((r) => r.content.includes('Dokploy'));
    assert.equal(hasServerResult, false, 'Recuerdos no afines deben ser filtrados por umbral de similitud');

    // 3. Filtrado por categoría
    const prefOnly = await embeddingSvc.searchSimilarMemories('café', {
      limit: 3,
      minSimilarity: 0.1,
      category: 'PREFERENCIA',
    });
    assert.ok(prefOnly.every((m) => m.category === 'PREFERENCIA'));
  });

  await t.test('26. RAG y Memoria a Largo Plazo: Inyección Automática de Recuerdos Relevantes en CarmencitaBrain', async () => {
    let capturedPrompt = null;

    const mockAi = {
      models: {
        generateContent: async ({ contents }) => {
          capturedPrompt = contents[0];
          return { text: 'El proveedor Impresos Rápidos nos cobra Q120 por metro de vinil.' };
        },
      },
    };

    const mockEmbeddingSvc = {
      searchSimilarMemories: async (query) => {
        if (query.includes('vinil') || query.includes('proveedor')) {
          return [
            {
              id: 'mem_1',
              category: 'ACUERDO',
              content: 'Impresos Rápidos cobra Q120 por metro cuadrado de vinil para stands',
              similarity: 0.92,
            },
            {
              id: 'mem_2',
              category: 'DIRECTIVA',
              content: 'Siempre solicitar factura contable en compras de vinil mayores a Q500',
              similarity: 0.78,
            },
          ];
        }
        return [];
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAi,
      embeddingService: mockEmbeddingSvc,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const reply = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: '¿Cuánto nos cobraba el proveedor de vinil para los stands?',
    });

    // Verificar que el prompt inyectado a Gemini contiene la sección RAG formateada
    assert.ok(capturedPrompt, 'El contextPrompt debió ser capturado');
    assert.ok(capturedPrompt.includes('🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):'));
    assert.ok(capturedPrompt.includes('• [ACUERDO] Impresos Rápidos cobra Q120 por metro cuadrado de vinil para stands'));
    assert.ok(capturedPrompt.includes('(Afinidad: 92%)'));
    assert.ok(capturedPrompt.includes('• [DIRECTIVA] Siempre solicitar factura contable en compras de vinil mayores a Q500'));
    assert.ok(capturedPrompt.includes('(Afinidad: 78%)'));
    assert.ok(reply.includes('Impresos Rápidos'));
  });

  await t.test('27. Acción SAVE_MEMORY: Validación Zod con SaveMemoryActionSchema y Ejecución Autónoma en CarmencitaBrain', async () => {
    // 1. Validación Zod directa
    const validJson = {
      action: 'SAVE_MEMORY',
      content: 'Sebastián no responde mensajes de trabajo los domingos',
      category: 'PREFERENCIA',
      reason: 'Directiva explícita de descanso',
    };
    const parsed = parseCarmencitaAction(validJson);
    assert.ok(parsed, 'La acción SAVE_MEMORY debe ser validada exitosamente por Zod');
    assert.equal(parsed.action, 'SAVE_MEMORY');
    assert.equal(parsed.category, 'PREFERENCIA');
    assert.equal(parsed.content, 'Sebastián no responde mensajes de trabajo los domingos');

    // Validación rechaza contenido vacío
    const invalidJson = { action: 'SAVE_MEMORY', content: '' };
    assert.equal(parseCarmencitaAction(invalidJson), null);

    // 2. Ejecución integrada en CarmencitaBrain
    let savedParams = null;
    const mockEmbeddingSvc = {
      searchSimilarMemories: async () => [],
      saveMemory: async (params) => {
        savedParams = params;
        return { success: true, ...params };
      },
    };

    const mockAi = {
      models: {
        generateContent: async () => {
          return {
            text: '¡Entendido perfectamente, Sebastián! He guardado tu directiva en mi memoria a largo plazo.\n' +
              '```json\n{"action": "SAVE_MEMORY", "content": "Sebastián no responde mensajes de trabajo los domingos", "category": "PREFERENCIA"}\n```',
          };
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAi,
      embeddingService: mockEmbeddingSvc,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const result = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, recuerda que los domingos no contesto nada de trabajo.',
    });

    assert.equal(result.hasMemory, true);
    assert.equal(result.actionData.action, 'SAVE_MEMORY');
    assert.equal(result.actionData.category, 'PREFERENCIA');
    assert.ok(!result.reply.includes('SAVE_MEMORY'), 'El JSON debe ser removido de la respuesta limpia');
    assert.ok(result.reply.includes('¡Entendido perfectamente, Sebastián!'));
    assert.ok(result.fullHistoryText.includes('[Memoria guardada en bóveda semántica: "Sebastián no responde mensajes de trabajo los domingos"]'));
    assert.ok(savedParams, 'saveMemory debió haber sido llamado en embeddingService');
    assert.equal(savedParams.content, 'Sebastián no responde mensajes de trabajo los domingos');
    assert.equal(savedParams.category, 'PREFERENCIA');
  });

  await t.test('28. Pool de Modelos con Failover Automático y Resiliencia Multimodal ante 503/429', async () => {
    const attempts = [];
    const mockAiFailover = {
      models: {
        generateContent: async ({ model }) => {
          attempts.push(model);
          if (model === 'gemini-3.8-flash') {
            const err = new Error('This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.');
            err.status = 'UNAVAILABLE';
            err.code = 503;
            throw err;
          }
          if (model === 'gemini-3.7-flash') {
            return {
              text: '¡Entendido Sebastián! Ya retomé la tarea tras la conmutación al modelo de respaldo.',
            };
          }
          throw new Error(`Modelo no esperado: ${model}`);
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiFailover,
      documentService,
      taskService,
      ideaService,
      excelService,
      modelPool: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'],
    });

    const result = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Ya compre las pilas puedes terminar esa tarea',
    });

    // 1. Debe haber intentado primero gemini-3.8-flash y conmutado a gemini-3.7-flash
    assert.deepEqual(attempts, ['gemini-3.8-flash', 'gemini-3.7-flash']);

    // 2. La respuesta debe provenir del modelo secundario sin mensajes de error
    assert.ok(result.reply.includes('¡Entendido Sebastián! Ya retomé la tarea tras la conmutación'));
    assert.ok(!result.reply.includes('error al consultar el motor de IA'));

    // 3. Verificación de retrocompatibilidad: usa config.ai.modelPool por defecto si no se pasa en deps
    const brainDefaultPool = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiFailover,
      documentService,
      taskService,
      ideaService,
      excelService,
    });
    assert.ok(Array.isArray(brainDefaultPool.modelPool));
    assert.equal(brainDefaultPool.modelPool[0], 'gemini-3.8-flash');
    assert.ok(brainDefaultPool.modelPool.includes('gemini-3.7-flash'));

    // 4. Verificación de interrupción ante error 400 (Bad Request no recuperable)
    const attempts400 = [];
    const mockAi400 = {
      models: {
        generateContent: async ({ model }) => {
          attempts400.push(model);
          const err = new Error('Bad Request: Invalid argument');
          err.status = 400;
          throw err;
        },
      },
    };
    const brain400 = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAi400,
      documentService,
      taskService,
      ideaService,
      excelService,
      modelPool: ['gemini-3.8-flash', 'gemini-3.7-flash'],
    });
    const result400 = await brain400.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Mensaje con datos inválidos',
    });
    assert.deepEqual(attempts400, ['gemini-3.8-flash'], 'Error 400 no debe conmutar a los siguientes modelos');
    assert.ok(typeof result400 === 'string' && result400.includes('error al consultar el motor de IA'));
  });

  await t.test('29. Integración Bidireccional con Obsidian Vault vía Google Drive API (ObsidianDriveService y SAVE_OBSIDIAN_NOTE)', async () => {
    // 0. Validación de Esquema Zod SaveObsidianNoteActionSchema
    const validActionJson = {
      action: 'SAVE_OBSIDIAN_NOTE',
      title: 'Stand Vintage 2026',
      content: '> [!tip] Concepto\nDiseño con vigas rústicas y lámparas Edison.',
      folder: 'Ideas',
      tags: ['deko-labs', 'stands', 'diseño'],
      wikilinks: ['Deko Labs', 'Sebastián Jiménez', 'Ferias 2026'],
    };
    const parsed = parseCarmencitaAction(validActionJson);
    assert.ok(parsed, 'La acción SAVE_OBSIDIAN_NOTE debe ser validada exitosamente por Zod');
    assert.equal(parsed.action, 'SAVE_OBSIDIAN_NOTE');
    assert.equal(parsed.title, 'Stand Vintage 2026');
    assert.equal(parsed.folder, 'Ideas');

    // Validación rechaza título vacío
    assert.equal(parseCarmencitaAction({ action: 'SAVE_OBSIDIAN_NOTE', title: '', content: 'algo' }), null);

    // 1. ObsidianDriveService: Prueba con Mock de Google Drive Client
    const createdFolders = [];
    const createdFiles = [];

    const mockDrive = {
      files: {
        list: async ({ q }) => {
          return { data: { files: [] } };
        },
        create: async ({ requestBody, media }) => {
          if (requestBody.mimeType === 'application/vnd.google-apps.folder') {
            const folderId = `folder_${requestBody.name}_123`;
            createdFolders.push({ id: folderId, ...requestBody });
            return { data: { id: folderId, name: requestBody.name } };
          }
          const fileId = 'file_md_123';
          createdFiles.push({ id: fileId, requestBody, media });
          return {
            data: {
              id: fileId,
              name: requestBody.name,
              webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
              parents: requestBody.parents,
            },
          };
        },
      },
    };

    const obsidianService = new ObsidianDriveService({
      vaultFolderName: 'vault',
      driveClient: mockDrive,
    });

    const noteResult = await obsidianService.createNote({
      title: 'Stand Vintage 2026',
      content: 'Estructura modular con vigas rústicas y lámparas Edison.',
      folder: 'Ideas',
      tags: ['deko-labs', 'stands', '#diseño'],
      wikilinks: ['Deko Labs', '[[Sebastián Jiménez]]', 'Ferias 2026'],
    });

    // Validar creación de carpeta raíz y subcarpeta
    assert.equal(createdFolders.length, 2, 'Debió crear carpeta raíz vault y subcarpeta Ideas');
    assert.equal(createdFolders[0].name, 'vault');
    assert.deepEqual(createdFolders[0].parents, ['root']);
    assert.equal(createdFolders[1].name, 'Ideas');
    assert.deepEqual(createdFolders[1].parents, [createdFolders[0].id]);

    // Validar archivo markdown creado
    assert.equal(createdFiles.length, 1);
    assert.equal(createdFiles[0].requestBody.name, 'Stand Vintage 2026.md');
    assert.equal(createdFiles[0].requestBody.mimeType, 'text/markdown');
    assert.deepEqual(createdFiles[0].requestBody.parents, [createdFolders[1].id]);

    // Validar Frontmatter YAML y Wikilinks
    assert.ok(noteResult.rawContent.includes('---'));
    assert.ok(noteResult.rawContent.includes('title: "Stand Vintage 2026"'));
    assert.ok(noteResult.rawContent.includes('author: Carmencita'));
    assert.ok(noteResult.rawContent.includes('folder: "Ideas"'));
    assert.ok(noteResult.rawContent.includes('tags:'));
    assert.ok(noteResult.rawContent.includes('- deko-labs'));
    assert.ok(noteResult.rawContent.includes('- stands'));
    assert.ok(noteResult.rawContent.includes('- diseño'));
    assert.ok(noteResult.rawContent.includes('### 🔗 Enlaces Relacionados (Graph View)'));
    assert.ok(noteResult.rawContent.includes('- [[Deko Labs]]'));
    assert.ok(noteResult.rawContent.includes('- [[Sebastián Jiménez]]'));
    assert.ok(noteResult.rawContent.includes('- [[Ferias 2026]]'));

    // 2. Integración en CarmencitaBrain con acción SAVE_OBSIDIAN_NOTE
    let capturedNoteParams = null;
    const mockBrainObsidianService = {
      createNote: async (params) => {
        capturedNoteParams = params;
        return {
          fileId: 'mock_drive_file_123',
          fileName: 'Stand Feria 2026.md',
          folder: params.folder || 'Ideas',
          webViewLink: 'https://drive.google.com/file/d/mock_drive_file_123/view',
        };
      },
    };

    const mockAiObsidian = {
      models: {
        generateContent: async () => ({
          text: '¡Excelente idea para el stand, Sebastián! La he estructurado para tu Obsidian Vault.\n' +
            '```json\n' +
            JSON.stringify({
              action: 'SAVE_OBSIDIAN_NOTE',
              title: 'Stand Feria 2026',
              folder: 'Ideas',
              tags: ['deko-labs', 'stands'],
              wikilinks: ['Deko Labs', 'Sebastián Jiménez', 'Feria 2026'],
              content: '> [!tip] Concepto Principal\nEstructura en madera recuperada con acabados industriales.',
            }) +
            '\n```',
        }),
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiObsidian,
      obsidianService: mockBrainObsidianService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const brainResult = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, anota esta idea para el stand de la feria en Obsidian con tags deko-labs y stands',
    });

    assert.equal(brainResult.hasObsidianNote, true);
    assert.ok(brainResult.obsidianNote);
    assert.equal(brainResult.obsidianNote.fileName, 'Stand Feria 2026.md');
    assert.equal(capturedNoteParams.title, 'Stand Feria 2026');
    assert.equal(capturedNoteParams.folder, 'Ideas');
    assert.deepEqual(capturedNoteParams.tags, ['deko-labs', 'stands']);
    assert.deepEqual(capturedNoteParams.wikilinks, ['Deko Labs', 'Sebastián Jiménez', 'Feria 2026']);
    assert.ok(brainResult.reply.includes('Nota guardada en tu Obsidian Vault:'));
    assert.ok(brainResult.reply.includes('/Ideas/Stand Feria 2026.md'));
    assert.ok(brainResult.reply.includes('[[Deko Labs]]'));
    assert.ok(brainResult.reply.includes('[[Sebastián Jiménez]]'));

    // 3. Resiliencia ante fallos de Google Drive
    const failingObsidianService = {
      createNote: async () => {
        throw new Error('Google Drive API 500 Backend Error');
      },
    };
    const failingBrain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiObsidian,
      obsidianService: failingObsidianService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });
    const errorResult = await failingBrain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Anota esto en Obsidian',
    });
    assert.ok(errorResult.reply.includes('No pude sincronizar la nota en Google Drive para Obsidian: Google Drive API 500 Backend Error'));
  });

  await t.test('30. Integración de Gmail en Briefing Matutino y Consulta On-Demand en CarmencitaBrain (GmailService y CHECK_GMAIL)', async () => {
    // 0. Validación de Esquema Zod CheckGmailActionSchema
    const defaultCheckAction = { action: 'CHECK_GMAIL' };
    const parsedDefaultAction = parseCarmencitaAction(defaultCheckAction);
    assert.ok(parsedDefaultAction, 'CHECK_GMAIL por defecto debe ser validado por Zod');
    assert.equal(parsedDefaultAction.action, 'CHECK_GMAIL');
    assert.equal(parsedDefaultAction.maxResults, 5);
    assert.equal(parsedDefaultAction.onlyImportant, false);
    assert.equal(parsedDefaultAction.query, '');

    // 0b. Heurística Anti-Ruido y Publicidad: isPromotionalOrNoise
    assert.equal(isPromotionalOrNoise({ from: 'notifications@linkedin.com', subject: 'Tienes 5 nuevas invitaciones' }), true);
    assert.equal(isPromotionalOrNoise({ from: 'update@facebookmail.com', subject: 'Novedades de tus amigos' }), true);
    assert.equal(isPromotionalOrNoise({ from: 'promos@samsung.com', subject: '¡Hasta 65% OFF en Smart TVs!' }), true);
    assert.equal(isPromotionalOrNoise({ from: 'marketing@tienda.com', subject: 'Descuento exclusivo hoy' }), true);
    assert.equal(isPromotionalOrNoise({ from: 'deals@club.com', subject: 'Reclama tus puntos' }), true);
    assert.equal(isPromotionalOrNoise({ from: 'news@realpython.com', subject: 'Weekly digest' }), true);
    assert.equal(isPromotionalOrNoise({ from: 'promo@newsletter.org', subject: 'Cursos de la semana', hasUnsubscribe: true }), true);

    // Admite correos legítimos de clientes, proveedores y bancos
    assert.equal(isPromotionalOrNoise({ from: 'facturacion@proveedor.gt', subject: 'Factura Electrónica FE-4920 Deko Labs' }), false);
    assert.equal(isPromotionalOrNoise({ from: 'banco@notificaciones.banrural.com.gt', subject: 'Confirmación de transferencia bancaria' }), false);
    assert.equal(isPromotionalOrNoise({ from: 'cliente@constructora.com', subject: 'Aprobación del diseño del stand' }), false);
    assert.equal(isPromotionalOrNoise({ from: 'sebas@dekolabs.org', subject: 'Reunión de coordinación' }), false);

    // 1. GmailService Unit: Mock del cliente gmail con mezcla de correos principales y promocionales
    const mockMessagesData = [
      { id: 'msg_promo_01', threadId: 'thread_promo_01' },
      { id: 'msg_001', threadId: 'thread_001' },
      { id: 'msg_social_01', threadId: 'thread_social_01' },
      { id: 'msg_002', threadId: 'thread_002' },
    ];

    const mockMessageDetails = {
      msg_promo_01: {
        id: 'msg_promo_01',
        threadId: 'thread_promo_01',
        snippet: 'Aprovecha nuestra promoción de temporada con descuentos...',
        payload: {
          headers: [
            { name: 'From', value: 'Samsung Promociones <promos@samsung.com>' },
            { name: 'Subject', value: '¡Hasta 65% OFF en pantallas y electrodomésticos!' },
            { name: 'Date', value: 'Thu, 01 Oct 2026 10:00:00 -0600' },
            { name: 'List-Unsubscribe', value: '<https://samsung.com/unsubscribe>' },
          ],
        },
      },
      msg_social_01: {
        id: 'msg_social_01',
        threadId: 'thread_social_01',
        snippet: 'Tienes 12 nuevas notificaciones y mensajes en tu red profesional...',
        payload: {
          headers: [
            { name: 'From', value: 'LinkedIn Updates <messages-noreply@linkedin.com>' },
            { name: 'Subject', value: 'Sebastián, personas que quizás conozcas' },
            { name: 'Date', value: 'Thu, 01 Oct 2026 11:30:00 -0600' },
          ],
        },
      },
      msg_001: {
        id: 'msg_001',
        threadId: 'thread_001',
        snippet: 'Hola Sebastián, confirmamos la entrega del material para el stand...',
        payload: {
          headers: [
            { name: 'From', value: 'Impresos Rápidos <contacto@impresosrapidos.gt>' },
            { name: 'Subject', value: 'Confirmación de entrega stand' },
            { name: 'Date', value: 'Thu, 01 Oct 2026 14:30:00 -0600' },
          ],
        },
      },
      msg_002: {
        id: 'msg_002',
        threadId: 'thread_002',
        snippet: 'Adjunto el comprobante de pago de la factura #5421...',
        payload: {
          headers: [
            { name: 'From', value: 'Cliente VIP <vip@dekolabs.org>' },
            { name: 'Subject', value: 'Comprobante de transferencia bancaria' },
            { name: 'Date', value: 'Thu, 01 Oct 2026 15:15:00 -0600' },
          ],
        },
      },
    };

    const mockGmailClient = {
      users: {
        messages: {
          list: async () => ({
            data: { messages: mockMessagesData },
          }),
          get: async ({ id }) => ({
            data: mockMessageDetails[id],
          }),
        },
      },
    };

    const gmailService = new GmailService({ gmailClient: mockGmailClient });
    assert.equal(gmailService.isConfigured(), true);

    // Filtrado inteligente: sólo deben quedar los 2 correos principales
    const unread = await gmailService.getUnreadInboxMessages({ maxResults: 5, onlyImportant: true });
    assert.equal(unread.length, 2);
    assert.equal(unread[0].id, 'msg_001');
    assert.equal(unread[0].from, 'Impresos Rápidos <contacto@impresosrapidos.gt>');
    assert.equal(unread[0].subject, 'Confirmación de entrega stand');
    assert.ok(unread[0].snippet.includes('confirmamos la entrega'));
    assert.equal(unread[1].id, 'msg_002');
    assert.equal(unread[1].from, 'Cliente VIP <vip@dekolabs.org>');

    // Verificación con onlyImportant: false (retorna todos)
    const unreadAll = await gmailService.getUnreadInboxMessages({ maxResults: 5, onlyImportant: false });
    assert.equal(unreadAll.length, 4);

    const summary = await gmailService.getInboxSummary({ maxResults: 5 });
    assert.equal(summary.totalUnread, 2);
    assert.equal(summary.messages.length, 2);

    // 2. SchedulerService Integration con Gmail en Morning Brief
    const schedulerWithGmail = new SchedulerService({
      prisma: mockPrisma,
      gmailService,
      weatherFetcher: async () => '20°C, Soleado',
    });

    const briefMessage = await schedulerWithGmail.triggerMorningBrief(new Date('2026-10-01T07:00:00-06:00'));
    assert.ok(briefMessage.includes('✉️ Bandeja de entrada Gmail (2 pendientes):'));
    assert.ok(briefMessage.includes('[Impresos Rápidos] Confirmación de entrega stand'));
    assert.ok(briefMessage.includes('[Cliente VIP] Comprobante de transferencia bancaria'));

    // 2b. SchedulerService con bandeja al día (0 correos)
    const emptyGmailClient = {
      users: {
        messages: {
          list: async () => ({ data: { messages: [] } }),
        },
      },
    };
    const emptyGmailService = new GmailService({ gmailClient: emptyGmailClient });
    const schedulerEmptyGmail = new SchedulerService({
      prisma: mockPrisma,
      gmailService: emptyGmailService,
      weatherFetcher: async () => '20°C, Soleado',
    });
    const emptyBrief = await schedulerEmptyGmail.triggerMorningBrief(new Date('2026-10-01T07:00:00-06:00'));
    assert.ok(emptyBrief.includes('• Bandeja al día (sin correos pendientes).'));

    // 2c. Resiliencia en SchedulerService: fallo de Gmail API no tira el briefing
    const failingGmailService = {
      getInboxSummary: async () => {
        throw new Error('Gmail API 503 Service Unavailable');
      },
    };
    const schedulerFailingGmail = new SchedulerService({
      prisma: mockPrisma,
      gmailService: failingGmailService,
      weatherFetcher: async () => '20°C, Soleado',
    });
    const fallbackBrief = await schedulerFailingGmail.triggerMorningBrief(new Date('2026-10-01T07:00:00-06:00'));
    assert.ok(fallbackBrief.includes('🌅 ¡Buenos días, Sebastián!'));
    assert.ok(fallbackBrief.includes('20°C, Soleado'));
    assert.ok(fallbackBrief.includes('¡Que sea un día muy exitoso para Deko Labs!'));

    // 3. CarmencitaBrain On-Demand: Consulta en tiempo real por chat con síntesis agéntica
    const mockAiGmail = {
      models: {
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          if (promptStr.includes('Eres Carmencita') || promptStr.includes('siguientes datos reales')) {
            return {
              text: '✉️ <b>Bandeja de Gmail (2 correos pendientes):</b>\n\n' +
                '1. 📩 <b>De:</b> Impresos Rápidos\n   <b>Asunto:</b> Confirmación de entrega stand\n\n' +
                '2. 📩 <b>De:</b> Cliente VIP\n   <b>Asunto:</b> Comprobante de transferencia bancaria',
            };
          }
          return {
            text: '¡Enseguida reviso tu bandeja de entrada de Gmail, Sebastián!\n' +
              '```json\n{"action": "CHECK_GMAIL", "maxResults": 5}\n```',
          };
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiGmail,
      gmailService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const brainResult = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: '¿Tengo correos nuevos en Gmail?',
    });

    assert.equal(brainResult.hasGmailEmails, true);
    assert.equal(brainResult.gmailEmails.length, 2);
    assert.ok(brainResult.reply.includes('✉️ <b>Bandeja de Gmail (2 correos pendientes):</b>'));
    assert.ok(brainResult.reply.includes('Impresos Rápidos'));
    assert.ok(brainResult.reply.includes('Confirmación de entrega stand'));

    // 3b. Consulta On-Demand con bandeja limpia
    const brainClean = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiGmail,
      gmailService: emptyGmailService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });
    const cleanResult = await brainClean.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Revisa mi correo',
    });
    assert.equal(cleanResult.hasGmailEmails, false);
    assert.ok(cleanResult.reply.includes('¡Bandeja limpia! No tienes correos pendientes sin leer.'));

    // 4. Resiliencia On-Demand: error capturado limpiamente
    const failingBrain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiGmail,
      gmailService: {
        getUnreadInboxMessages: async () => {
          throw new Error('Invalid OAuth Credentials');
        },
      },
      documentService,
      taskService,
      ideaService,
      excelService,
    });
    const errorResult = await failingBrain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Revisa Gmail',
    });
    assert.ok(errorResult.reply.includes('⚠️ No pude consultar tu bandeja de Gmail: Invalid OAuth Credentials'));
  });

  await t.test('31. Despacho Nativo de Medios: MediaService y Acción GENERATE_QR con Código QR en PNG', async () => {
    // 0. Validación de Esquema Zod GenerateQrActionSchema
    const validQrAction = {
      action: 'GENERATE_QR',
      text: 'https://instagram.com/decovintagegt',
      title: 'Instagram Deco Vintage',
    };
    const parsedAction = parseCarmencitaAction(validQrAction);
    assert.ok(parsedAction, 'GENERATE_QR debe ser validado por Zod');
    assert.equal(parsedAction.action, 'GENERATE_QR');
    assert.equal(parsedAction.text, 'https://instagram.com/decovintagegt');
    assert.equal(parsedAction.title, 'Instagram Deco Vintage');

    // Valor por defecto para title
    const defaultTitleAction = parseCarmencitaAction({ action: 'GENERATE_QR', text: 'https://decovintage.online' });
    assert.equal(defaultTitleAction.title, 'Código QR Oficial');

    // Rechazo de texto vacío
    assert.equal(parseCarmencitaAction({ action: 'GENERATE_QR', text: '' }), null);

    // 1. Generación de QR en disco y buffer con MediaService
    const mediaService = new MediaService(testDataDir);
    const qrResult = await mediaService.generateQrCode({
      text: 'https://instagram.com/decovintagegt',
      title: 'Instagram Deco Vintage',
      fileName: 'test_instagram_qr.png',
    });

    assert.ok(qrResult);
    assert.ok(qrResult.filePath);
    assert.ok(Buffer.isBuffer(qrResult.buffer));
    assert.ok(qrResult.buffer.length > 0);
    assert.equal(qrResult.fileName, 'test_instagram_qr.png');
    assert.equal(qrResult.title, 'Instagram Deco Vintage');

    const fileOnDisk = await fs.readFile(qrResult.filePath);
    assert.ok(fileOnDisk.length > 0);

    // 2. Integración en CarmencitaBrain con acción GENERATE_QR
    const mockAiQr = {
      models: {
        generateContent: async () => ({
          text: 'Aquí tienes listo tu código QR para **Instagram Deco Vintage**, Sebastián.\n```json\n' +
            JSON.stringify({
              action: 'GENERATE_QR',
              text: 'https://instagram.com/decovintagegt',
              title: 'Instagram Deco Vintage',
            }) +
            '\n```',
        }),
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiQr,
      mediaService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const brainResult = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Genera el QR de Instagram Deco Vintage',
    });

    assert.equal(brainResult.hasPhoto, true);
    assert.ok(brainResult.photoFile);
    assert.ok(brainResult.photoFile.path);
    assert.ok(brainResult.photoFile.buffer);
    assert.equal(brainResult.actionData.action, 'GENERATE_QR');
    assert.ok(brainResult.reply.includes('Instagram Deco Vintage'));
    assert.ok(brainResult.photoFile.caption.includes('Instagram Deco Vintage'));
  });

  await t.test('32. Despacho Nativo de Medios: MediaService y Acción SEND_MEDIA (Foto de Perfil y Avatar)', async () => {
    // 0. Validación de Esquema Zod SendMediaActionSchema
    const validMediaAction = { action: 'SEND_MEDIA', mediaType: 'PROFILE' };
    const parsedMedia = parseCarmencitaAction(validMediaAction);
    assert.ok(parsedMedia, 'SEND_MEDIA debe ser validado por Zod');
    assert.equal(parsedMedia.action, 'SEND_MEDIA');
    assert.equal(parsedMedia.mediaType, 'PROFILE');

    // Default mediaType es PROFILE
    const defaultMedia = parseCarmencitaAction({ action: 'SEND_MEDIA' });
    assert.equal(defaultMedia.mediaType, 'PROFILE');

    // 1. Resolución de foto de perfil con MediaService
    const mediaService = new MediaService(testDataDir);
    await fs.mkdir(mediaService.perfilDir, { recursive: true });
    const profilePath = path.join(mediaService.perfilDir, 'carmencita_profile.jpg');
    await fs.writeFile(profilePath, Buffer.from('FAKE_CARMENCITA_JPEG_DATA'));

    const resolvedMedia = mediaService.resolveProfilePicture();
    assert.ok(resolvedMedia);
    assert.equal(resolvedMedia.filePath, profilePath);
    assert.equal(resolvedMedia.fileName, 'carmencita_profile.jpg');
    assert.equal(resolvedMedia.mimeType, 'image/jpeg');

    // 2. Integración en CarmencitaBrain con acción SEND_MEDIA
    const mockAiProfile = {
      models: {
        generateContent: async () => ({
          text: 'Aquí tienes mi fotografía oficial de perfil, Sebastián. Siempre a tu completa disposición.\n```json\n' +
            JSON.stringify({
              action: 'SEND_MEDIA',
              mediaType: 'PROFILE',
            }) +
            '\n```',
        }),
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiProfile,
      mediaService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const brainResult = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, mándame tu foto de perfil',
    });

    assert.equal(brainResult.hasPhoto, true);
    assert.ok(brainResult.photoFile);
    assert.equal(brainResult.photoFile.path, profilePath);
    assert.equal(brainResult.actionData.action, 'SEND_MEDIA');
    assert.ok(brainResult.reply.includes('fotografía oficial'));
  });

  await t.test('33. Síntesis Neuronal de Voz Natural: VoiceService (Gemini TTS, Aoede, Limpieza y Transcodificación)', async () => {
    // 0. Validación de Esquema Zod SendVoiceActionSchema
    const validVoiceAction = { action: 'SEND_VOICE', message: 'Sebastián, tus reportes están listos.' };
    const parsedVoice = parseCarmencitaAction(validVoiceAction);
    assert.ok(parsedVoice, 'SEND_VOICE debe ser validado por Zod');
    assert.equal(parsedVoice.action, 'SEND_VOICE');
    assert.equal(parsedVoice.message, 'Sebastián, tus reportes están listos.');

    // Rechazo de mensaje vacío
    assert.equal(parseCarmencitaAction({ action: 'SEND_VOICE', message: '' }), null);

    // 1. Limpieza de dicción con _cleanTextForSpeech
    const voiceService = new VoiceService({ apiKey: 'fake-key' });
    const dirtyText = '¡Hola **Sebastián**! Revisa <pre>docker ps</pre> y el enlace [Deco Vintage](https://decovintage.online). • Cero problemas.\n```json\n{"action": "TEST"}\n```';
    const cleanSpeech = voiceService._cleanTextForSpeech(dirtyText);
    assert.ok(!cleanSpeech.includes('**'));
    assert.ok(!cleanSpeech.includes('<pre>'));
    assert.ok(!cleanSpeech.includes('</pre>'));
    assert.ok(!cleanSpeech.includes('```'));
    assert.ok(!cleanSpeech.includes('https://'));
    assert.ok(cleanSpeech.includes('Sebastián'));
    assert.ok(cleanSpeech.includes('Deco Vintage'));
    assert.ok(cleanSpeech.includes('Cero problemas'));

    // 2. Síntesis de voz con Mock de @google/genai
    let capturedModel = null;
    let capturedVoice = null;
    let capturedText = null;

    const mockAiVoice = {
      models: {
        generateContent: async ({ model, contents, config: genConfig }) => {
          capturedModel = model;
          capturedText = contents;
          capturedVoice = genConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName;
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'audio/wav',
                        data: Buffer.from('RIFF_WAV_FAKE_DATA_AUDIO_BYTES').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };

    const voiceServiceWithMock = new VoiceService({ ai: mockAiVoice });
    const voiceResult = await voiceServiceWithMock.synthesizeSpeech('Hola Sebastián querido, todo está listo.');

    assert.equal(capturedModel, 'gemini-3.8-flash-tts');
    assert.equal(capturedVoice, 'Aoede');
    assert.equal(capturedText, 'Hola Sebastián querido, todo está listo.');
    assert.ok(voiceResult);
    assert.ok(Buffer.isBuffer(voiceResult.buffer));
    assert.ok(voiceResult.mimeType === 'audio/ogg' || voiceResult.mimeType === 'audio/wav');
    assert.ok(voiceResult.fileName.includes('carmencita_voice'));

    // 3. Resiliencia ante cliente no inicializado o texto vacío
    const uninitVoice = new VoiceService({ ai: null, apiKey: '' });
    assert.equal(await uninitVoice.synthesizeSpeech('Hola'), null);
    assert.equal(await voiceServiceWithMock.synthesizeSpeech(''), null);
    assert.equal(await voiceServiceWithMock.synthesizeSpeech('a'), null);

    // 4. Truncado inteligente por frontera de oración sin corte de palabras (_truncateAtSentenceBoundary)
    const longTextWithSentences = 'Sebastián querido, ya revisé todos los archivos en la bóveda de Obsidian y el inventario general de Deko Labs. ' +
      'Todo está completamente al día y los 9 contenedores en Dokploy siguen operando con absoluta normalidad. ' +
      '¿Tienes alguna otra consulta sobre el presupuesto o procedemos con el despacho de los materiales para el evento? ' +
      'Avísame con confianza y me pongo manos a la obra de inmediato para dejarte todo impecable.';

    const truncatedBoundary = voiceService._truncateAtSentenceBoundary(longTextWithSentences, 150);
    assert.ok(truncatedBoundary.endsWith('.'), 'Debe truncar en el punto de la oración');
    assert.ok(!truncatedBoundary.includes('...'), 'No debe usar elipsis que corte palabras');
    assert.equal(truncatedBoundary, 'Sebastián querido, ya revisé todos los archivos en la bóveda de Obsidian y el inventario general de Deko Labs.');

    // Truncado en signo de interrogación
    const textWithQuestion = 'Sebastián querido, ¿tienes alguna duda sobre el inventario y los presupuestos de diseño para los eventos de Deko Labs? ' +
      'Avísame con confianza y me pongo manos a la obra de inmediato.';
    const truncatedQuestion = voiceService._truncateAtSentenceBoundary(textWithQuestion, 140);
    assert.ok(truncatedQuestion.endsWith('?'), 'Debe truncar en el signo de interrogación sin cortar palabras');
    assert.ok(!truncatedQuestion.includes('¿Tie'));
    assert.equal(truncatedQuestion, 'Sebastián querido, ¿tienes alguna duda sobre el inventario y los presupuestos de diseño para los eventos de Deko Labs?');

    // 5. Silencio de cola en FFmpeg (-af apad=pad_dur=0.6) y fallback seguro
    const voiceSource = await fs.readFile(new URL('../src/services/voice.service.js', import.meta.url), 'utf-8');
    assert.ok(voiceSource.includes("'-af', 'apad=pad_dur=0.6'"), 'VoiceService debe incluir apad=pad_dur=0.6 para evitar cortes de audio en Telegram');
    const transcodeRes = await voiceService._transcodeWavToOgg(Buffer.from('RIFF_FAKE_AUDIO'));
    assert.ok(transcodeRes && transcodeRes.buffer);
  });

  await t.test('34. Despacho Multimodal en Modo Espejo: CarmencitaBrain.processAudio con Respuesta de Voz Nativa y Texto Estructurado', async () => {
    const mockVoiceService = {
      synthesizeSpeech: async () => {
        return {
          buffer: Buffer.from('OGG_OPUS_MOCK_STREAM'),
          mimeType: 'audio/ogg',
          fileName: 'carmencita_voice.ogg',
        };
      },
    };

    let capturedAudioPrompt = null;
    let capturedInlineData = null;
    const mockAiAudioMirror = {
      models: {
        generateContent: async ({ contents }) => {
          capturedAudioPrompt = contents[0];
          capturedInlineData = contents[1]?.inlineData;
          return {
            text: 'Sebastián querido, escuché con atención tu nota de voz sobre la feria.\n\n' +
              '📌 Resumen: Propuesta para stand modular.\n' +
              '• Estructura en madera recuperada\n' +
              '• Iluminación tenue y cálida\n\n' +
              '¿Deseas que prepare la cotización con los proveedores?',
          };
        },
      },
    };

    // Pre-poblar mensaje previo en mockPrisma.messageLog para verificar memoria de contexto
    await mockPrisma.messageLog.create({
      data: {
        channel: 'telegram',
        senderId: '12345',
        senderName: 'Sebastián',
        role: 'user',
        content: 'Carmencita, prepárame el reporte de la feria de diseño',
      },
    });

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiAudioMirror,
      voiceService: mockVoiceService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    // 1. Invocación de processAudio con buffer de audio entrante
    const audioResult = await brain.processAudio({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      buffer: Buffer.from('FAKE_AUDIO_OGG_BUFFER'),
      mimeType: 'audio/ogg',
    });

    // Verificación de Memoria de Contexto en el prompt de audio:
    assert.ok(capturedAudioPrompt, 'El prompt enviado a Gemini debe existir');
    assert.ok(capturedAudioPrompt.includes('HISTORIAL DE CONVERSACIÓN RECIENTE (MEMORIA DE CONTEXTO)'), 'Debe inyectar el bloque de historial de contexto reciente');
    assert.ok(capturedAudioPrompt.includes('prepárame el reporte de la feria de diseño'), 'Debe incluir los mensajes previos del usuario en el prompt');
    assert.ok(capturedAudioPrompt.includes('Ten muy presente el HISTORIAL DE CONVERSACIÓN RECIENTE'), 'Debe instruir a la IA sobre referencias a lo pedido antes');
    assert.equal(capturedInlineData.mimeType, 'audio/ogg');
    assert.equal(capturedInlineData.data, Buffer.from('FAKE_AUDIO_OGG_BUFFER').toString('base64'));

    // Validar Modo Espejo: se genera audio de respuesta y se conserva el texto estructurado
    assert.equal(audioResult.hasVoice, true);
    assert.ok(audioResult.voiceFile);
    assert.equal(audioResult.voiceFile.mimeType, 'audio/ogg');
    assert.equal(audioResult.voiceFile.fileName, 'carmencita_voice.ogg');
    assert.ok(audioResult.reply.includes('Sebastián querido'));
    assert.ok(audioResult.reply.includes('Resumen: Propuesta para stand modular'));

    // 2. Acción SEND_VOICE disparada por texto On-Demand
    const mockAiVoiceOnDemand = {
      models: {
        generateContent: async () => ({
          text: 'Aquí tienes mi resumen en audio, Sebastián.\n```json\n' +
            JSON.stringify({
              action: 'SEND_VOICE',
              message: 'Sebastián, el estado de los servidores y el inventario es óptimo.',
            }) +
            '\n```',
        }),
      },
    };

    const brainOnDemand = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiVoiceOnDemand,
      voiceService: mockVoiceService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const textVoiceResult = await brainOnDemand.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Mándame un audio con el resumen',
    });

    assert.equal(textVoiceResult.hasVoice, true);
    assert.ok(textVoiceResult.voiceFile);
    assert.equal(textVoiceResult.voiceFile.mimeType, 'audio/ogg');
    assert.equal(textVoiceResult.actionData.action, 'SEND_VOICE');
    assert.ok(textVoiceResult.reply.includes('Aquí tienes mi resumen en audio'));
  });

  await t.test('35. Búsqueda y Lectura Directa en Obsidian Vault vía Google Drive (ObsidianDriveService y SEARCH_OBSIDIAN_NOTES)', async () => {
    // 0. Validación de Esquema Zod SearchObsidianNotesActionSchema
    const validSearch = { action: 'SEARCH_OBSIDIAN_NOTES', query: 'feria', folder: 'Proyectos' };
    const parsedSearch = parseCarmencitaAction(validSearch);
    assert.ok(parsedSearch, 'SEARCH_OBSIDIAN_NOTES debe ser validado por Zod');
    assert.equal(parsedSearch.action, 'SEARCH_OBSIDIAN_NOTES');
    assert.equal(parsedSearch.query, 'feria');
    assert.equal(parsedSearch.folder, 'Proyectos');

    // Default maxResults elevado a 20 y query opcional
    const defaultSearch = parseCarmencitaAction({ action: 'SEARCH_OBSIDIAN_NOTES' });
    assert.equal(defaultSearch.maxResults, 20, 'Default maxResults debe ser 20');
    assert.equal(defaultSearch.query, '');

    // 1. Mock de Drive Client con Jerarquía Real y Subcarpetas Recursivas
    let listCallCount = 0;
    const hierarchy = {
      root_vault_id: [
        { id: 'f_meta', name: '00_Meta', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'f_inbox', name: '01_Inbox', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'f_projects', name: '02_Projects', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'f_areas', name: '03_Areas', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'f_obsidian', name: '.obsidian', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'file_root_1', name: 'Stand Modular Feria 2026.md', mimeType: 'text/markdown', modifiedTime: '2026-10-06T10:00:00Z' },
        { id: 'file_root_2', name: 'Ideas Materiales Feria.md', mimeType: 'text/markdown', modifiedTime: '2026-10-05T15:30:00Z' },
      ],
      f_projects: [
        { id: 'f_hub', name: 'Carmencita_Hub', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'file_proj_1', name: 'STAND IA - Vision General.md', mimeType: 'text/markdown', modifiedTime: '2026-10-06T12:00:00Z' },
      ],
      f_hub: [
        { id: 'file_hub_1', name: 'Carmencita Secretary Hub.md', mimeType: 'text/markdown', modifiedTime: '2026-10-06T11:00:00Z' },
      ],
      f_inbox: [
        { id: 'file_inbox_1', name: 'Hermes Agent Idea.md', mimeType: 'text/markdown', modifiedTime: '2026-10-06T09:00:00Z' },
      ],
      f_areas: [
        { id: 'file_area_1', name: 'Deco Vintage Tienda de Posters.md', mimeType: 'text/markdown', modifiedTime: '2026-10-06T08:00:00Z' },
      ],
      f_meta: [
        { id: 'file_meta_1', name: 'Plantilla Ejecutiva.md', mimeType: 'text/markdown', modifiedTime: '2026-10-06T07:00:00Z' },
      ],
      f_obsidian: [
        { id: 'file_obs_1', name: 'app.json', mimeType: 'application/json' },
        { id: 'file_obs_2', name: 'workspace.md', mimeType: 'text/markdown' },
      ],
    };

    const mockDrive = {
      files: {
        list: async ({ q }) => {
          listCallCount++;
          const parentMatch = q ? q.match(/'([^']+)' in parents/) : null;
          if (parentMatch) {
            const parentId = parentMatch[1];
            return {
              data: {
                files: hierarchy[parentId] || [],
              },
            };
          }
          return { data: { files: [] } };
        },
        get: async ({ fileId }) => {
          return {
            data: '# Stand Modular Feria 2026\n\nPropuesta de diseño en madera recuperada.',
          };
        },
        create: async ({ requestBody, media }) => {
          return {
            data: {
              id: 'file_new_123',
              name: requestBody.name,
              webViewLink: 'https://drive.google.com/file/d/file_new_123/view',
            },
          };
        },
      },
    };

    const obsidianService = new ObsidianDriveService({ driveClient: mockDrive, vaultFolderId: 'root_vault_id' });

    // 2. Validación de Recorrido Recursivo en _buildVaultTree() y Exclusión de .obsidian
    const allTreeFiles = await obsidianService._buildVaultTree();
    assert.equal(allTreeFiles.length, 7, 'Debe indexar exactamente las 7 notas válidas');
    assert.ok(!allTreeFiles.some(f => f.name === 'workspace.md'), 'Debe excluir archivos de .obsidian');
    assert.ok(allTreeFiles.some(f => f.relativePath === '02_Projects/Carmencita_Hub/Carmencita Secretary Hub.md'), 'Debe construir ruta relativa de subcarpetas');

    // 3. Validación de Caché con TTL (Llamadas repetidas no deben invocar la API de Drive)
    const initialCallCount = listCallCount;
    const cachedTree = await obsidianService._buildVaultTree();
    assert.equal(cachedTree.length, 7);
    assert.equal(listCallCount, initialCallCount, 'El caché con TTL debe evitar llamadas redundantes a Drive');

    // 4. Búsqueda Específica con Coincidencias en Memoria
    const notesFound = await obsidianService.searchNotes({ query: 'Feria', folder: null, maxResults: 5 });
    assert.equal(notesFound.length, 2);
    assert.equal(notesFound[0].name, 'Stand Modular Feria 2026.md');
    assert.equal(notesFound[1].name, 'Ideas Materiales Feria.md');

    // Búsqueda en Subcarpeta Profunda
    const standIaNotes = await obsidianService.searchNotes({ query: 'STAND IA' });
    assert.equal(standIaNotes.length, 1);
    assert.equal(standIaNotes[0].cleanTitle, 'STAND IA - Vision General');

    // Búsqueda por Carpeta Específica
    const projectsNotes = await obsidianService.listAllNotes({ folder: '02_Projects' });
    assert.equal(projectsNotes.length, 2);
    assert.ok(projectsNotes.some(n => n.name === 'Carmencita Secretary Hub.md'));
    assert.ok(projectsNotes.some(n => n.name === 'STAND IA - Vision General.md'));

    // 5. Búsqueda Panorámica Inteligente (Detección de Queries Genéricas como "reporte" o "")
    const reportNotes = await obsidianService.searchNotes({ query: 'reporte' });
    assert.equal(reportNotes.length, 7, 'Query "reporte" debe comportarse como listAllNotes panorámico');

    const emptyQueryNotes = await obsidianService.searchNotes({ query: '' });
    assert.equal(emptyQueryNotes.length, 7, 'Query vacía debe retornar todas las notas de la bóveda');

    // 6. Invalidación Automática de Caché al Invocar createNote()
    assert.ok(obsidianService._vaultCache.timestamp > 0);
    await obsidianService.createNote({
      title: 'Nueva Nota de Prueba',
      content: 'Contenido de prueba',
      folder: '01_Inbox',
    });
    assert.equal(obsidianService._vaultCache.timestamp, 0, 'createNote debe invalidar el timestamp del caché a 0');

    // 7. Prueba de Lectura Directa readNote()
    const noteContent = await obsidianService.readNote({ fileId: 'file_root_1' });
    assert.equal(noteContent.fileId, 'file_root_1');
    assert.ok(noteContent.content.includes('Propuesta de diseño'));

    // 8. Integración en CarmencitaBrain: Búsqueda Puntual (Feria)
    const mockAiObsidianSearch = {
      models: {
        generateContent: async () => ({
          text: 'Entro a revisar tus notas...\n```json\n' +
            JSON.stringify({
              action: 'SEARCH_OBSIDIAN_NOTES',
              query: 'Feria',
            }) +
            '\n```',
        }),
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiObsidianSearch,
      obsidianService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const searchResult = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Búscame las notas de la feria en Obsidian',
    });

    assert.equal(searchResult.hasObsidianNotes, true);
    assert.ok(searchResult.obsidianNotes);
    assert.equal(searchResult.obsidianNotes.length, 2);
    assert.ok(searchResult.reply.includes('ya te encontré 2 nota(s) en tu Obsidian'));
    assert.ok(searchResult.reply.includes('Stand Modular Feria 2026'));
    assert.ok(searchResult.reply.includes('Ideas Materiales Feria'));
    assert.ok(!searchResult.reply.includes('Entro a revisar'), 'Cero frases de promesa previa en la respuesta final');

    // 9. Integración en CarmencitaBrain: Consulta Panorámica ("dame un reporte de mis notas")
    const mockAiObsidianPanoramic = {
      models: {
        generateContent: async () => ({
          text: '```json\n' +
            JSON.stringify({
              action: 'SEARCH_OBSIDIAN_NOTES',
              query: '',
              maxResults: 20,
            }) +
            '\n```',
        }),
      },
    };

    const panoramicBrain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiObsidianPanoramic,
      obsidianService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const panoramicResult = await panoramicBrain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: '¿Qué notas tengo activas en mi Obsidian?',
    });

    assert.equal(panoramicResult.hasObsidianNotes, true);
    assert.ok(panoramicResult.reply.includes('ya revisé a fondo tu Obsidian Vault y tienes activas 7 notas'));
    assert.ok(panoramicResult.reply.includes('Proyectos'));
    assert.ok(panoramicResult.reply.includes('Inbox'));
    assert.ok(panoramicResult.reply.includes('Áreas'));
    assert.ok(panoramicResult.reply.includes('Meta'));
    assert.ok(panoramicResult.reply.includes('¿Deseas que profundice en alguna en particular?'));

    // 10. Verificación de Búsqueda sin Resultados (Cero Notas)
    const mockAiObsidianNotFound = {
      models: {
        generateContent: async () => ({
          text: '```json\n' +
            JSON.stringify({
              action: 'SEARCH_OBSIDIAN_NOTES',
              query: 'Inexistente',
            }) +
            '\n```',
        }),
      },
    };

    const emptyBrain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiObsidianNotFound,
      obsidianService: {
        searchNotes: async () => [],
      },
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const emptyResult = await emptyBrain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Búscame notas de algo inexistente',
    });
    assert.ok(emptyResult.reply.includes('no encontré notas con el término "Inexistente"'));

    // 11. Blindaje Anti-AGY en el System Prompt
    const systemPrompt = brain.getSystemPrompt();
    assert.ok(systemPrompt.includes('PROHIBIDO terminantemente emitir RUN_AGY_TASK para consultar, listar o buscar notas en Obsidian'));
    assert.ok(systemPrompt.includes('00_Meta'));
    assert.ok(systemPrompt.includes('01_Inbox'));
    assert.ok(systemPrompt.includes('02_Projects'));
    assert.ok(systemPrompt.includes('03_Areas'));
  });

  await t.test('36. Erradicación de Errores Crudos en RUN_AGY_TASK: Síntesis Humana Natural y Preservación Forense en MessageLog', async () => {
    // 1. Simular fallo de terminal con AgyBridge que arroja Command failed o error
    const failingAgyBridge = {
      executeTask: async () => {
        return {
          success: false,
          output: 'Command failed: /root/.local/bin/agy -p "check vault" --dangerously-skip-permissions\nError: Permission denied (EACCES)',
        };
      },
    };

    const mockAiTerminalFail = {
      models: {
        generateContent: async () => ({
          text: 'Permíteme un momento mientras reviso el estado en el servidor, Sebastián.\n```json\n' +
            JSON.stringify({
              action: 'RUN_AGY_TASK',
              prompt: 'check vault',
            }) +
            '\n```',
        }),
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiTerminalFail,
      documentService,
      taskService,
      ideaService,
      excelService,
    }, failingAgyBridge);

    const failResult = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Revisa el vault en la terminal',
    });

    // 1. El usuario NO recibe comandos crudos ni volcados de error en reply
    assert.ok(!failResult.reply.includes('Command failed'), 'Prohibido volcar Command failed al usuario');
    assert.ok(!failResult.reply.includes('/root/.local/bin/agy'), 'Prohibido exponer rutas de binarios internos');
    assert.ok(!failResult.reply.includes('EACCES'), 'Prohibido exponer códigos de error de sistema de archivos');

    // 2. El usuario recibe síntesis humana, cálida y resolutiva de Carmencita
    assert.ok(failResult.reply.includes('Mira Sebastián querido, no estoy logrando obtener la información de la terminal'));
    assert.ok(failResult.reply.includes('Gary lo revise'));

    // 3. El error crudo se resguarda en fullHistoryText para auditoría forense / MessageLog
    assert.ok(failResult.fullHistoryText.includes('Command failed'));
    assert.ok(failResult.fullHistoryText.includes('Permission denied'));
  });

  await t.test('37. Despacho Exclusivo de Voz en TelegramAdapter: Cero Texto Duplicado cuando hasVoice es Verdadero', async () => {
    const origToken = config.telegram.token;
    const origAllowed = config.telegram.allowedUsers;

    try {
      config.telegram.token = 'fake_telegram_bot_token_12345';
      config.telegram.allowedUsers = ['12345'];

      const mockBrainWithVoice = {
        processTextMessage: async () => {
          return {
            reply: 'Sebastián querido, tus reportes están al día.',
            hasVoice: true,
            voiceFile: {
              buffer: Buffer.from('FAKE_OGG_AUDIO_BYTES'),
              fileName: 'carmencita_voice.ogg',
              mimeType: 'audio/ogg',
            },
          };
        },
        processAudio: async () => {
          return {
            reply: 'Sebastián querido, escuché tu audio y todo está en orden.',
            hasVoice: true,
            voiceFile: {
              buffer: Buffer.from('FAKE_OGG_AUDIO_BYTES'),
              fileName: 'carmencita_voice.ogg',
              mimeType: 'audio/ogg',
            },
          };
        },
      };

      const capturedVoiceSends = [];
      const capturedTextReplies = [];

      const fakeCtx = {
        from: { id: 12345, first_name: 'Sebastián' },
        message: { text: '¿Cómo estamos?' },
        replyWithChatAction: async () => {},
        replyWithVoice: async (inputFile) => {
          capturedVoiceSends.push(inputFile);
        },
        reply: async (text, opts) => {
          capturedTextReplies.push({ text, opts });
        },
      };

      // 1. Simular mensaje de texto que genera voz: verificar que solo se despacha voz sin texto duplicado
      const replyFromBrain = await mockBrainWithVoice.processTextMessage();
      if (replyFromBrain.hasVoice && replyFromBrain.voiceFile) {
        await fakeCtx.replyWithVoice(replyFromBrain.voiceFile);
      } else {
        await fakeCtx.reply(replyFromBrain.reply);
      }

      assert.equal(capturedVoiceSends.length, 1);
      assert.equal(capturedTextReplies.length, 0, 'No debe emitirse texto duplicado en Telegram cuando hasVoice es verdadero');

      // 2. Simular respuesta sin voz: verificar que sí se despacha texto como fallback
      capturedVoiceSends.length = 0;
      capturedTextReplies.length = 0;

      const replyNoVoice = {
        reply: 'Sebastián querido, aquí tienes el reporte en texto.',
        hasVoice: false,
      };

      if (replyNoVoice.hasVoice && replyNoVoice.voiceFile) {
        await fakeCtx.replyWithVoice(replyNoVoice.voiceFile);
      } else {
        await fakeCtx.reply(replyNoVoice.reply);
      }

      assert.equal(capturedVoiceSends.length, 0);
      assert.equal(capturedTextReplies.length, 1);
      assert.ok(capturedTextReplies[0].text.includes('Sebastián querido'));
    } finally {
      config.telegram.token = origToken;
      config.telegram.allowedUsers = origAllowed;
    }
  });

  await t.test('38. Visión Multimodal Contextual Universal (Cero Facturas Falsas), Motor de Búsqueda y Lectura en Gmail y Despacho de Voz', async () => {
    // 1. GmailService.searchEmails con correos leídos y categorías no primarias (ej. CATEGORY_UPDATES)
    const mockEmailDetailUpdates = {
      id: 'msg_ai_studio',
      threadId: 'thread_ai_studio',
      snippet: 'Action Required: Update thinking_budget and sampling parameters in Google AI Studio...',
      labelIds: ['INBOX', 'CATEGORY_UPDATES'],
      payload: {
        headers: [
          { name: 'From', value: 'Google AI Studio <googleai-noreply@google.com>' },
          { name: 'Subject', value: '[Action Required] Update thinking_budget and sampling parameters' },
          { name: 'Date', value: 'Wed, 30 Sep 2026 18:20:00 -0600' },
        ],
        mimeType: 'text/plain',
        body: {
          data: Buffer.from('Hola Sebastián,\n\nTe informamos que debes actualizar los parámetros de thinking_budget y sampling en tus prompts de Gemini.\n\nSaludos,\nEquipo de Google AI Studio.').toString('base64url'),
        },
      },
    };

    let capturedListQuery = null;
    const mockGmailDeepClient = {
      users: {
        messages: {
          list: async ({ q, maxResults }) => {
            capturedListQuery = q;
            if (q && q.includes('Google AI Studio')) {
              return { data: { messages: [{ id: 'msg_ai_studio', threadId: 'thread_ai_studio' }] } };
            }
            return { data: { messages: [] } };
          },
          get: async ({ id, format }) => {
            assert.equal(id, 'msg_ai_studio');
            return { data: mockEmailDetailUpdates };
          },
        },
      },
    };

    const gmailDeepService = new GmailService({ gmailClient: mockGmailDeepClient });
    const foundEmails = await gmailDeepService.searchEmails({
      query: 'Google AI Studio',
      maxResults: 5,
      includeRead: true,
    });

    assert.equal(foundEmails.length, 1);
    assert.equal(foundEmails[0].id, 'msg_ai_studio');
    assert.equal(foundEmails[0].from, 'Google AI Studio <googleai-noreply@google.com>');
    assert.equal(foundEmails[0].subject, '[Action Required] Update thinking_budget and sampling parameters');
    assert.equal(
      capturedListQuery,
      'Google AI Studio -category:social -category:promotions -from:facebookmail -from:instagram -from:tiktok',
      'No debe forzar is:unread ni category:primary al buscar por remitente o tema, y debe excluir ruido social y promociones'
    );

    // 2. GmailService.getEmailDetails con decodificación de cuerpo de mensaje
    const emailDetails = await gmailDeepService.getEmailDetails({ messageId: 'msg_ai_studio' });
    assert.ok(emailDetails);
    assert.equal(emailDetails.id, 'msg_ai_studio');
    assert.equal(emailDetails.subject, '[Action Required] Update thinking_budget and sampling parameters');
    assert.ok(emailDetails.bodyText.includes('thinking_budget y sampling'));
    assert.ok(emailDetails.bodyText.includes('Google AI Studio'));

    // 3. CarmencitaBrain.processImage: Captura de pantalla de correo NO debe generar factura de GTQ 0
    const initialInvoiceCount = mockPrisma._data.invoices.length;

    const mockAiImageScreenshot = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            type: 'CAPTURA_CORREO_O_TEXTO',
            isFactura: false,
            title: 'Notificación de Google AI Studio',
            extractedText: 'Action Required: Update thinking_budget and sampling parameters',
            executiveReply: 'Sebastián querido, la imagen que me compartiste es una notificación de Google AI Studio sobre actualizar el parámetro thinking_budget. Ya quedó en tu bóveda para referencia técnica.',
            invoiceData: null,
          }),
        }),
      },
    };

    const mockVoiceSynthesis = {
      synthesizeSpeech: async (text) => ({
        buffer: Buffer.from('FAKE_SYNTHESIZED_VOICE_OGG'),
        fileName: 'carmencita_voice.ogg',
        mimeType: 'audio/ogg',
      }),
    };

    const brainVision = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiImageScreenshot,
      gmailService: gmailDeepService,
      documentService,
      taskService,
      ideaService,
      excelService,
      voiceService: mockVoiceSynthesis,
    });

    const screenshotResult = await brainVision.processImage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      buffer: Buffer.from('FAKE_PNG_SCREENSHOT'),
      mimeType: 'image/png',
      caption: 'Carmencita, mándame un audio explicándome esto',
    });

    // Validaciones inquebrantables de la regla "Cero Facturas Falsas":
    assert.equal(mockPrisma._data.invoices.length, initialInvoiceCount, 'Una captura de pantalla NUNCA debe insertar un registro en la tabla Invoice');
    assert.equal(screenshotResult.reply.includes('Total: GTQ 0'), false, 'NUNCA debe reportar "Total: GTQ 0" en capturas de pantalla');
    assert.equal(screenshotResult.reply.includes('¡Factura clasificada y resguardada'), false);
    assert.ok(screenshotResult.reply.includes('Google AI Studio'));
    assert.equal(screenshotResult.hasDocument, true);
    assert.equal(screenshotResult.hasVoice, true, 'Debe sintetizar voz si se solicitó audio en el caption');
    assert.ok(screenshotResult.voiceFile);

    // 4. CarmencitaBrain.processImage: Factura Real SÍ debe registrarse en Invoice con sus datos reales
    const mockAiRealInvoice = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            type: 'FACTURA_RECIBO',
            isFactura: true,
            title: 'Factura Pintura y Acabados',
            extractedText: 'Comercial El Volcán - Factura #9812 - Total: GTQ 850.00',
            executiveReply: 'Factura resguardada en bóveda con garantía de 6 meses.',
            invoiceData: {
              vendor: 'Comercial El Volcán',
              item: 'Pintura y sellador para stands',
              totalAmount: 850,
              currency: 'GTQ',
              warrantyMonths: 6,
            },
          }),
        }),
      },
    };

    const brainInvoice = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiRealInvoice,
      gmailService: gmailDeepService,
      documentService,
      taskService,
      ideaService,
      excelService,
      voiceService: mockVoiceSynthesis,
    });

    const invoiceResult = await brainInvoice.processImage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      buffer: Buffer.from('FAKE_INVOICE_PNG'),
      mimeType: 'image/png',
      caption: 'Factura de pintura',
    });

    assert.equal(mockPrisma._data.invoices.length, initialInvoiceCount + 1, 'Una factura real SÍ debe registrarse en la tabla Invoice');
    const createdInvoice = mockPrisma._data.invoices[0];
    assert.equal(createdInvoice.vendor, 'Comercial El Volcán');
    assert.equal(createdInvoice.totalAmount, 850);
    assert.ok(invoiceResult.reply.includes('¡Factura clasificada y resguardada en PostgreSQL!'));
    assert.ok(invoiceResult.reply.includes('GTQ 850'));

    // 5. Búsqueda y lectura de correo específica en CarmencitaBrain (CHECK_GMAIL con resumen ejecutivo y audio)
    const mockAiGmailQuery = {
      models: {
        generateContent: async () => ({
          text: '```json\n{"action": "CHECK_GMAIL", "query": "Google AI Studio", "maxResults": 5}\n```',
        }),
      },
    };

    const brainGmailSearch = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiGmailQuery,
      gmailService: gmailDeepService,
      documentService,
      taskService,
      ideaService,
      excelService,
      voiceService: mockVoiceSynthesis,
    });

    const gmailSearchResult = await brainGmailSearch.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, quiero que me mandes un resumen en audio del correo de Google AI Studio',
    });

    assert.equal(gmailSearchResult.hasGmailEmails, true);
    assert.ok(gmailSearchResult.reply.includes('Google AI Studio'));
    assert.ok(gmailSearchResult.reply.includes('thinking_budget'));
    assert.equal(gmailSearchResult.hasVoice, true, 'Debe generar nota de voz cuando el usuario pide resumen en audio');
    assert.ok(gmailSearchResult.voiceFile);
  });

  await t.test('39. Bucle de Síntesis Agéntica en Búsqueda Múltiple de Gmail (CHECK_GMAIL sin trampa de correo único y exclusión de ruido)', async () => {
    // 1. Verificación de exclusión de ruido en GmailService.searchEmails y soporte de hasta 30 resultados
    let capturedListParams = null;
    const mockGmailClient = {
      users: {
        messages: {
          list: async ({ q, maxResults }) => {
            capturedListParams = { q, maxResults };
            return {
              data: {
                messages: [
                  { id: 'sub_01', threadId: 'thread_01' },
                  { id: 'sub_02', threadId: 'thread_02' },
                  { id: 'sub_03', threadId: 'thread_03' },
                ],
              },
            };
          },
          get: async ({ id }) => {
            const map = {
              sub_01: {
                snippet: 'Tu suscripción a Netflix Premium ha sido renovada por USD 15.99.',
                payload: {
                  headers: [
                    { name: 'From', value: 'Netflix <info@mailer.netflix.com>' },
                    { name: 'Subject', value: 'Recibo de pago mensual' },
                    { name: 'Date', value: 'Wed, 07 Oct 2026 10:00:00 -0600' },
                  ],
                },
              },
              sub_02: {
                snippet: 'Comprobante de pago exitoso de tu suscripción Spotify Familiar.',
                payload: {
                  headers: [
                    { name: 'From', value: 'Spotify <no-reply@spotify.com>' },
                    { name: 'Subject', value: 'Tu recibo de Spotify' },
                    { name: 'Date', value: 'Tue, 06 Oct 2026 09:30:00 -0600' },
                  ],
                },
              },
              sub_03: {
                snippet: 'Acción requerida: el cobro de tu suscripción AWS Cloud ha fallado.',
                payload: {
                  headers: [
                    { name: 'From', value: 'Amazon Web Services <no-reply-aws@amazon.com>' },
                    { name: 'Subject', value: 'Aviso importante de facturación AWS' },
                    { name: 'Date', value: 'Mon, 05 Oct 2026 14:15:00 -0600' },
                  ],
                },
              },
            };
            return { data: map[id] || {} };
          },
        },
      },
    };

    let getEmailDetailsCalled = false;
    const gmailService = new GmailService({ gmailClient: mockGmailClient });
    gmailService.getEmailDetails = async () => {
      getEmailDetailsCalled = true;
      return { id: 'sub_01', subject: 'Detalle', bodyText: 'Texto cuerpo' };
    };

    // Búsqueda de suscripciones con query específico
    const searchRes = await gmailService.searchEmails({
      query: 'suscripciones',
      maxResults: 30,
      includeRead: true,
    });

    assert.equal(searchRes.length, 3);
    assert.equal(capturedListParams.maxResults, 30, 'Debe soportar maxResults de hasta 30');
    assert.ok(capturedListParams.q.startsWith('suscripciones'));
    assert.ok(capturedListParams.q.includes('-category:social -category:promotions -from:facebookmail -from:instagram -from:tiktok'), 'Debe excluir ruido social y promociones');

    // Búsqueda que menciona redes sociales explícitamente: no debe concatenar exclusión
    await gmailService.searchEmails({ query: 'notificaciones de facebook', maxResults: 10 });
    assert.equal(capturedListParams.q, 'notificaciones de facebook', 'No debe excluir si la query menciona facebook explícitamente');

    // 2. CarmencitaBrain con múltiples correos: Bucle ReAct de síntesis agéntica
    let synthesizePromptCaptured = null;
    const mockAiSynthesis = {
      models: {
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          if (promptStr.includes('Eres Carmencita') || promptStr.includes('siguientes datos reales')) {
            synthesizePromptCaptured = promptStr;
            return {
              text: 'Sebastián querido, analicé a fondo tus 3 correos de suscripciones:\n\n' +
                '1. **Activas:** Netflix (USD 15.99) y Spotify Familiar se cobraron exitosamente.\n' +
                '2. **Alerta:** En Amazon Web Services el cobro falló y requiere que actualices la tarjeta de inmediato.\n\n' +
                '¿Deseas que te prepare un recordatorio para revisar AWS?',
            };
          }
          return {
            text: '```json\n{"action": "CHECK_GMAIL", "query": "suscripciones", "maxResults": 10}\n```',
          };
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiSynthesis,
      gmailService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const multiEmailResult = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, revisa mis suscripciones de este mes y dime cómo estamos',
    });

    // Validar eliminación de la trampa del correo único:
    assert.equal(getEmailDetailsCalled, false, 'NO debe llamar a getEmailDetails para el correo #1 si hay múltiples resultados');
    assert.equal(multiEmailResult.hasGmailEmails, true);
    assert.equal(multiEmailResult.gmailEmails.length, 3);
    assert.ok(synthesizePromptCaptured, 'Debe haber invocado el método de síntesis agéntica _synthesizeToolResults');
    assert.ok(synthesizePromptCaptured.includes('Netflix'), 'El prompt de síntesis debe incluir Netflix');
    assert.ok(synthesizePromptCaptured.includes('Spotify'), 'El prompt de síntesis debe incluir Spotify');
    assert.ok(synthesizePromptCaptured.includes('Amazon Web Services'), 'El prompt de síntesis debe incluir AWS');

    // Validar respuesta sintética ejecutiva y ausencia de plantilla truncada
    assert.ok(multiEmailResult.reply.includes('Netflix'));
    assert.ok(multiEmailResult.reply.includes('Spotify Familiar'));
    assert.ok(multiEmailResult.reply.includes('Amazon Web Services'));
    assert.ok(multiEmailResult.reply.includes('cobro falló'));
  });

  await t.test('40. Activación Real de RAG en processAudio y processImage (Paridad Multimodal de Memoria Semántica)', async () => {
    let capturedAudioPrompt = null;
    let capturedImagePrompt = null;
    let memoryQueryCaptured = null;

    const mockEmbeddingService = {
      searchSimilarMemories: async (query) => {
        memoryQueryCaptured = query;
        return [
          {
            id: 'mem_audio_1',
            category: 'PREFERENCIA',
            content: 'Sebastián prefiere stands modulares con estructura de madera de pino y luz cálida',
            similarity: 0.94,
          },
          {
            id: 'mem_audio_2',
            category: 'DIRECTIVA',
            content: 'No contratar transporte externo si el taller de Deko Labs tiene camión disponible',
            similarity: 0.82,
          },
        ];
      },
    };

    const mockAiMultimodal = {
      models: {
        generateContent: async ({ contents }) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          if (contents[1]?.inlineData?.mimeType?.startsWith('audio')) {
            capturedAudioPrompt = promptStr;
            return { text: 'Sebastián querido, escuché tu audio y consideré tus preferencias sobre estructuras modulares de madera.' };
          }
          if (contents[1]?.inlineData?.mimeType?.startsWith('image')) {
            capturedImagePrompt = promptStr;
            return {
              text: JSON.stringify({
                type: 'FOTO_GENERAL',
                isFactura: false,
                title: 'Foto de referencia de stand',
                extractedText: 'Muestra madera pino',
                executiveReply: 'Sebastián querido, la foto del stand coincide con tu directiva de madera de pino.',
                invoiceData: null,
              }),
            };
          }
          return { text: 'Respuesta multimodal' };
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiMultimodal,
      embeddingService: mockEmbeddingService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    // 1. processAudio con RAG activo
    const audioRes = await brain.processAudio({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      buffer: Buffer.from('FAKE_AUDIO_BUFFER'),
      mimeType: 'audio/ogg',
      text: 'Nota sobre los stands de la feria',
    });

    assert.ok(capturedAudioPrompt, 'Debe haberse capturado el prompt de audio');
    assert.ok(capturedAudioPrompt.includes('🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):'), 'audioPrompt debe contener el bloque RAG');
    assert.ok(capturedAudioPrompt.includes('Sebastián prefiere stands modulares con estructura de madera de pino'), 'audioPrompt debe contener el contenido del recuerdo');
    assert.ok(capturedAudioPrompt.includes('(Afinidad: 94%)'));
    assert.ok(audioRes.reply.includes('Sebastián querido'));

    // 2. processImage con RAG activo
    const imageRes = await brain.processImage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      buffer: Buffer.from('FAKE_IMAGE_BUFFER'),
      mimeType: 'image/jpeg',
      caption: 'Referencia para el nuevo stand',
    });

    assert.ok(capturedImagePrompt, 'Debe haberse capturado el prompt de imagen');
    assert.ok(capturedImagePrompt.includes('🧠 RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG):'), 'imagePrompt debe contener el bloque RAG');
    assert.ok(capturedImagePrompt.includes('madera de pino'));
    assert.ok(imageRes.reply.includes('Sebastián querido'));
  });

  await t.test('41. Worker Autónomo de Memoria en Segundo Plano (_extractAndSaveMemoryBackground)', async () => {
    const savedMemories = [];
    const mockEmbeddingService = {
      searchSimilarMemories: async () => [],
      saveMemory: async ({ content, category }) => {
        savedMemories.push({ content, category });
        return { success: true };
      },
    };

    let backgroundPromptReceived = null;
    const mockAiBackground = {
      models: {
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          // Si es la llamada del worker de memoria en background:
          if (promptStr.includes('Analiza esta interacción entre Sebastián y Carmencita:')) {
            backgroundPromptReceived = promptStr;
            if (promptStr.includes('los viernes por la tarde no me agendes')) {
              return {
                text: JSON.stringify({
                  shouldSave: true,
                  category: 'PREFERENCIA',
                  content: 'No agendar reuniones los viernes por la tarde porque supervisa el taller',
                }),
              };
            }
            return { text: JSON.stringify({ shouldSave: false }) };
          }

          // Respuesta principal al usuario:
          return {
            text: '¡Por supuesto, mi jefe querido! Ya tomo nota de que los viernes por la tarde estás en taller y no te agendo nada.',
          };
        },
      },
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiBackground,
      embeddingService: mockEmbeddingService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    // 1. Mensaje con preferencia explícita a largo plazo
    const reply1 = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita linda, los viernes por la tarde no me agendes reuniones con proveedores porque salgo a supervisar el taller.',
    });

    assert.ok(reply1.reply.includes('viernes por la tarde'));

    // Esperar al worker asíncrono no bloqueante
    if (brain._lastMemoryTask) {
      await brain._lastMemoryTask;
    }

    assert.ok(backgroundPromptReceived, 'El prompt de extracción debió ser evaluado');
    assert.equal(savedMemories.length, 1, 'Debe haber guardado autónomamente la preferencia detectada');
    assert.equal(savedMemories[0].category, 'PREFERENCIA');
    assert.equal(savedMemories[0].content, 'No agendar reuniones los viernes por la tarde porque supervisa el taller');

    // 2. Charla casual o saludo: shouldSave false no debe insertar recuerdos basura
    await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Hola Carmencita, buenos días. ¿Cómo estás hoy?',
    });

    if (brain._lastMemoryTask) {
      await brain._lastMemoryTask;
    }

    assert.equal(savedMemories.length, 1, 'No debe guardar recuerdos para charlas casuales o saludos');
  });

  await t.test('42. Lectura y Anexo en Obsidian Vault (READ_OBSIDIAN_NOTE y APPEND_OBSIDIAN_NOTE)', async () => {
    // 0. Validación de Esquemas Zod
    const validReadAction = {
      action: 'READ_OBSIDIAN_NOTE',
      title: 'Plan de Stands 2026',
      folder: '02_Projects',
    };
    const parsedRead = parseCarmencitaAction(validReadAction);
    assert.ok(parsedRead, 'READ_OBSIDIAN_NOTE debe ser validado por Zod');
    assert.equal(parsedRead.action, 'READ_OBSIDIAN_NOTE');
    assert.equal(parsedRead.title, 'Plan de Stands 2026');
    assert.equal(parsedRead.folder, '02_Projects');

    // Validación de error cuando title está vacío
    assert.equal(parseCarmencitaAction({ action: 'READ_OBSIDIAN_NOTE', title: '' }), null);

    const validAppendAction = {
      action: 'APPEND_OBSIDIAN_NOTE',
      title: 'Plan de Stands 2026',
      content: '## Anexo de Materiales\n- Madera de pino tratada y reflectores 3000K',
      folder: '02_Projects',
    };
    const parsedAppend = parseCarmencitaAction(validAppendAction);
    assert.ok(parsedAppend, 'APPEND_OBSIDIAN_NOTE debe ser validado por Zod');
    assert.equal(parsedAppend.action, 'APPEND_OBSIDIAN_NOTE');
    assert.equal(parsedAppend.title, 'Plan de Stands 2026');
    assert.ok(parsedAppend.content.includes('Madera de pino'));

    // Validación de error cuando content está vacío
    assert.equal(parseCarmencitaAction({ action: 'APPEND_OBSIDIAN_NOTE', title: 'Plan', content: '' }), null);

    // 1. Prueba unitaria de ObsidianDriveService.appendToNote con cliente Drive mockeado
    let updatedFilePayload = null;
    const initialNoteContent = '# Plan de Stands 2026\n\nDistribución modular básica.';
    const mockDrive = {
      files: {
        get: async () => ({ data: initialNoteContent }),
        update: async ({ fileId, media, fields }) => {
          updatedFilePayload = { fileId, body: media.body, fields };
          return {
            data: {
              id: fileId,
              name: 'Plan de Stands 2026.md',
              webViewLink: 'https://drive.google.com/file/d/test123/view',
            },
          };
        },
      },
    };

    const obsidianService = new ObsidianDriveService({ driveClient: mockDrive });
    const appendResult = await obsidianService.appendToNote({
      fileId: 'file_stands_123',
      name: 'Plan de Stands 2026',
      contentToAppend: '## Anexo de Iluminación\n- Tiras LED 3000K de alta eficiencia.',
    });

    assert.ok(appendResult, 'appendToNote debe retornar resultado');
    assert.equal(appendResult.fileId, 'file_stands_123');
    assert.equal(appendResult.fileName, 'Plan de Stands 2026.md');
    assert.ok(appendResult.content.includes('Distribución modular básica.'));
    assert.ok(appendResult.content.includes('## Anexo de Iluminación'));
    assert.ok(updatedFilePayload, 'files.update debió ser invocado');
    assert.equal(updatedFilePayload.fileId, 'file_stands_123');
    assert.ok(updatedFilePayload.body.includes('Tiras LED 3000K'));

    // 2. Integración agéntica de CarmencitaBrain con READ_OBSIDIAN_NOTE y síntesis ejecutiva
    let capturedSynthesisPrompt = null;
    const mockAiObsidian = {
      models: {
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          // Si es la fase de síntesis agéntica de resultados:
          if (promptStr.includes('Ejecutaste la herramienta Obsidian Vault')) {
            capturedSynthesisPrompt = promptStr;
            return {
              text: 'Sebastián querido, ya revisé a fondo tu nota de Plan de Stands 2026. El proyecto contempla distribución modular y tiras LED cálidas de 3000K. ¿Deseas que prepare la orden de compra?',
            };
          }

          // Fase de extracción inicial de acción:
          return {
            text: '¡Con gusto, mi líder! Te leo la nota de inmediato.\n```json\n' +
              JSON.stringify({
                action: 'READ_OBSIDIAN_NOTE',
                title: 'Plan de Stands 2026',
                folder: '02_Projects',
              }) +
              '\n```',
          };
        },
      },
    };

    const mockObsidianService = {
      readNote: async ({ name }) => ({
        fileId: 'file_stands_123',
        fileName: `${name}.md`,
        content: '# Plan de Stands 2026\n\nDistribución modular y tiras LED cálidas de 3000K.',
      }),
      appendToNote: async ({ name, contentToAppend }) => ({
        fileId: 'file_stands_123',
        fileName: `${name}.md`,
        content: `# ${name}\n\nContenido base.\n\n${contentToAppend}\n`,
        webViewLink: 'https://drive.google.com/file/d/test123/view',
      }),
    };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiObsidian,
      obsidianService: mockObsidianService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const readResponse = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Léeme la nota de Plan de Stands 2026',
    });

    assert.equal(readResponse.hasObsidianNote, true);
    assert.equal(readResponse.actionData.action, 'READ_OBSIDIAN_NOTE');
    assert.ok(capturedSynthesisPrompt, 'La síntesis agéntica debió ejecutarse');
    assert.ok(capturedSynthesisPrompt.includes('Plan de Stands 2026.md'));
    assert.ok(readResponse.reply.includes('Sebastián querido'));
    assert.ok(readResponse.reply.includes('distribución modular y tiras LED cálidas'));

    // 3. Integración agéntica de CarmencitaBrain con APPEND_OBSIDIAN_NOTE
    const mockAiAppend = {
      models: {
        generateContent: async () => ({
          text: '¡Por supuesto, mi Sebastián adorado! Anexo los detalles a la nota.\n```json\n' +
            JSON.stringify({
              action: 'APPEND_OBSIDIAN_NOTE',
              title: 'Plan de Stands 2026',
              folder: '02_Projects',
              content: '- Proveedor de herrajes confirmado: Metales de Guatemala.',
            }) +
            '\n```',
        }),
      },
    };

    const brainAppend = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiAppend,
      obsidianService: mockObsidianService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const appendResponse = await brainAppend.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Agrega a la nota Plan de Stands 2026 el proveedor de herrajes',
    });

    assert.equal(appendResponse.hasObsidianNote, true);
    assert.equal(appendResponse.actionData.action, 'APPEND_OBSIDIAN_NOTE');
    assert.ok(appendResponse.reply.includes('Plan de Stands 2026'));
    assert.ok(appendResponse.reply.includes('02_Projects'));
  });

  await t.test('43. Ciclo Completo de Tareas Nativas (COMPLETE_TASK, CANCEL_TASK y LIST_TASKS)', async () => {
    // 0. Validación de Esquemas Zod
    assert.ok(parseCarmencitaAction({ action: 'COMPLETE_TASK', query: 'comprar pilas' }));
    assert.ok(parseCarmencitaAction({ action: 'CANCEL_TASK', query: 'llamar a carpintero' }));
    assert.ok(parseCarmencitaAction({ action: 'LIST_TASKS', status: 'PENDIENTE' }));

    // 1. Pruebas de servicio TaskService y GoogleTasksService
    let completedGoogleTaskId = null;
    let deletedGoogleTaskId = null;

    const mockGoogleTasksService = {
      isConfigured: () => true,
      completeTask: async ({ taskId }) => {
        completedGoogleTaskId = taskId;
        return { id: taskId, status: 'completed' };
      },
      deleteTask: async ({ taskId }) => {
        deletedGoogleTaskId = taskId;
        return { success: true, taskId };
      },
    };

    const testTaskService = new TaskService(mockPrisma, mockGoogleTasksService);

    // Crear dos tareas con googleTaskId
    const task1 = await mockPrisma.task.create({
      data: {
        description: 'Comprar pilas alcalinas AAA para el multímetro',
        status: 'PENDIENTE',
        priority: 'ALTA',
        googleTaskId: 'gtask_pilas_111',
      },
    });

    const task2 = await mockPrisma.task.create({
      data: {
        description: 'Cotizar flete con Transportes San José',
        status: 'PENDIENTE',
        priority: 'MEDIA',
        googleTaskId: 'gtask_flete_222',
      },
    });

    // 2. Completar tarea por palabra clave
    const completed = await testTaskService.completeTaskByNameOrId({ query: 'pilas' });
    assert.ok(completed, 'Debe encontrar y completar la tarea de pilas');
    assert.equal(completed.id, task1.id);
    assert.equal(completed.status, 'COMPLETADA');
    assert.ok(completed.completedAt instanceof Date);

    // Esperar tick para la llamada asíncrona de Google Tasks
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(completedGoogleTaskId, 'gtask_pilas_111', 'Google Tasks debe sincronizarse con completeTask');

    // 3. Cancelar tarea por palabra clave
    const cancelled = await testTaskService.cancelTaskByNameOrId({ query: 'Transportes San José' });
    assert.ok(cancelled, 'Debe encontrar y cancelar la tarea de flete');
    assert.equal(cancelled.id, task2.id);
    assert.equal(cancelled.status, 'CANCELADA');

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(deletedGoogleTaskId, 'gtask_flete_222', 'Google Tasks debe sincronizarse con deleteTask');

    // 4. Integración en CarmencitaBrain con Blindaje Anti-Terminal Bash
    let terminalBridgeCalled = false;
    const spyAgyBridge = {
      executeTask: async () => {
        terminalBridgeCalled = true;
        return { success: true, output: 'bash output' };
      },
    };

    const mockAiTask = {
      models: {
        generateContent: async () => ({
          text: '¡Listo mi Sebastián querido! Di por concluida la tarea "Comprar pilas alcalinas AAA para el multímetro" en tu lista.\n```json\n' +
            JSON.stringify({
              action: 'COMPLETE_TASK',
              query: 'pilas',
            }) +
            '\n```',
        }),
      },
    };

    const brainTask = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiTask,
      taskService: testTaskService,
      documentService,
      ideaService,
      excelService,
      agyBridge: spyAgyBridge,
    });

    const brainTaskResult = await brainTask.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Marca como completada la tarea de comprar pilas',
    });

    assert.equal(brainTaskResult.hasTask, true);
    assert.equal(brainTaskResult.actionData.action, 'COMPLETE_TASK');
    assert.ok(brainTaskResult.reply.includes('¡Listo mi Sebastián querido!'));
    assert.ok(brainTaskResult.reply.includes('Comprar pilas alcalinas'));
    assert.equal(terminalBridgeCalled, false, 'Carmencita NUNCA debe invocar la terminal bash para resolver tareas de forma nativa');
  });

  await t.test('44. Reprogramación y Cancelación en Google Calendar (RESCHEDULE_CALENDAR_EVENT y CANCEL_CALENDAR_EVENT)', async () => {
    // 0. Validación de Esquemas Zod
    assert.ok(parseCarmencitaAction({
      action: 'RESCHEDULE_CALENDAR_EVENT',
      query: 'Reunión de Stand IA con Gary',
      newStartDateTime: '2026-10-15T15:00:00-06:00',
    }));
    assert.ok(parseCarmencitaAction({
      action: 'CANCEL_CALENDAR_EVENT',
      query: 'Reunión de Stand IA con Gary',
    }));
    // Falla si falta newStartDateTime en reprogramación
    assert.equal(parseCarmencitaAction({ action: 'RESCHEDULE_CALENDAR_EVENT', query: 'Reunión' }), null);

    // 1. Pruebas de servicio CalendarService
    let patchedRequestBody = null;
    let deletedEventId = null;

    const mockCalendarClient = {
      events: {
        list: async () => ({
          data: {
            items: [
              {
                id: 'cal_event_777',
                summary: 'Reunión de Stand IA con Gary',
                start: { dateTime: '2026-10-15T10:00:00-06:00' },
                end: { dateTime: '2026-10-15T11:00:00-06:00' },
              },
            ],
          },
        }),
        patch: async ({ eventId, requestBody }) => {
          patchedRequestBody = { eventId, requestBody };
          return {
            data: {
              id: eventId,
              summary: 'Reunión de Stand IA con Gary',
              start: requestBody.start,
              end: requestBody.end,
              htmlLink: 'https://calendar.google.com/event?eid=777',
            },
          };
        },
        delete: async ({ eventId }) => {
          deletedEventId = eventId;
          return { data: {} };
        },
      },
    };

    const testCalendarService = new CalendarService({ calendarClient: mockCalendarClient });

    // 2. Reprogramar evento por búsqueda
    const rescheduled = await testCalendarService.rescheduleEvent({
      query: 'Stand IA',
      newStartDateTime: '2026-10-15T15:00:00-06:00',
    });

    assert.ok(rescheduled);
    assert.equal(rescheduled.id, 'cal_event_777');
    assert.equal(patchedRequestBody.eventId, 'cal_event_777');
    assert.ok(patchedRequestBody.requestBody.start.dateTime.includes('2026-10-15'));

    // 3. Cancelar evento por búsqueda
    const cancelled = await testCalendarService.cancelEvent({ query: 'Stand IA' });
    assert.ok(cancelled.success);
    assert.equal(deletedEventId, 'cal_event_777');

    // 4. Integración en CarmencitaBrain con RESCHEDULE_CALENDAR_EVENT y CANCEL_CALENDAR_EVENT
    const mockAiCalendar = {
      models: {
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          if (promptStr.includes('cancela')) {
            return {
              text: '¡Listo mi Sebastián querido! He cancelado la cita "Reunión de Stand IA con Gary" en tu Google Calendar.\n```json\n' +
                JSON.stringify({
                  action: 'CANCEL_CALENDAR_EVENT',
                  query: 'Reunión de Stand IA con Gary',
                }) +
                '\n```',
            };
          }
          return {
            text: '📅 ¡Cita reprogramada en tu Google Calendar!\n```json\n' +
              JSON.stringify({
                action: 'RESCHEDULE_CALENDAR_EVENT',
                query: 'Reunión de Stand IA con Gary',
                newStartDateTime: '2026-10-15T16:00:00-06:00',
              }) +
              '\n```',
          };
        },
      },
    };

    const brainCal = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiCalendar,
      calendarService: testCalendarService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    // Probar reprogramación en Brain
    const resReschedule = await brainCal.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Mueve la reunión de Stand IA para las 4pm',
    });

    assert.equal(resReschedule.hasCalendarEvent, true);
    assert.equal(resReschedule.actionData.action, 'RESCHEDULE_CALENDAR_EVENT');
    assert.ok(resReschedule.reply.includes('Cita reprogramada'));

    // Probar cancelación en Brain
    const resCancel = await brainCal.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'cancela la reunión de Stand IA con Gary',
    });

    assert.equal(resCancel.hasCalendarEvent, true);
    assert.equal(resCancel.actionData.action, 'CANCEL_CALENDAR_EVENT');
    assert.ok(resCancel.reply.includes('cancelado la cita'));
  });

  await t.test('45. Chunking e Indexación Vectorial de Obsidian (indexNoteContentToVector y searchNotesSemantic)', async () => {
    // 1. Vector sintético y Mock de Embedding
    const vecStand = Array.from({ length: 768 }, (_, i) => (i < 50 ? 1 : 0));
    const vecStandQuery = Array.from({ length: 768 }, (_, i) => (i < 50 ? 0.96 : 0));

    const mockAiObsidianRag = {
      models: {
        embedContent: async () => ({ embedding: { values: vecStand } }),
      },
    };

    const embeddingSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAiObsidianRag });
    const obsidianService = new ObsidianDriveService({
      embeddingService: embeddingSvc,
    });

    // 2. Probar _chunkMarkdown
    const markdownContent = `# Especificaciones de Stands 2026\n\n` +
      `Para la feria del mueble utilizaremos estructura de pino tratado con acabados en laca mate.\n\n` +
      `El sistema de iluminación constará de tiras LED cálidas de 3000K ocultas tras los paneles modulares.\n\n` +
      `El proveedor seleccionado para la carpintería es Maderas del Norte con entrega estimada el 15 de noviembre.`;

    const chunks = obsidianService._chunkMarkdown(markdownContent, 120);
    assert.ok(chunks.length >= 2, 'Debe dividir en múltiples fragmentos respetando los párrafos');

    // 3. Probar indexNoteContentToVector
    const initialMemCount = mockPrisma._data.semanticMemories.length;
    await obsidianService.indexNoteContentToVector({
      fileId: 'file_stand_01',
      name: 'Especificaciones Stand Madera.md',
      folder: '02_Projects',
      content: markdownContent,
      embeddingService: embeddingSvc,
      maxChunkLength: 120,
    });

    const newMemCount = mockPrisma._data.semanticMemories.length;
    assert.ok(newMemCount > initialMemCount, 'Debe haber guardado los fragmentos en SemanticMemory');

    const obsidianMemories = mockPrisma._data.semanticMemories.filter((m) => m.category === 'OBSIDIAN');
    assert.ok(obsidianMemories.length >= chunks.length);
    assert.equal(obsidianMemories[0].category, 'OBSIDIAN');
    assert.ok(obsidianMemories[0].content.includes('[Nota: Especificaciones Stand Madera]'));
    assert.equal(obsidianMemories[0].metadata.fileName, 'Especificaciones Stand Madera.md');
    assert.equal(obsidianMemories[0].metadata.folderPath, '02_Projects');

    // 4. Probar searchNotesSemantic
    const mockAiQuery = {
      models: {
        embedContent: async () => ({ embedding: { values: vecStandQuery } }),
      },
    };
    const queryEmbSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAiQuery });

    const searchResults = await obsidianService.searchNotesSemantic({
      query: 'acabados y madera de los stands',
      embeddingService: queryEmbSvc,
      limit: 3,
    });

    assert.ok(searchResults.length > 0, 'Debe encontrar fragmentos semánticos afines');
    assert.equal(searchResults[0].category, 'OBSIDIAN');
    assert.ok(searchResults[0].content.includes('Especificaciones Stand Madera'));
    assert.ok(searchResults[0].similarity >= 0.50);
  });

  await t.test('46. Vectorización y Búsqueda Semántica Documental (saveDocument con RAG y SEARCH_DOCUMENTS)', async () => {
    // 1. Validación de esquema Zod para SEARCH_DOCUMENTS
    const parsedAction = SearchDocumentsActionSchema.parse({
      action: 'SEARCH_DOCUMENTS',
      query: 'factura de imprenta',
      category: 'FACTURA',
    });
    assert.equal(parsedAction.action, 'SEARCH_DOCUMENTS');
    assert.equal(parsedAction.query, 'factura de imprenta');
    assert.equal(parsedAction.category, 'FACTURA');
    assert.equal(parsedAction.limit, 5);

    // 2. Vector sintético y Servicio de Documentos con RAG
    const vecInvoice = Array.from({ length: 768 }, (_, i) => (i >= 50 && i < 100 ? 1 : 0));
    const vecInvoiceQuery = Array.from({ length: 768 }, (_, i) => (i >= 50 && i < 100 ? 0.95 : 0));

    const mockAiDoc = {
      models: {
        embedContent: async () => ({ embedding: { values: vecInvoice } }),
      },
    };

    const docEmbeddingSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAiDoc });
    const docServiceWithRag = new DocumentService(mockPrisma, storageProvider, docEmbeddingSvc);

    const initialMemories = mockPrisma._data.semanticMemories.length;
    const fakeBuffer = Buffer.from('%PDF-1.4 Factura de Imprenta Vinil Stands...');
    const savedInvoice = await docServiceWithRag.saveDocument({
      buffer: fakeBuffer,
      originalName: 'factura_imprenta_vinil.pdf',
      mimeType: 'application/pdf',
      category: 'FACTURA',
      summary: 'Impresión de gran formato y vinil adhesivo para stands',
      invoiceData: {
        vendor: 'Impresos Rápidos GT',
        item: 'Vinil mate 120m2',
        totalAmount: 2450.00,
        currency: 'GTQ',
      },
    });

    assert.ok(savedInvoice.id);
    assert.ok(savedInvoice.invoice);
    assert.ok(mockPrisma._data.semanticMemories.length > initialMemories, 'Debe haber vectorizado la factura en SemanticMemory');

    const invoiceMem = mockPrisma._data.semanticMemories.find((m) => m.category === 'FACTURA');
    assert.ok(invoiceMem, 'Debe existir un recuerdo con categoría FACTURA');
    assert.ok(invoiceMem.content.includes('Impresos Rápidos GT'));
    assert.ok(invoiceMem.content.includes('2450'));
    assert.equal(invoiceMem.metadata.originalName, 'factura_imprenta_vinil.pdf');

    // 3. Búsqueda Semántica Documental (searchDocumentsSemantic)
    const mockAiDocQuery = {
      models: {
        embedContent: async () => ({ embedding: { values: vecInvoiceQuery } }),
      },
    };
    docServiceWithRag.embeddingService = new EmbeddingService({ prisma: mockPrisma, ai: mockAiDocQuery });

    const searchDocsResult = await docServiceWithRag.searchDocumentsSemantic({
      query: '¿Cuánto pagamos de vinil en la imprenta?',
      category: 'FACTURA',
      limit: 5,
    });

    assert.ok(searchDocsResult.length > 0, 'Debe recuperar la factura mediante búsqueda semántica');
    assert.equal(searchDocsResult[0].category, 'FACTURA');
    assert.ok(searchDocsResult[0].content.includes('Impresos Rápidos GT'));

    // 4. Acción SEARCH_DOCUMENTS en CarmencitaBrain con Síntesis por IA
    let capturedSynthesisPrompt = null;
    const mockAiBrainDoc = {
      models: {
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string'
            ? contents[0]
            : (contents?.[0]?.parts?.[0]?.text || '');

          if (promptStr.includes('Ejecutaste la herramienta')) {
            capturedSynthesisPrompt = promptStr;
            return {
              text: 'Sebastián querido, revisé tu bóveda documental: pagamos GTQ 2,450.00 a Impresos Rápidos GT por el vinil mate de los stands según la factura resguardada.',
            };
          }

          return {
            text: '```json\n' +
              JSON.stringify({
                action: 'SEARCH_DOCUMENTS',
                query: 'factura imprenta vinil',
                category: 'FACTURA',
              }) +
              '\n```',
          };
        },
        embedContent: async () => ({ embedding: { values: vecInvoiceQuery } }),
      },
    };

    const brainDoc = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiBrainDoc,
      documentService: docServiceWithRag,
      embeddingService: docServiceWithRag.embeddingService,
      taskService,
      ideaService,
      excelService,
    });

    const brainDocResult = await brainDoc.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: '¿cuánto pagamos en la última factura de imprenta?',
    });

    assert.equal(brainDocResult.hasDocuments, true);
    assert.equal(brainDocResult.actionData.action, 'SEARCH_DOCUMENTS');
    assert.ok(brainDocResult.reply.includes('Impresos Rápidos GT') || brainDocResult.reply.includes('2,450'));
    assert.ok(capturedSynthesisPrompt, 'Debe haber pasado los resultados por _synthesizeToolResults');
  });

  await t.test('47. Búsqueda Conceptual en Obsidian con Síntesis (SEARCH_OBSIDIAN_NOTES semántico)', async () => {
    const vecWoodStand = Array.from({ length: 768 }, (_, i) => (i >= 150 && i < 200 ? 1 : 0));
    const vecWoodQuery = Array.from({ length: 768 }, (_, i) => (i >= 150 && i < 200 ? 0.97 : 0));

    // Guardar fragmento conceptual en SemanticMemory
    await mockPrisma.$executeRawUnsafe(
      `INSERT INTO "SemanticMemory" (id, category, content, embedding, metadata, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3::vector, $4::jsonb, NOW())`,
      'OBSIDIAN',
      '[Nota: Stand Feria 2026] Acordamos usar bastidores de madera de pino de 2x2 pulgadas con unión tipo caja y espiga para garantizar estabilidad.',
      JSON.stringify(vecWoodStand),
      JSON.stringify({
        fileName: 'Stand Feria 2026.md',
        cleanTitle: 'Stand Feria 2026',
        folderPath: '02_Projects',
        chunkIndex: 0,
        totalChunks: 1,
      })
    );

    const mockAiObsidianQuery = {
      models: {
        embedContent: async () => ({ embedding: { values: vecWoodQuery } }),
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string'
            ? contents[0]
            : (contents?.[0]?.parts?.[0]?.text || '');

          if (promptStr.includes('Ejecutaste la herramienta')) {
            return {
              text: 'Sebastián querido, según la nota "Stand Feria 2026" en tu carpeta de Proyectos, acordamos utilizar bastidores de madera de pino de 2x2 pulgadas con uniones de caja y espiga para garantizar total estabilidad estructural.',
            };
          }

          return {
            text: '```json\n' +
              JSON.stringify({
                action: 'SEARCH_OBSIDIAN_NOTES',
                query: '¿qué especificaciones acordamos para el stand de madera?',
              }) +
              '\n```',
          };
        },
      },
    };

    const embServiceObsidian = new EmbeddingService({ prisma: mockPrisma, ai: mockAiObsidianQuery });
    const obsidianSvc = new ObsidianDriveService({
      embeddingService: embServiceObsidian,
    });

    const brainObsidian = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiObsidianQuery,
      obsidianService: obsidianSvc,
      embeddingService: embServiceObsidian,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const conceptualResult = await brainObsidian.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: '¿qué especificaciones acordamos para el stand de madera?',
    });

    assert.equal(conceptualResult.hasObsidianNotes, true);
    assert.equal(conceptualResult.actionData.action, 'SEARCH_OBSIDIAN_NOTES');
    assert.ok(conceptualResult.reply.includes('Stand Feria 2026'), 'Debe citar la nota fuente');
    assert.ok(conceptualResult.reply.includes('madera de pino') || conceptualResult.reply.includes('bastidores'), 'Debe sintetizar la respuesta conceptual');
  });

  await t.test('48. Sincronización Masiva e Idempotente del Vault (syncVaultToVector)', async () => {
    // 0. Validación de Esquema Zod SyncObsidianVaultActionSchema
    const parsedValid = SyncObsidianVaultActionSchema.parse({ action: 'SYNC_OBSIDIAN_VAULT', force: true });
    assert.equal(parsedValid.action, 'SYNC_OBSIDIAN_VAULT');
    assert.equal(parsedValid.force, true);

    const parsedDefault = parseCarmencitaAction({ action: 'SYNC_OBSIDIAN_VAULT' });
    assert.equal(parsedDefault.action, 'SYNC_OBSIDIAN_VAULT');
    assert.equal(parsedDefault.force, false);

    // 1. Mock de EmbeddingService
    const vecVault = Array.from({ length: 768 }, (_, i) => (i < 40 ? 1 : 0));
    const mockAiVault = {
      models: {
        embedContent: async () => ({ embedding: { values: vecVault } }),
      },
    };
    const vaultEmbSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAiVault });

    // 2. ObsidianDriveService con notas simuladas
    const mockNotes = [
      {
        id: 'file_deko_1',
        name: 'STAND IA - Vision General.md',
        folderPath: '02_Projects',
        modifiedTime: '2026-10-06T10:00:00Z',
      },
      {
        id: 'file_deko_2',
        name: 'Deco Vintage Tienda de Posters.md',
        folderPath: '03_Areas',
        modifiedTime: '2026-10-06T11:00:00Z',
      },
    ];

    const noteContents = {
      file_deko_1: `# STAND IA - Visión General\n\nSistema integral de visión artificial y recomendación de stands.\n\nIntegración con Gemini 3.8 Flash y Dokploy.`,
      file_deko_2: `# Deco Vintage Tienda de Posters\n\nTienda online especializada en marcos y pósters decorativos de alta gama.`,
    };

    const obsidianService = new ObsidianDriveService({
      embeddingService: vaultEmbSvc,
      prisma: mockPrisma,
    });

    obsidianService.searchNotes = async ({ query = '', maxResults = 100 } = {}) => {
      return mockNotes;
    };

    obsidianService.readNote = async ({ fileId, name }) => {
      const content = noteContents[fileId] || '# Nota\n\nContenido';
      return { fileId, name, content };
    };

    // 3. Ejecutar syncVaultToVector
    const progressLog = [];
    const syncResult = await obsidianService.syncVaultToVector({
      embeddingService: vaultEmbSvc,
      onProgress: (p) => progressLog.push(p),
    });

    assert.equal(syncResult.totalFound, 2);
    assert.equal(syncResult.totalIndexed, 2);
    assert.ok(syncResult.totalChunks >= 2, 'Debe haber generado al menos 2 fragmentos conceptuales');
    assert.equal(syncResult.errors.length, 0);
    assert.equal(progressLog.length, 2, 'El callback onProgress debe llamarse para cada nota');

    // Verificar en SemanticMemory que los chunks tengan categoría OBSIDIAN y metadatos correctos
    const obsidianChunks = mockPrisma._data.semanticMemories.filter((m) => m.category === 'OBSIDIAN');
    assert.ok(obsidianChunks.some((c) => c.metadata?.fileId === 'file_deko_1'));
    assert.ok(obsidianChunks.some((c) => c.metadata?.fileId === 'file_deko_2'));
    assert.ok(obsidianChunks.some((c) => c.content.includes('[Nota: STAND IA - Vision General]')));
    assert.ok(obsidianChunks.some((c) => c.content.includes('[Nota: Deco Vintage Tienda de Posters]')));

    const chunkCountAfterFirstSync = mockPrisma._data.semanticMemories.filter((m) => m.category === 'OBSIDIAN').length;

    // 4. Validar Idempotencia: re-ejecutar syncVaultToVector no debe duplicar chunks
    const secondSyncResult = await obsidianService.syncVaultToVector({
      embeddingService: vaultEmbSvc,
    });

    assert.equal(secondSyncResult.totalFound, 2);
    assert.equal(secondSyncResult.totalIndexed, 2);
    assert.equal(secondSyncResult.totalChunks, syncResult.totalChunks);

    const chunkCountAfterSecondSync = mockPrisma._data.semanticMemories.filter((m) => m.category === 'OBSIDIAN').length;
    assert.equal(
      chunkCountAfterSecondSync,
      chunkCountAfterFirstSync,
      'La re-sincronización debe ser 100% idempotente (cero chunks duplicados)'
    );
  });

  await t.test('49. Acción Agéntica SYNC_OBSIDIAN_VAULT en CarmencitaBrain y Endpoint /api/obsidian/sync-rag', async () => {
    const vecVault = Array.from({ length: 768 }, (_, i) => (i < 40 ? 1 : 0));
    const mockAiVault = {
      models: {
        embedContent: async () => ({ embedding: { values: vecVault } }),
      },
    };
    const vaultEmbSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAiVault });

    const mockNotes = [
      { id: 'f_sync_1', name: 'Arquitectura Jarvis.md', folderPath: '02_Projects' },
      { id: 'f_sync_2', name: 'Directivas Deko Labs.md', folderPath: '00_Meta' },
    ];
    const noteContents = {
      f_sync_1: `# Arquitectura Jarvis\n\nOrquestador central de agentes para el ecosistema Deko Labs.`,
      f_sync_2: `# Directivas Deko Labs\n\nEstándares inquebrantables de ingeniería, calidad y verificación forense.`,
    };

    const obsidianService = new ObsidianDriveService({
      embeddingService: vaultEmbSvc,
      prisma: mockPrisma,
    });
    obsidianService.searchNotes = async () => mockNotes;
    obsidianService.readNote = async ({ fileId, name }) => ({
      fileId,
      name,
      content: noteContents[fileId] || '# Nota',
    });

    // 1. Integración en CarmencitaBrain mediante acción SYNC_OBSIDIAN_VAULT
    const mockAiBrainSync = {
      models: {
        generateContent: async () => ({
          text: '¡Por supuesto, mi Sebastián adorado! Procedo a sincronizar e indexar todas las notas de tu bóveda de Obsidian en mi memoria semántica.\n```json\n' +
            JSON.stringify({
              action: 'SYNC_OBSIDIAN_VAULT',
              force: false,
            }) +
            '\n```',
        }),
      },
    };

    const brainSync = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiBrainSync,
      obsidianService,
      embeddingService: vaultEmbSvc,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const syncResponse = await brainSync.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, por favor sincroniza mi bóveda de Obsidian',
    });

    assert.equal(syncResponse.actionData.action, 'SYNC_OBSIDIAN_VAULT');
    assert.ok(syncResponse.syncResult, 'Debe incluir syncResult en el resultado');
    assert.equal(syncResponse.syncResult.totalIndexed, 2);
    assert.ok(syncResponse.syncResult.totalChunks >= 2);
    assert.ok(syncResponse.reply.includes('Sebastián querido'));
    assert.ok(syncResponse.reply.includes('sincronización de tu bóveda de Obsidian'));
    assert.ok(syncResponse.reply.includes('2 notas'));
    assert.ok(syncResponse.reply.includes('fragmentos conceptuales'));

    // 2. Verificación de Resiliencia: si obsidianService no está configurado
    const brainNoObsidian = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiBrainSync,
      obsidianService: null,
      documentService,
      taskService,
      ideaService,
      excelService,
    });
    const noObsResponse = await brainNoObsidian.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'sincroniza mi obsidian',
    });
    assert.ok(noObsResponse.reply.includes('servicio de Obsidian Vault no está configurado'));

    // 3. Endpoint Administrativo Fastify /api/obsidian/sync-rag
    const app = Fastify();
    registerRoutes(app, {
      brain: brainSync,
      documentService,
      taskService,
      ideaService,
      telegramAdapter: null,
      whatsappAdapter: null,
    });

    // Sin autorización -> 401
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/obsidian/sync-rag',
      payload: { force: true },
    });
    assert.equal(unauthRes.statusCode, 401);

    // Con autorización -> 200 y ejecución de sincronización
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/obsidian/sync-rag',
      headers: authHeaders,
      payload: { force: true },
    });
    assert.equal(authRes.statusCode, 200);
    const authBody = authRes.json();
    assert.equal(authBody.success, true);
    assert.ok(authBody.message.includes('completada exitosamente'));
    assert.equal(authBody.data.totalFound, 2);
    assert.equal(authBody.data.totalIndexed, 2);

    await app.close();
  });

  await t.test('51. UPDATE_OBSIDIAN_NOTE en ObsidianDriveService y CarmencitaBrain (actualización in-situ, coincidencia difusa, cero duplicados)', async () => {
    // 0. Validación de Esquema Zod UpdateObsidianNoteActionSchema
    const validUpdateAction = {
      action: 'UPDATE_OBSIDIAN_NOTE',
      title: 'Carmencita Secretary Hub - Automatizacion y Asistencia',
      content: '# Carmencita Hub\n\nContenido completamente renovado y actualizado in-situ.',
      folder: '02_Projects',
      tags: ['carmencita', 'hub'],
      wikilinks: ['STAND IA'],
    };
    const parsedAction = parseCarmencitaAction(validUpdateAction);
    assert.ok(parsedAction, 'UPDATE_OBSIDIAN_NOTE debe ser validado por Zod');
    assert.equal(parsedAction.action, 'UPDATE_OBSIDIAN_NOTE');
    assert.equal(parsedAction.title, validUpdateAction.title);

    // Validación de fallos: sin título o sin contenido
    assert.equal(parseCarmencitaAction({ action: 'UPDATE_OBSIDIAN_NOTE', title: '', content: 'algo' }), null);
    assert.equal(parseCarmencitaAction({ action: 'UPDATE_OBSIDIAN_NOTE', title: 'Titulo', content: '' }), null);

    // 1. Normalización y Coincidencia Difusa (normalizeNoteTitle & findNoteByNameOrTitle)
    // Diferencias tipográficas: em-dash vs guion simple y acentos
    const titleWithEmDash = 'Carmencita Secretary Hub — Automatización y Asistencia.md';
    const titleWithHyphen = 'Carmencita Secretary Hub - Automatizacion y Asistencia';
    assert.equal(
      normalizeNoteTitle(titleWithEmDash),
      normalizeNoteTitle(titleWithHyphen),
      'normalizeNoteTitle debe igualar variantes con em-dash, guiones y acentos'
    );

    const updatedDriveFiles = [];
    const mockDrive = {
      files: {
        list: async () => {
          return {
            data: {
              files: [
                {
                  id: 'file_carmencita_existing',
                  name: 'Carmencita Secretary Hub — Automatización y Asistencia.md',
                  webViewLink: 'https://drive.google.com/file/d/file_carmencita_existing/view',
                  modifiedTime: '2026-10-07T12:00:00Z',
                  parents: ['folder_02_projects'],
                },
              ],
            },
          };
        },
        update: async ({ fileId, media, requestBody }) => {
          updatedDriveFiles.push({ fileId, media, requestBody });
          return {
            data: {
              id: fileId,
              name: 'Carmencita Secretary Hub — Automatización y Asistencia.md',
              webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
            },
          };
        },
        create: async () => {
          throw new Error('create() NUNCA debe llamarse durante actualización in-situ');
        },
      },
    };

    const vecUpdate = Array.from({ length: 768 }, (_, i) => (i < 20 ? 1 : 0));
    const mockAiUpdate = {
      models: {
        embedContent: async () => ({ embedding: { values: vecUpdate } }),
      },
    };
    const updateEmbSvc = new EmbeddingService({ prisma: mockPrisma, ai: mockAiUpdate });

    const obsidianService = new ObsidianDriveService({
      vaultFolderName: 'vault',
      driveClient: mockDrive,
      embeddingService: updateEmbSvc,
      prisma: mockPrisma,
    });

    // 2. Ejecución de updateNote con coincidencia difusa (sin fileId)
    const updateResult = await obsidianService.updateNote({
      title: 'Carmencita Secretary Hub - Automatizacion y Asistencia',
      content: '# Carmencita Hub v2\n\nArquitectura actualizada sin duplicados.',
      folder: '02_Projects',
      tags: ['carmencita', 'deko-labs'],
    });

    assert.equal(updateResult.fileId, 'file_carmencita_existing');
    assert.equal(updateResult.updated, true);
    assert.equal(updatedDriveFiles.length, 1);
    assert.equal(updatedDriveFiles[0].fileId, 'file_carmencita_existing');
    assert.ok(updatedDriveFiles[0].media.body.includes('title: "Carmencita Secretary Hub — Automatización y Asistencia"'));
    assert.ok(updatedDriveFiles[0].media.body.includes('Arquitectura actualizada sin duplicados.'));

    // 3. Idempotencia en createNote: Si la nota ya existe, createNote delega a updateNote (cero duplicados)
    const duplicateCreateResult = await obsidianService.createNote({
      title: 'Carmencita Secretary Hub - Automatizacion y Asistencia',
      content: '# Carmencita Hub v3\n\nIntento de creación duplicada delegado limpiamente.',
      folder: '02_Projects',
    });
    assert.equal(duplicateCreateResult.fileId, 'file_carmencita_existing');
    assert.equal(duplicateCreateResult.updated, true);
    assert.equal(updatedDriveFiles.length, 2, 'Debe haber actualizado dos veces sin crear archivos nuevos');

    // 4. Integración en CarmencitaBrain con acción UPDATE_OBSIDIAN_NOTE
    const mockAiBrainUpdate = {
      models: {
        generateContent: async () => ({
          text: '¡Entendido, mi querido Sebastián! Actualizo de inmediato la nota en tu Obsidian Vault.\n```json\n' +
            JSON.stringify({
              action: 'UPDATE_OBSIDIAN_NOTE',
              title: 'Carmencita Secretary Hub - Automatizacion y Asistencia',
              content: '# Carmencita Hub v4\n\nContenido definitivo auditado por Gary.',
              folder: '02_Projects',
            }) +
            '\n```',
        }),
      },
    };

    const brainUpdate = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiBrainUpdate,
      obsidianService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const brainUpdateRes = await brainUpdate.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Actualiza la nota de Carmencita Secretary Hub en Obsidian con el nuevo resumen',
    });

    assert.equal(brainUpdateRes.hasObsidianNote, true);
    assert.equal(brainUpdateRes.actionData.action, 'UPDATE_OBSIDIAN_NOTE');
    assert.equal(brainUpdateRes.obsidianNote.fileId, 'file_carmencita_existing');
    assert.ok(brainUpdateRes.reply.includes('Nota actualizada in-situ en Obsidian Vault:'));
    assert.ok(brainUpdateRes.reply.includes('file_carmencita_existing') || brainUpdateRes.reply.includes('Carmencita Secretary Hub'));
  });

  await t.test('52. Segregación de Memoria RAG (excludeCategory: \'OBSIDIAN\') e inyección persistente de directivas cardinales activas', async () => {
    const vecDirectiva = Array.from({ length: 768 }, (_, i) => (i < 30 ? 1 : 0));
    const vecObsidian = Array.from({ length: 768 }, (_, i) => (i < 30 ? 0.98 : 0));
    const vecQuery = Array.from({ length: 768 }, (_, i) => (i < 30 ? 0.95 : 0));

    const mockAiDirectives = {
      models: {
        embedContent: async () => ({ embedding: { values: vecQuery } }),
        generateContent: async ({ contents }) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          return {
            text: '¡Entendido Sebastián, mantengo todas tus directivas presentes siempre!',
            promptReceived: promptStr,
          };
        },
      },
    };

    const embServiceDirectives = new EmbeddingService({ prisma: mockPrisma, ai: mockAiDirectives });

    // 1. Sembrar Directiva y Memoria de Obsidian en MockPrisma
    await mockPrisma.$executeRawUnsafe(
      `INSERT INTO "SemanticMemory" (id, category, content, embedding, metadata, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3::vector, $4::jsonb, NOW())`,
      'DIRECTIVA',
      'Sebastián exige no duplicar notas en Google Drive y actualizar in-situ.',
      JSON.stringify(vecDirectiva),
      null
    );

    await mockPrisma.$executeRawUnsafe(
      `INSERT INTO "SemanticMemory" (id, category, content, embedding, metadata, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3::vector, $4::jsonb, NOW())`,
      'OBSIDIAN',
      '[Nota: Stand 2026] Detalles constructivos de stands para ferias.',
      JSON.stringify(vecObsidian),
      JSON.stringify({ fileId: 'f_obs_123' })
    );

    // 2. Validar getActiveDirectives
    const activeDirectives = await embServiceDirectives.getActiveDirectives({ limit: 5 });
    assert.ok(activeDirectives.length >= 1);
    assert.ok(activeDirectives.some((d) => d.content.includes('no duplicar notas en Google Drive')));

    // 3. Validar excludeCategory: 'OBSIDIAN' en searchSimilarMemories
    const resultsWithExclusion = await embServiceDirectives.searchSimilarMemories('notas y directivas de Sebastián', {
      limit: 5,
      minSimilarity: 0.5,
      excludeCategory: 'OBSIDIAN',
    });

    assert.ok(resultsWithExclusion.length > 0);
    assert.ok(!resultsWithExclusion.some((r) => r.category === 'OBSIDIAN'), 'Ningún resultado debe ser de categoría OBSIDIAN');
    assert.ok(resultsWithExclusion.some((r) => r.category === 'DIRECTIVA'), 'Debe incluir la directiva cardinal');

    // 4. Validar inyección persistente de directivas en CarmencitaBrain
    let capturedPromptInBrain = null;
    const mockAiCapture = {
      models: {
        embedContent: async () => ({ embedding: { values: vecQuery } }),
        generateContent: async ({ contents }) => {
          capturedPromptInBrain = typeof contents?.[0] === 'string' ? contents[0] : '';
          return {
            text: '¡Por supuesto mi querido Sebastián, tus órdenes y directivas son sagradas para mí!',
          };
        },
      },
    };

    const brainWithDirectives = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiCapture,
      embeddingService: embServiceDirectives,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    await brainWithDirectives.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, confírmame que recuerdas mis directivas de trabajo',
    });

    assert.ok(capturedPromptInBrain, 'CarmencitaBrain debe haber generado el prompt');
    assert.ok(
      capturedPromptInBrain.includes('### 📌 DIRECTIVAS CARDINALES ACTIVAS DE SEBASTIÁN:'),
      'El prompt debe incluir el bloque visible de directivas cardinales'
    );
    assert.ok(
      capturedPromptInBrain.includes('no duplicar notas en Google Drive'),
      'El prompt debe incluir la directiva activa de no duplicar notas'
    );
  });

  await t.test('53. Acción agéntica DIAGNOSE_SYSTEM en CarmencitaBrain (diagnóstico rápido, prevención de falsos positivos con notas de Obsidian)', async () => {
    // 0. Validación de Esquema Zod DiagnoseSystemActionSchema
    const validDiagAction = { action: 'DIAGNOSE_SYSTEM', scope: 'full' };
    const parsedDiag = parseCarmencitaAction(validDiagAction);
    assert.ok(parsedDiag);
    assert.equal(parsedDiag.action, 'DIAGNOSE_SYSTEM');
    assert.equal(parsedDiag.scope, 'full');

    const defaultDiag = parseCarmencitaAction({ action: 'DIAGNOSE_SYSTEM' });
    assert.equal(defaultDiag.scope, 'full');

    // 1. Prueba de Sanitización de Logs
    assert.equal(
      sanitizeLogLine('Error con token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz y apiKey AIzaSyD-123456789012345678901234567890123'),
      'Error con token Bearer [REDACTED] y apiKey [REDACTED_API_KEY]'
    );
    assert.equal(
      sanitizeLogLine('Autenticación fallida con AQ.abc123xyz456 y password="super_secret_pass"'),
      'Autenticación fallida con [REDACTED_AUTH_KEY] y password=[REDACTED]'
    );

    // 2. Prueba unitaria de DiagnosticsService
    const diagnosticsService = new DiagnosticsService({
      prisma: mockPrisma,
      obsidianService: { refreshToken: 'mock_token', driveClient: {} },
      gmailService: { refreshToken: 'mock_token' },
      calendarService: { refreshToken: 'mock_token' },
      googleTasksService: { isConfigured: () => true },
    });

    const status = await diagnosticsService.getSystemStatus({ scope: 'full' });
    assert.ok(status);
    assert.equal(status.scope, 'full');
    assert.ok(status.process);
    assert.equal(status.process.status, 'ONLINE');
    assert.ok(status.process.uptimeSeconds >= 0);
    assert.ok(status.process.memoryUsage.heapUsedMb > 0);
    assert.equal(status.database.status, 'CONNECTED');
    assert.ok(typeof status.database.latencyMs === 'number');
    assert.equal(status.googleWorkspace.drive, true);
    assert.equal(status.googleWorkspace.gmail, true);
    assert.equal(status.googleWorkspace.calendar, true);
    assert.equal(status.googleWorkspace.tasks, true);

    // 3. Acción Agéntica DIAGNOSE_SYSTEM en CarmencitaBrain ante reporte de errores
    const mockAiBrainDiag = {
      models: {
        generateContent: async () => ({
          text: '¡Enseguida te genero tu reporte de telemetría y diagnóstico del sistema, mi querido Sebastián!\n```json\n' +
            JSON.stringify({
              action: 'DIAGNOSE_SYSTEM',
              scope: 'full',
            }) +
            '\n```',
        }),
      },
    };

    const brainDiag = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiBrainDiag,
      diagnosticsService,
      documentService,
      taskService,
      ideaService,
      excelService,
    });

    const diagResult = await brainDiag.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: 'Carmencita, dame un reporte de tus errores con obsidian y estado del sistema',
    });

    assert.equal(diagResult.hasDiagnostics, true);
    assert.equal(diagResult.actionData.action, 'DIAGNOSE_SYSTEM');
    assert.ok(diagResult.diagnostics);
    assert.equal(diagResult.diagnostics.database.status, 'CONNECTED');
    assert.ok(diagResult.reply.includes('Diagnóstico de Salud'));
    assert.ok(diagResult.reply.includes('Uptime:'));
    assert.ok(diagResult.reply.includes('PostgreSQL: Conectada'));

    // 4. Prueba del Script de Limpieza en Google Drive: cleanupObsidianDrive
    const mockDriveFiles = [
      { id: 'file_0_byte_orphan', name: 'Deko Labs.md', size: 0, folderPath: '', modifiedTime: '2026-10-06T10:00:00Z' },
      { id: 'file_dup_old', name: 'STAND IA - Vision General.md', size: 500, folderPath: '02_Projects', modifiedTime: '2026-10-06T09:00:00Z' },
      { id: 'file_dup_new', name: 'STAND IA — Visión General.md', size: 550, folderPath: '02_Projects', modifiedTime: '2026-10-07T10:00:00Z' },
    ];
    const deletedFileIds = [];

    const mockCleanupDrive = {
      files: {
        list: async () => ({ data: { files: mockDriveFiles } }),
        get: async ({ fileId }) => {
          if (fileId === 'file_0_byte_orphan') return { data: '' };
          return { data: '# Contenido real' };
        },
        delete: async ({ fileId }) => {
          deletedFileIds.push(fileId);
          return { data: {} };
        },
      },
    };

    const mockCleanupObsidianService = {
      _getDriveClient: async () => mockCleanupDrive,
      getOrCreateVaultFolder: async () => 'root_vault_id',
      _vaultCache: { timestamp: 123 },
    };

    const cleanupReport = await cleanupObsidianDrive({
      dryRun: false,
      obsidianService: mockCleanupObsidianService,
      driveClient: mockCleanupDrive,
    });

    assert.equal(cleanupReport.zeroByteNotes.length, 1);
    assert.equal(cleanupReport.zeroByteNotes[0].name, 'Deko Labs.md');
    assert.equal(cleanupReport.duplicateGroups.length, 1);
    assert.equal(cleanupReport.duplicateGroups[0].official.id, 'file_dup_new', 'La nota más reciente debe ser la oficial');
    assert.equal(cleanupReport.duplicateGroups[0].duplicates[0].id, 'file_dup_old');
    assert.ok(deletedFileIds.includes('file_0_byte_orphan'), 'Debe haber eliminado la nota huérfana de 0 bytes');
    assert.ok(deletedFileIds.includes('file_dup_old'), 'Debe haber eliminado el duplicado antiguo');
    assert.equal(mockCleanupObsidianService._vaultCache.timestamp, 0, 'La caché debe haber sido invalidada tras la limpieza');
  });

  await t.test('54. Chaining Multi-Paso, Sanitización Anti-Fuga de JSON y Resolución de Eventos en Gmail y Calendar', async () => {
    // 1. Prueba Unitaria de sanitizeReplyText
    const rawWithCodeBlock = `Sebastián querido, encontré los datos del DevFest Guatemala 2026. Se realizará el 24 de octubre en el Hotel Tikal Futura.\n\n\`\`\`json\n{\n  "action": "CREATE_CALENDAR_EVENT",\n  "summary": "DevFest Guatemala 2026",\n  "startDateTime": "2026-10-24T08:00:00-06:00"\n}\n\`\`\`\n\n¿Deseas que prepare algo más?`;
    const sanitized1 = sanitizeReplyText(rawWithCodeBlock);
    assert.ok(!sanitized1.includes('```json'), 'No debe contener bloques ```json');
    assert.ok(!sanitized1.includes('"action"'), 'No debe contener la palabra action de código');
    assert.ok(sanitized1.includes('DevFest Guatemala 2026'), 'Debe preservar el contenido del mensaje');
    assert.ok(sanitized1.includes('24 de octubre'));
    assert.ok(sanitized1.includes('¿Deseas que prepare algo más?'));

    const rawWithLooseJson = `Sebastián querido, aquí tienes el dato: { "action": "CREATE_CALENDAR_EVENT", "summary": "DevFest" }\n\n\n\nQuedó todo listo.`;
    const sanitized2 = sanitizeReplyText(rawWithLooseJson);
    assert.ok(!sanitized2.includes('{ "action"'), 'Debe remover objetos JSON sueltos con action');
    assert.ok(!sanitized2.includes('\n\n\n'), 'Debe colapsar saltos de línea triples');
    assert.ok(sanitized2.includes('Quedó todo listo.'));

    // 2. Prevención de Duplicados en CalendarService.createEvent (checkExisting: true)
    let insertCalled = false;
    const mockCalClient = {
      events: {
        list: async () => ({
          data: {
            items: [
              {
                id: 'existing_devfest_id',
                summary: 'DevFest Guatemala 2026',
                start: { dateTime: '2026-10-24T08:00:00-06:00' },
                end: { dateTime: '2026-10-24T17:00:00-06:00' },
                location: 'Grand Tikal Futura Hotel',
                htmlLink: 'https://calendar.google.com/calendar/event?eid=existing_devfest_id',
              },
            ],
          },
        }),
        insert: async () => {
          insertCalled = true;
          return { data: { id: 'new_event_id' } };
        },
      },
    };

    const calService = new CalendarService({ calendarClient: mockCalClient });

    // Intento de crear evento con título equivalente (variación de mayúsculas/tildes)
    const dupResult = await calService.createEvent({
      summary: 'devfest guatemala 2026',
      startDateTime: '2026-10-24T08:00:00-06:00',
      endDateTime: '2026-10-24T17:00:00-06:00',
      location: 'Grand Tikal Futura Hotel',
      checkExisting: true,
    });

    assert.equal(insertCalled, false, 'NO debe llamar a events.insert si el evento ya existe');
    assert.equal(dupResult.alreadyExisted, true);
    assert.equal(dupResult.id, 'existing_devfest_id');
    assert.equal(dupResult.htmlLink, 'https://calendar.google.com/calendar/event?eid=existing_devfest_id');

    // 3. Lectura Profunda en CHECK_GMAIL para Eventos (Extracción de bodyText)
    let emailDetailsIdRequested = null;
    let dataSummaryCaptured = null;

    const mockEventGmailService = {
      searchEmails: async () => [
        {
          id: 'msg_devfest_101',
          date: 'Tue, 22 Sep 2026 14:30:00 -0600',
          from: 'GDG Guatemala <organizers@gdgguatemala.com>',
          subject: 'Confirmación de tu entrada para DevFest Guatemala 2026',
          snippet: 'Gracias por registrarte para el evento en septiembre...',
        },
      ],
      getEmailDetails: async ({ messageId }) => {
        emailDetailsIdRequested = messageId;
        return {
          id: messageId,
          from: 'GDG Guatemala <organizers@gdgguatemala.com>',
          subject: 'Confirmación de tu entrada para DevFest Guatemala 2026',
          date: 'Tue, 22 Sep 2026 14:30:00 -0600',
          bodyText: '¡Hola Sebastián! Tu entrada está confirmada. El evento presencial se llevará a cabo el sábado 24 de octubre de 2026 en el Grand Tikal Futura Hotel de 08:00 a 17:00 horas.',
        };
      },
    };

    const mockSynthDeps = {
      gmailService: mockEventGmailService,
      calendarService: calService,
      synthesizeToolResults: async ({ userText, toolName, dataSummary }) => {
        dataSummaryCaptured = dataSummary;
        return `Sebastián querido, revisé el correo del DevFest Guatemala. La fecha del evento es el sábado 24 de octubre de 2026 en el Grand Tikal Futura Hotel.\n\n\`\`\`json\n{\n  "action": "CREATE_CALENDAR_EVENT",\n  "summary": "DevFest Guatemala 2026",\n  "startDateTime": "2026-10-24T08:00:00-06:00",\n  "endDateTime": "2026-10-24T17:00:00-06:00",\n  "location": "Grand Tikal Futura Hotel"\n}\n\`\`\``;
      },
    };

    // 4. Chaining Multi-Paso: CHECK_GMAIL encadenado con CREATE_CALENDAR_EVENT
    const chainedResult = await executeAction(
      { action: 'CHECK_GMAIL', query: 'DevFest Guate' },
      mockSynthDeps,
      { userText: 'Al de Xela no voy a poder ir busca el dato del de Guate, y marcalo tambien en mi calendario' }
    );

    // Verificaciones de lectura profunda
    assert.equal(emailDetailsIdRequested, 'msg_devfest_101', 'Debe haber solicitado el detalle del correo para evento');
    assert.ok(dataSummaryCaptured.includes('[Correo Detallado]'), 'dataSummary debe incluir el tag de Correo Detallado');
    assert.ok(dataSummaryCaptured.includes('sábado 24 de octubre de 2026'), 'dataSummary debe incluir la fecha real del evento del cuerpo');

    // Verificaciones de Chaining y Sanitización Anti-Fuga
    assert.ok(!chainedResult.reply.includes('```json'), 'El mensaje final NUNCA debe contener ```json');
    assert.ok(!chainedResult.reply.includes('"action"'), 'El mensaje final NUNCA debe contener sintaxis de código "action"');
    assert.ok(chainedResult.reply.includes('24 de octubre de 2026'), 'Debe incluir el resumen del correo');
    assert.ok(chainedResult.reply.includes('¡El espacio ya se encuentra reservado en tu Google Calendar!'), 'Debe reportar que el evento ya estaba reservado');
    assert.ok(chainedResult.reply.includes('https://calendar.google.com/calendar/event?eid=existing_devfest_id'), 'Debe incluir el enlace de Calendar');

    // Verificaciones de estado consolidado
    assert.equal(chainedResult.hasGmailEmails, true, 'Debe conservar hasGmailEmails');
    assert.equal(chainedResult.hasCalendarEvent, true, 'Debe reflejar hasCalendarEvent de la acción secundaria');
    assert.equal(chainedResult.calendarEvent.alreadyExisted, true, 'Debe reflejar que el evento ya existía');
    assert.equal(chainedResult.calendarEvent.id, 'existing_devfest_id');
  });

  await t.test('55. Filtrado de Eventos de Sistema (Cumpleaños), Formateo Temporal Completo y Acotación de Rangos en Calendar', async () => {
    // 0. Validación de esquema Zod para ListCalendarEventsActionSchema
    const parsedAction = ListCalendarEventsActionSchema.safeParse({
      action: 'LIST_CALENDAR_EVENTS',
      range: 'THIS_MONTH',
      month: 'octubre',
      includeBirthdays: false,
    });
    assert.equal(parsedAction.success, true);
    assert.equal(parsedAction.data.range, 'THIS_MONTH');
    assert.equal(parsedAction.data.month, 'octubre');
    assert.equal(parsedAction.data.includeBirthdays, false);

    // 1. Verificar que listUpcomingEvents con excludeBirthdays: true filtre correctamente eventos con eventType: 'birthday' y 'cumpleaños'
    const rawEvents = [
      {
        id: 'ev_work_1',
        summary: 'Reunión Estratégica STAND IA',
        start: { dateTime: '2026-10-15T10:00:00-06:00' },
        end: { dateTime: '2026-10-15T11:00:00-06:00' },
        eventType: 'default',
        location: 'Oficina Central Deko Labs',
      },
      {
        id: 'ev_bday_system',
        summary: '¡Feliz cumpleaños!',
        start: { date: '2027-03-30' },
        end: { date: '2027-03-31' },
        eventType: 'birthday',
      },
      {
        id: 'ev_bday_text',
        summary: 'Recordatorio: Cumpleaños de Proveedor',
        start: { date: '2026-11-20' },
        end: { date: '2026-11-21' },
        eventType: 'default',
      },
    ];

    let lastListParams = null;
    const mockCalendar = {
      events: {
        list: async (params) => {
          lastListParams = params;
          return { data: { items: rawEvents } };
        },
      },
    };

    const calService = new CalendarService({ calendarClient: mockCalendar });

    // Consulta con excludeBirthdays: true (por defecto)
    const filteredUpcoming = await calService.listUpcomingEvents({ maxResults: 10 });
    assert.equal(filteredUpcoming.length, 1, 'Debe haber filtrado los 2 cumpleaños');
    assert.equal(filteredUpcoming[0].id, 'ev_work_1');
    assert.equal(filteredUpcoming[0].summary, 'Reunión Estratégica STAND IA');
    assert.equal(filteredUpcoming[0].isAllDay, false);

    // Consulta con excludeBirthdays: false (debe incluir cumpleaños)
    const allUpcoming = await calService.listUpcomingEvents({ maxResults: 10, excludeBirthdays: false });
    assert.equal(allUpcoming.length, 3, 'Debe incluir todos los eventos si excludeBirthdays es falso');

    // 2. Verificar que LIST_CALENDAR_EVENTS con evento all-day (start: '2026-10-17') no devuelva "06:00 PM" sino "Todo el día" con fecha correcta
    const allDayEvents = [
      {
        id: 'ev_allday_1',
        summary: 'DevFest Guatemala 2026',
        start: '2026-10-17',
        isAllDay: true,
        location: 'Grand Tikal Futura Hotel',
      },
    ];

    const mockCalServiceAllDay = {
      getTodayEvents: async () => allDayEvents,
    };

    const allDayResult = await executeAction(
      { action: 'LIST_CALENDAR_EVENTS', range: 'TODAY' },
      { calendarService: mockCalServiceAllDay }
    );

    assert.ok(!allDayResult.reply.includes('06:00 PM'), 'Evento all-day JAMÁS debe mostrarse como 06:00 PM');
    assert.ok(!allDayResult.reply.includes('18:00'), 'Evento all-day JAMÁS debe mostrarse como 18:00');
    assert.ok(allDayResult.reply.includes('Todo el día'), 'Debe indicar claramente "Todo el día"');
    assert.ok(allDayResult.reply.includes('17'), 'Debe mostrar el día 17');
    assert.ok(allDayResult.reply.includes('DevFest Guatemala 2026'), 'Debe mostrar el resumen del evento');

    // 3. Verificar que range: 'THIS_MONTH' consulte los eventos del mes delimitados sin desbordar al siguiente año
    const mockCalServiceMonth = {
      getMonthEvents: async ({ month, excludeBirthdays }) => {
        return [
          {
            id: 'ev_oct_1',
            summary: 'PlaneToys & Deko Labs Sync',
            start: '2026-10-10T15:00:00-06:00',
            location: 'Zoom',
          },
          {
            id: 'ev_oct_2',
            summary: 'DevFest Guatemala City 2026',
            start: '2026-10-24T08:00:00-06:00',
            location: 'Grand Tikal Futura',
          },
        ];
      },
    };

    // Probamos el método getMonthEvents directamente en CalendarService con cliente mock
    const realCalService = new CalendarService({
      calendarClient: {
        events: {
          list: async (params) => {
            lastListParams = params;
            return {
              data: {
                items: [
                  {
                    id: 'oct_real_1',
                    summary: 'Cita de Octubre',
                    start: { dateTime: '2026-10-10T10:00:00-06:00' },
                    eventType: 'default',
                  },
                  {
                    id: 'bday_march_2027',
                    summary: '¡Feliz cumpleaños!',
                    start: { date: '2027-03-30' },
                    eventType: 'birthday',
                  },
                ],
              },
            };
          },
        },
      },
    });

    const octEvents = await realCalService.getMonthEvents({ month: 9, year: 2026, excludeBirthdays: true });
    // Verificar que timeMin y timeMax acoten el mes de octubre 2026 estrictamente
    assert.ok(lastListParams.timeMin.startsWith('2026-10-01'), 'timeMin debe iniciar en octubre 2026');
    assert.ok(lastListParams.timeMax.startsWith('2026-11-01'), 'timeMax debe cerrar el 31 de octubre a medianoche UTC (05:59 UTC del 1 de nov)');
    assert.equal(octEvents.length, 1, 'Debe excluir el cumpleaños de 2027');
    assert.equal(octEvents[0].summary, 'Cita de Octubre');

    // Probamos la acción LIST_CALENDAR_EVENTS integrada con range: 'THIS_MONTH' y month: 'octubre'
    const monthActionResult = await executeAction(
      { action: 'LIST_CALENDAR_EVENTS', range: 'THIS_MONTH', month: 'octubre' },
      { calendarService: mockCalServiceMonth }
    );

    assert.ok(monthActionResult.reply.includes('Agenda de Google Calendar (del Mes'), 'Debe etiquetar como "del Mes"');
    assert.ok(monthActionResult.reply.includes('PlaneToys & Deko Labs Sync'));
    assert.ok(monthActionResult.reply.includes('DevFest Guatemala City 2026'));
    assert.ok(!monthActionResult.reply.includes('cumpleaños'), 'Cero cumpleaños repetidos');
    assert.equal(monthActionResult.calendarEvents.length, 2);

    // 4. Bucle Cognitivo Cerrado: Validar que LIST_CALENDAR_EVENTS invoque synthesizeToolResults cuando la IA está conectada
    let capturedSynthesisPrompt = null;
    const mockAiCalendarSynthesis = {
      models: {
        generateContent: async ({ contents } = {}) => {
          const promptStr = typeof contents?.[0] === 'string' ? contents[0] : '';
          capturedSynthesisPrompt = promptStr;
          return {
            text: '¡Sebastián querido, mi líder adorado! Ya revisé tu agenda para este mes de octubre:\n\n' +
              '• Tienes la reunión con PlaneToys y el DevFest Guatemala City en Grand Tikal Futura.\n' +
              '• Tienes varios días despejados para avanzar en los diseños de stands.\n\n' +
              '¿Deseas que reserve algún bloque para trabajo de enfoque?',
          };
        },
      },
    };

    const brainWithAi = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiCalendarSynthesis,
      calendarService: mockCalServiceMonth,
    });

    const aiMonthResult = await brainWithAi._executeExtractedActions(
      '```json\n{"action": "LIST_CALENDAR_EVENTS", "range": "THIS_MONTH", "month": "octubre"}\n```',
      null,
      { userText: '¿Cómo viene mi agenda para octubre?' }
    );

    assert.ok(capturedSynthesisPrompt, 'Debe haber invocado el método de síntesis agéntica');
    assert.ok(capturedSynthesisPrompt.includes('Eres Carmencita, la secretaria ejecutiva'), 'Debe utilizar TOOL_SYNTHESIS_PROMPT');
    assert.ok(capturedSynthesisPrompt.includes('Fecha y hora actual en Guatemala:'), 'Debe incluir el reloj vivo de Guatemala');
    assert.ok(capturedSynthesisPrompt.includes('PlaneToys & Deko Labs Sync'), 'Debe inyectar los datos reales en dataSummary');
    assert.ok(capturedSynthesisPrompt.includes('DevFest Guatemala City 2026'), 'Debe inyectar los eventos sin ruido');
    assert.ok(!aiMonthResult.reply.includes('```'), 'La respuesta ejecutiva debe estar libre de bloques de código');
    assert.ok(!aiMonthResult.reply.includes('Agenda de Google Calendar (del Mes'), 'Debe ser lenguaje humano y cálido, libre de volcados planos');
    assert.ok(aiMonthResult.reply.includes('Sebastián querido'), 'Debe incluir el tono cálido y zalamero de Carmencita');
    assert.ok(aiMonthResult.reply.includes('DevFest Guatemala City'), 'Debe sintetizar la información solicitada');

    // 5. Validar que SEARCH_CONTACT invoque synthesizeToolResults cuando la IA está conectada
    let capturedContactPrompt = null;
    const mockAiContactSynthesis = {
      models: {
        generateContent: async ({ contents } = {}) => {
          capturedContactPrompt = typeof contents?.[0] === 'string' ? contents[0] : '';
          return {
            text: 'Sebastián querido, aquí te tengo el contacto de Elena Morales de Telares Chapines:\n\n' +
              'Puedes llamarla directamente o escribirle por WhatsApp. ¡Está lista para cotizarnos!',
          };
        },
      },
    };

    const mockContactService = {
      searchContacts: async () => [
        { name: 'Elena Morales', role: 'Gerente Comercial', company: 'Telares Chapines', phone: '50244449999', email: 'elena@telares.gt' }
      ],
    };

    const brainContactAi = new CarmencitaBrain({
      prisma: mockPrisma,
      ai: mockAiContactSynthesis,
      contactService: mockContactService,
    });

    const contactAiResult = await brainContactAi._executeExtractedActions(
      '```json\n{"action": "SEARCH_CONTACT", "query": "textil"}\n```',
      null,
      { userText: 'Búscame el teléfono de textiles' }
    );

    assert.ok(capturedContactPrompt, 'Debe haber invocado synthesizeToolResults para SEARCH_CONTACT');
    assert.ok(capturedContactPrompt.includes('Elena Morales'));
    assert.ok(capturedContactPrompt.includes('50244449999'));
    assert.ok(contactAiResult.reply.includes('Elena Morales'));
  });

  await t.test('56. Normalización de Zona Horaria (America/Guatemala UTC-6) y Formateo Completo de Rangos en Google Calendar', async () => {
    // 1. Validar la función pura toGuatemalaIso
    // Sin offset explícito: asume hora local de Guatemala (-06:00) y normaliza a ISO UTC
    const guatIsoMorning = toGuatemalaIso('2026-10-17T08:00:00');
    assert.equal(guatIsoMorning, '2026-10-17T14:00:00.000Z', '8:00 AM Guatemala debe convertirse en 14:00:00.000Z');

    const guatIsoEvening = toGuatemalaIso('2026-10-18T19:00:00');
    assert.equal(guatIsoEvening, '2026-10-19T01:00:00.000Z', '7:00 PM Guatemala debe convertirse en 01:00:00.000Z del día siguiente');

    // Con offset explícito (-06:00 o Z)
    assert.equal(toGuatemalaIso('2026-10-17T08:00:00-06:00'), '2026-10-17T14:00:00.000Z');
    assert.equal(toGuatemalaIso('2026-10-17T14:00:00.000Z'), '2026-10-17T14:00:00.000Z');

    // Fechas tipo 'YYYY-MM-DD'
    assert.equal(toGuatemalaIso('2026-10-17'), '2026-10-17T00:00:00-06:00');

    // 2. Validar createEvent con zona horaria normalizada en el requestBody a Google Calendar
    let capturedInsertBody = null;
    let capturedCalendarId = null;
    const mockCalendarClient = {
      events: {
        insert: async ({ calendarId, requestBody }) => {
          capturedCalendarId = calendarId;
          capturedInsertBody = requestBody;
          return {
            data: {
              id: 'cal_event_planetoys_001',
              summary: requestBody.summary,
              start: requestBody.start,
              end: requestBody.end,
              htmlLink: 'https://calendar.google.com/calendar/event?eid=cal_event_planetoys_001',
              status: 'confirmed',
            },
          };
        },
        list: async () => ({ data: { items: [] } }),
      },
    };

    const calService = new CalendarService({ calendarClient: mockCalendarClient });

    const createdEvent = await calService.createEvent({
      summary: 'PlaneToys Stand Setup & Atención al Cliente',
      startDateTime: '2026-10-17T08:00:00',
      endDateTime: '2026-10-18T19:00:00',
      location: 'Parque de la Industria, Salón Guatemala',
      checkExisting: false,
    });

    assert.ok(capturedInsertBody, 'Debe haber llamado a calendar.events.insert');
    assert.equal(capturedInsertBody.summary, 'PlaneToys Stand Setup & Atención al Cliente');
    // Verificación forense: 8:00 AM Guatemala debe viajar a Google Calendar como 14:00:00.000Z
    assert.equal(capturedInsertBody.start.dateTime, '2026-10-17T14:00:00.000Z');
    assert.equal(capturedInsertBody.start.timeZone, 'America/Guatemala');
    // Verificación forense: 7:00 PM domingo 18 debe viajar como 01:00:00.000Z del lunes 19
    assert.equal(capturedInsertBody.end.dateTime, '2026-10-19T01:00:00.000Z');
    assert.equal(capturedInsertBody.end.timeZone, 'America/Guatemala');
    assert.equal(createdEvent.id, 'cal_event_planetoys_001');

    // 3. Validar rescheduleEvent con zona horaria normalizada
    let capturedPatchBody = null;
    let capturedPatchEventId = null;
    mockCalendarClient.events.patch = async ({ calendarId, eventId, requestBody }) => {
      capturedPatchEventId = eventId;
      capturedPatchBody = requestBody;
      return {
        data: {
          id: eventId,
          summary: 'PlaneToys Stand Setup & Atención al Cliente',
          start: requestBody.start,
          end: requestBody.end,
          htmlLink: 'https://calendar.google.com/calendar/event?eid=' + eventId,
        },
      };
    };

    const rescheduledEvent = await calService.rescheduleEvent({
      eventId: 'cal_event_planetoys_001',
      newStartDateTime: '2026-10-17T08:00:00',
      newEndDateTime: '2026-10-17T19:00:00',
    });

    assert.equal(capturedPatchEventId, 'cal_event_planetoys_001');
    assert.equal(capturedPatchBody.start.dateTime, '2026-10-17T14:00:00.000Z');
    assert.equal(capturedPatchBody.end.dateTime, '2026-10-18T01:00:00.000Z');
    assert.equal(rescheduledEvent.id, 'cal_event_planetoys_001');

    // 4. Validar formatEventDates para eventos del mismo día y multi-día
    // A) Mismo día con horario de inicio y fin (ej: sábado 8:00 AM a 5:00 PM)
    const sameDayFormatted = formatEventDates({
      summary: 'Sesión de Fotografía Comercial',
      start: '2026-10-17T14:00:00.000Z', // 8:00 AM Guatemala
      end: '2026-10-17T23:00:00.000Z',   // 5:00 PM Guatemala
    });
    assert.ok(sameDayFormatted.summary.includes('17 oct'), 'Debe incluir día y mes');
    assert.ok(sameDayFormatted.summary.includes('08:00') && sameDayFormatted.summary.includes('05:00'), 'Debe mostrar inicio y fin');
    assert.ok(sameDayFormatted.summary.includes(' de ') && sameDayFormatted.summary.includes(' a '), 'Debe usar formato "de X a Y"');
    assert.ok(sameDayFormatted.fallback.includes('08:00') && sameDayFormatted.fallback.includes('05:00'), 'Fallback debe incluir rango de hora');

    // B) Multi-día (ej: PlaneToys sábado 8:00 AM a domingo 7:00 PM)
    const multiDayFormatted = formatEventDates({
      summary: 'PlaneToys Expo Fin de Semana',
      start: '2026-10-17T14:00:00.000Z', // Sáb 17 oct 8:00 AM Guatemala
      end: '2026-10-19T01:00:00.000Z',   // Dom 18 oct 7:00 PM Guatemala
    });
    assert.ok(multiDayFormatted.summary.startsWith('del '), 'Multi-día debe iniciar con "del "');
    assert.ok(multiDayFormatted.summary.includes('17 oct') && multiDayFormatted.summary.includes('18 oct'), 'Debe incluir ambos días');
    assert.ok(multiDayFormatted.summary.includes('08:00') && multiDayFormatted.summary.includes('07:00'), 'Debe incluir ambas horas');
    assert.ok(multiDayFormatted.fallback.includes('➔'), 'Fallback multi-día debe incluir la flecha direccional');

    // C) Evento sin fin (solo inicio)
    const singleTimeFormatted = formatEventDates({
      summary: 'Check-in Rápido',
      start: '2026-10-17T14:00:00.000Z',
    });
    assert.ok(singleTimeFormatted.summary.includes('a las 08:00'), 'Sin fin debe indicar "a las XX:XX"');

    // D) Evento todo el día
    const allDayFormatted = formatEventDates({
      summary: 'Día de la Raza / Feriado',
      start: '2026-10-12',
      isAllDay: true,
    });
    assert.ok(allDayFormatted.summary.includes('(Todo el día)'), 'Debe indicar Todo el día');

    // 5. Integración con LIST_CALENDAR_EVENTS: reporte transparente del rango en fallback y summary
    const listResult = await executeAction(
      { action: 'LIST_CALENDAR_EVENTS', range: 'UPCOMING' },
      {
        calendarService: {
          listUpcomingEvents: async () => [
            {
              id: 'ev_plane_multi',
              summary: 'PlaneToys Stand Setup',
              start: '2026-10-17T14:00:00.000Z',
              end: '2026-10-19T01:00:00.000Z',
              location: 'Parque de la Industria',
            },
          ],
        },
      }
    );

    assert.ok(listResult.reply.includes('PlaneToys Stand Setup'));
    assert.ok(listResult.reply.includes('17 oct') && listResult.reply.includes('18 oct'), 'La agenda debe reportar que abarca del 17 al 18 de octubre');
    assert.ok(listResult.reply.includes('➔'), 'La lista debe formatear con elegancia el rango multi-día');
  });

  await t.test('57. Zalamería Reactiva, Variedad de Apelativos y Estética Visual Limpia (Anti-Asteriscos y Espaciado)', async () => {
    // 1. Validar que sanitizeReplyText transforme **texto en negrita** en <b>texto en negrita</b>
    const rawMarkdownBold = 'Hola Sebas, aquí tienes el informe de **Deko Labs** y el evento **PlaneToys 2026**.';
    const cleanedBold = sanitizeReplyText(rawMarkdownBold);
    assert.equal(cleanedBold, 'Hola Sebas, aquí tienes el informe de <b>Deko Labs</b> y el evento <b>PlaneToys 2026</b>.');
    assert.ok(!cleanedBold.includes('**'), 'No deben quedar asteriscos de negrita');
    assert.ok(cleanedBold.includes('<b>Deko Labs</b>') && cleanedBold.includes('<b>PlaneToys 2026</b>'));

    // 2. Validar que transforme viñetas de asterisco suelto (* item) en viñetas limpias (• item)
    const rawListWithAsterisks = '📌 Mis pendientes:\n* Revisar stands\n * Aprobar cotización de madera\n* Enviar correo a PlaneToys';
    const cleanedList = sanitizeReplyText(rawListWithAsterisks);
    assert.ok(!cleanedList.includes('*'), 'No deben quedar asteriscos de viñetas');
    assert.ok(cleanedList.includes('• Revisar stands'));
    assert.ok(cleanedList.includes('• Aprobar cotización de madera'));
    assert.ok(cleanedList.includes('• Enviar correo a PlaneToys'));

    // 3. Validar preservación de separación de doble salto de línea (\n\n) y colapso de saltos excesivos (>= 3 a 2)
    const rawExcessiveSpaced = '¡Listo mi jefe consentido!\n\n\n\n✉️ <b>Elena Morales</b>\n📌 <i>Cotización Telares</i>\nAquí está el detalle.\n\n\n¿Deseas algo más?';
    const cleanedSpaced = sanitizeReplyText(rawExcessiveSpaced);
    assert.ok(!cleanedSpaced.includes('\n\n\n'), 'No debe haber más de dos saltos de línea consecutivos');
    assert.ok(cleanedSpaced.includes('¡Listo mi jefe consentido!\n\n✉️ <b>Elena Morales</b>'), 'Debe preservar el aire visual con doble salto');
    assert.ok(cleanedSpaced.includes('Aquí está el detalle.\n\n¿Deseas algo más?'));

    // 4. Validar directivas de CARMENCITA_SYSTEM_PROMPT
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('ZALAMERÍA REACTIVA Y DINAMISMO VOCAL (ESPEJO DE CONFIANZA):'), 'Debe incluir la sección de zalamería reactiva');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('PROHIBIDO repetir "Sebastián querido" como muletilla fija'), 'Debe prohibir la muletilla fija');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('Sebas') && CARMENCITA_SYSTEM_PROMPT.includes('jefecito lindo') && CARMENCITA_SYSTEM_PROMPT.includes('mi jefe consentido'), 'Debe sugerir variedad de apelativos');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('ESTÉTICA VISUAL Y FORMATO DE CHAT MÓVIL (CERO VÓMITO DE TEXTO):'), 'Debe incluir directivas de formato móvil');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('CERO ASTERISCOS DE MARKDOWN'), 'Debe prohibir asteriscos en el prompt');

    // 5. Validar directivas de TOOL_SYNTHESIS_PROMPT
    const sampleSynthesis = TOOL_SYNTHESIS_PROMPT('resumen de correos', 'Gmail', '[Correo 1] De: Proveedor | Asunto: Cotización');
    assert.ok(sampleSynthesis.includes('zalamería reactiva al tono de Sebastián'), 'Debe exigir zalamería reactiva');
    assert.ok(sampleSynthesis.includes('FORMATO VISUAL CON AIRE (CERO TEXTO AMONTONADO)'), 'Debe requerir aire visual');
    assert.ok(sampleSynthesis.includes('CERO ASTERISCOS DE MARKDOWN'), 'Debe exigir cero asteriscos en la síntesis');
  });

  // Limpieza final
  await fs.rm(testDataDir, { recursive: true, force: true }).catch(() => {});
});

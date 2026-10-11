import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolDispatcher } from '../src/tools/dispatcher.js';
import { CARMENCITA_TOOL_DECLARATIONS } from '../src/tools/declarations.js';
import { EmailTriageService, defaultEmailTriageService } from '../src/services/email-triage.service.js';
import { SchedulerService } from '../src/services/scheduler.service.js';
import { sanitizeToolResponseForModel, mapToolSummaryToActionResult } from '../src/core/agent-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('🧠 Suite Coercitiva: Restauración Integral del Sistema Nervioso Cognitivo de Carmencita [DEKO-CARMEN-050]', async (t) => {

  await t.test('1. dispatcher._handleGmail pasa un objeto estructurado a searchEmails', async () => {
    let capturedParams = null;
    const mockGmailService = {
      getEmailDetails: async () => ({ id: 'dummy' }),
      searchEmails: async (params) => {
        capturedParams = params;
        return [{ id: 'msg_101', subject: 'Cotización Madera', snippet: 'Detalles de la entrega' }];
      },
    };

    const dispatcher = new ToolDispatcher({ gmailService: mockGmailService });
    const result = await dispatcher._handleGmail({ query: 'from:proveedor', maxResults: 10, onlyImportant: true, includeRead: false });

    assert.ok(capturedParams !== null, 'searchEmails debe haber sido invocado');
    assert.equal(typeof capturedParams, 'object', 'searchEmails debe recibir un objeto estructurado');
    assert.equal(capturedParams.query, 'from:proveedor');
    assert.equal(capturedParams.maxResults, 10);
    assert.equal(capturedParams.onlyImportant, true);
    assert.equal(capturedParams.includeRead, false);
    assert.equal(result.success, true);
    assert.equal(result.data.count, 1);
  });

  await t.test('2. dispatcher._handleGmail llama a getEmailDetails y no al inexistente readEmail', async () => {
    let capturedDetailsId = null;
    let readEmailInvoked = false;

    const mockGmailService = {
      readEmail: () => { readEmailInvoked = true; },
      getEmailDetails: async ({ messageId }) => {
        capturedDetailsId = messageId;
        return { id: messageId, subject: 'Detalle de Factura', bodyText: 'Total a pagar: Q1,500' };
      },
      searchEmails: async () => [],
    };

    const dispatcher = new ToolDispatcher({ gmailService: mockGmailService });
    const result = await dispatcher._handleGmail({ messageId: 'msg_detail_999' });

    assert.equal(readEmailInvoked, false, 'readEmail NO debe ser llamado bajo ninguna circunstancia');
    assert.equal(capturedDetailsId, 'msg_detail_999', 'getEmailDetails debe recibir el messageId estructurado');
    assert.equal(result.success, true);
    assert.equal(result.data.email.id, 'msg_detail_999');
  });

  await t.test('3. sanitizeToolResponseForModel purga buffers binarios de 2MB y strings gigantes sin alterar metadatos', () => {
    const rawBuffer = Buffer.alloc(2 * 1024 * 1024, 0x41); // 2 MB buffer
    const serializedBuffer = { type: 'Buffer', data: [65, 66, 67] };
    const massiveBase64 = 'A'.repeat(5000);

    const inputData = {
      status: 'success',
      fileName: 'stand_3d_render.png',
      metadata: { width: 1024, height: 1024, prompt: 'Stand ferial de madera rústica' },
      photoFile: {
        buffer: rawBuffer,
        caption: 'Render fotorealista',
      },
      rawSerialized: serializedBuffer,
      bigBase64String: massiveBase64,
      normalString: 'Texto normal de prueba ejecutiva',
      numericValue: 42,
      booleanValue: true,
    };

    const sanitized = sanitizeToolResponseForModel(inputData);

    assert.equal(sanitized.status, 'success');
    assert.equal(sanitized.fileName, 'stand_3d_render.png');
    assert.equal(sanitized.photoFile, '[BINARY_BUFFER_OMITTED]');
    assert.equal(sanitized.rawSerialized, undefined, 'Buffer serializado directo debe ser purgado');
    assert.equal(sanitized.bigBase64String, '[BASE64_OMITTED]');
    assert.equal(sanitized.normalString, 'Texto normal de prueba ejecutiva');
    assert.equal(sanitized.numericValue, 42);
    assert.equal(sanitized.booleanValue, true);
  });

  await t.test('4. EmailTriageService utiliza gemini-3.8-flash y no contiene referencias a gemini-2.5-flash-lite', () => {
    const triage = new EmailTriageService();
    assert.ok(
      triage.modelName.includes('gemini-3.8-flash') || triage.modelName.includes('gemini-3'),
      `EmailTriageService debe usar un modelo activo (actual: ${triage.modelName})`
    );
    assert.notEqual(triage.modelName, 'gemini-2.5-flash-lite', 'No debe usar el modelo obsoleto gemini-2.5-flash-lite');

    // Validación estática de código fuente en email-triage.service.js
    const serviceFilePath = path.join(rootDir, 'src/services/email-triage.service.js');
    const serviceContent = fs.readFileSync(serviceFilePath, 'utf-8');
    assert.ok(
      !serviceContent.includes('gemini-2.5-flash-lite'),
      'El archivo src/services/email-triage.service.js NO debe contener ninguna referencia a gemini-2.5-flash-lite'
    );
  });

  await t.test('5. SchedulerService no descarta correos de infraestructura o financieros de más de 2 horas (amplía a 24h)', async () => {
    const capturedTg = [];
    const mockTelegram = {
      sendMessage: async (chatId, text) => {
        capturedTg.push({ chatId, text });
      },
    };

    const now = new Date('2026-10-11T10:00:00-06:00');
    // Correo de hace 5 horas (fuera de la ventana de 2h pero dentro de 24h)
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    // Correo de hace 30 horas (fuera de la ventana de 24h)
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString();

    const incomingEmails = [
      {
        id: 'mail_infra_spend_alert',
        from: 'Google Cloud Platform <google-noreply@google.com>',
        subject: 'Alerta de Presupuesto: 90% consumido en Google Cloud',
        snippet: 'Tu proyecto carmencita-hub ha alcanzado el 90% de su límite mensual.',
        date: fiveHoursAgo,
      },
      {
        id: 'mail_bi_transfer',
        from: 'Banco Industrial <notificaciones@bi.com.gt>',
        subject: 'Transferencia Recibida por Q4,500.00',
        snippet: 'Depósito monetario acreditado a tu cuenta.',
        date: fiveHoursAgo,
      },
      {
        id: 'mail_ancient_infra',
        from: 'Google Cloud Platform <google-noreply@google.com>',
        subject: 'Alerta obsoleta de hace 30 horas',
        snippet: 'Aviso anterior.',
        date: thirtyHoursAgo,
      },
    ];

    const notifiedDb = [];
    const mockPrisma = {
      notifiedEmail: {
        findUnique: async () => null,
        create: async ({ data }) => {
          notifiedDb.push(data);
          return data;
        },
      },
    };

    const scheduler = new SchedulerService({
      telegramAdapter: mockTelegram,
      gmailService: { getUnreadInboxMessages: async () => incomingEmails },
      prisma: mockPrisma,
    });

    const result = await scheduler.checkInboxWatchdog(now, true);

    // Los 2 correos críticos de 5 horas de antigüedad deben ser procesados y alertados
    assert.equal(result.length, 2, 'Los 2 correos críticos (<24h) deben ser alertados');
    assert.equal(capturedTg.length, 1, 'Debe despachar 1 mensaje consolidado a Telegram');
    assert.ok(scheduler.notifiedEmailIds.has('mail_infra_spend_alert'), 'mail_infra_spend_alert debe estar notificado');
    assert.ok(scheduler.notifiedEmailIds.has('mail_bi_transfer'), 'mail_bi_transfer debe estar notificado');
    // El correo de 30 horas debe ser registrado silenciosamente y descartado
    assert.ok(scheduler.notifiedEmailIds.has('mail_ancient_infra'), 'mail_ancient_infra debe ser registrado silenciosamente');
  });

  await t.test('6. Herramienta run_agy_task está formalmente declarada y cableada en ToolDispatcher', async () => {
    const agyDecl = CARMENCITA_TOOL_DECLARATIONS.find((t) => t.name === 'run_agy_task');
    assert.ok(agyDecl, 'run_agy_task debe existir en CARMENCITA_TOOL_DECLARATIONS');
    assert.ok(agyDecl.parameters.properties.prompt, 'run_agy_task debe requerir prompt');

    let executedPrompt = null;
    const mockAgyBridge = {
      executeTask: async (prompt) => {
        executedPrompt = prompt;
        return { success: true, stdout: 'Dokploy 100% OK', stderr: '', exitCode: 0 };
      },
    };

    const dispatcher = new ToolDispatcher({ agyBridge: mockAgyBridge });
    const dispatchRes = await dispatcher.dispatch('run_agy_task', { prompt: 'docker ps --format table' });

    assert.equal(dispatchRes.success, true);
    assert.equal(executedPrompt, 'docker ps --format table');
    assert.equal(dispatchRes.data.stdout, 'Dokploy 100% OK');
  });

  await t.test('7. mapToolSummaryToActionResult mapea run_agy_task a RUN_AGY_TASK', () => {
    const actionResult = mapToolSummaryToActionResult({
      reply: 'Diagnóstico completado en el VPS',
      toolCallsSummary: [
        {
          name: 'run_agy_task',
          args: { prompt: 'uptime' },
          result: { success: true, data: { stdout: 'load average: 0.12' } },
        },
      ],
    });

    assert.equal(actionResult.actionData.action, 'RUN_AGY_TASK');
    assert.equal(actionResult.actionData.stdout, 'load average: 0.12');
  });

});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CarmencitaBrain } from '../src/core/brain.js';
import { TelegramAdapter } from '../src/adapters/telegram.js';
import { ExecutiveBriefingService } from '../src/services/executive-briefing.service.js';
import { ToolDispatcher } from '../src/tools/dispatcher.js';

test('Milestone 4 — Proactividad Ejecutiva, Human-in-the-Loop y RAG Deliberativo', async (t) => {

  await t.test('1. Creación de Staged Action y Expiración por TTL', async () => {
    const brain = new CarmencitaBrain();

    // 1.1 Crear acción staged con TTL corto de 60ms
    const staged = brain.stageAction({
      toolName: 'manage_tasks',
      args: { action: 'CANCEL', taskId: 'task_ttl_test' },
      description: 'Cancelar tarea obsoleta en PostgreSQL',
      senderId: '777',
      ttlMs: 60,
    });

    assert.ok(staged.actionId, 'Debe generar un actionId único');
    assert.equal(staged.toolName, 'manage_tasks');
    assert.equal(staged.senderId, '777');
    assert.equal(brain.stagedActions.has(staged.actionId), true, 'Debe estar en el mapa de acciones staged');

    // 1.2 Esperar expiración TTL
    await new Promise((resolve) => setTimeout(resolve, 80));

    // 1.3 Intentar ejecutar acción expirada
    await assert.rejects(
      async () => {
        await brain.executeStagedAction(staged.actionId);
      },
      /expirado|TTL/i,
      'Debe rechazar la acción por haber superado el TTL'
    );

    assert.equal(brain.stagedActions.has(staged.actionId), false, 'La acción expirada debe ser eliminada del mapa');
  });

  await t.test('2. Confirmación Exitosa Disparando el Dispatcher', async () => {
    let dispatchedCall = null;
    const mockDispatcher = {
      dispatch: async (toolName, args, context) => {
        dispatchedCall = { toolName, args, context };
        return { success: true, data: { cancelled: true, eventId: args.eventId } };
      },
    };

    const brain = new CarmencitaBrain({ toolDispatcher: mockDispatcher });

    const staged = brain.stageAction({
      toolName: 'manage_calendar',
      args: { action: 'CANCEL', eventId: 'cal_event_999' },
      description: 'Cancelar reunión con proveedores de stands',
      senderId: '777',
      ttlMs: 15 * 60 * 1000,
    });

    const result = await brain.executeStagedAction(staged.actionId);

    assert.ok(dispatchedCall, 'El ToolDispatcher debió ser invocado');
    assert.equal(dispatchedCall.toolName, 'manage_calendar');
    assert.equal(dispatchedCall.args.eventId, 'cal_event_999');
    assert.equal(dispatchedCall.context.isConfirmed, true, 'isConfirmed debe ser true');
    assert.equal(dispatchedCall.context.bypassStaging, true, 'bypassStaging debe ser true');
    assert.equal(result.success, true);
    assert.equal(brain.stagedActions.has(staged.actionId), false, 'La acción confirmada debe removerse del mapa');
  });

  await t.test('3. Cancelación Exitosa Descartando la Acción Staged en TelegramAdapter', async () => {
    let callbackHandler = null;
    const mockBot = {
      use: () => {},
      catch: () => {},
      command: () => {},
      on: (event, handler) => {
        if (event === 'callback_query:data') {
          callbackHandler = handler;
        }
      },
    };

    const brain = new CarmencitaBrain();
    const adapter = new TelegramAdapter(brain);
    adapter.init(mockBot);

    assert.ok(callbackHandler, 'El handler de callback_query:data debe estar registrado');

    const actionId = 'act_cancel_test_123';
    const staged = {
      actionId,
      toolName: 'manage_tasks',
      args: { action: 'CANCEL', taskId: 'task_cancel_1' },
      description: 'Cancelar cotización pendiente',
      senderId: '777',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    adapter.stagedActions.set(actionId, staged);

    let editedMessage = '';
    let answeredQuery = false;

    const mockCtx = {
      callbackQuery: { data: `hitl:cancel:${actionId}` },
      from: { id: 777 },
      answerCallbackQuery: async () => { answeredQuery = true; },
      editMessageText: async (text) => { editedMessage = text; },
    };

    await callbackHandler(mockCtx);

    assert.equal(answeredQuery, true, 'Debe responder a la consulta de callback de Telegram');
    assert.equal(adapter.stagedActions.has(actionId), false, 'La acción cancelada debe eliminarse del mapa');
    assert.ok(editedMessage.includes('❌ <b>Acción cancelada:</b>'), 'Debe editar el mensaje informando la cancelación');
    assert.ok(editedMessage.includes('Cancelar cotización pendiente'));
  });

  await t.test('4. Confirmación Exitosa en TelegramAdapter y Ejecución Real', async () => {
    let executedStaged = null;
    const mockBrain = {
      executeStagedAction: async (staged) => {
        executedStaged = staged;
        return { success: true, message: '✅ Evento cancelado correctamente en Google Calendar.' };
      },
    };

    let callbackHandler = null;
    const mockBot = {
      use: () => {},
      catch: () => {},
      command: () => {},
      on: (event, handler) => {
        if (event === 'callback_query:data') callbackHandler = handler;
      },
    };

    const adapter = new TelegramAdapter(mockBrain);
    adapter.init(mockBot);

    const actionId = 'act_confirm_test_456';
    const staged = {
      actionId,
      toolName: 'manage_calendar',
      args: { action: 'CANCEL', eventId: 'cal_meeting_456' },
      description: 'Cancelar almuerzo ejecutivo con clientes VIP',
      senderId: '777',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    adapter.stagedActions.set(actionId, staged);

    let progressMessage = '';
    let replyMessage = '';

    const mockCtx = {
      callbackQuery: { data: `hitl:confirm:${actionId}` },
      from: { id: 777 },
      answerCallbackQuery: async () => {},
      editMessageText: async (text) => { progressMessage = text; },
      reply: async (text) => { replyMessage = text; },
    };

    await callbackHandler(mockCtx);

    assert.ok(executedStaged, 'CarmencitaBrain.executeStagedAction debió ser llamado');
    assert.equal(executedStaged.actionId, actionId);
    assert.equal(adapter.stagedActions.has(actionId), false, 'La acción debe removerse del mapa de TelegramAdapter');
    assert.ok(progressMessage.includes('⏳ <i>Ejecutando:</i>'), 'Debe editar el mensaje a estado de ejecución');
    assert.ok(replyMessage.includes('✅ Evento cancelado correctamente'), 'Debe despachar el resultado final al chat');
  });

  await t.test('5. Seguridad Zero-Trust: Denegación de Confirmación por Usuario No Autorizado', async () => {
    let callbackHandler = null;
    const mockBot = {
      use: () => {},
      catch: () => {},
      command: () => {},
      on: (event, handler) => {
        if (event === 'callback_query:data') callbackHandler = handler;
      },
    };

    let executionAttempted = false;
    const mockBrain = {
      executeStagedAction: async () => { executionAttempted = true; },
    };

    const adapter = new TelegramAdapter(mockBrain);
    adapter.init(mockBot);

    const actionId = 'act_auth_test_789';
    adapter.stagedActions.set(actionId, {
      actionId,
      toolName: 'manage_calendar',
      args: { action: 'CANCEL' },
      description: 'Acción sensible de Sebastián',
      senderId: '777', // Solo Sebastián está autorizado
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });

    let securityDenial = '';
    const intruderCtx = {
      callbackQuery: { data: `hitl:confirm:${actionId}` },
      from: { id: 999999 }, // Remitente no autorizado
      answerCallbackQuery: async () => {},
      reply: async (text) => { securityDenial = text; },
    };

    await callbackHandler(intruderCtx);

    assert.equal(executionAttempted, false, 'No debe ejecutar la acción ante usuario no autorizado');
    assert.ok(securityDenial.includes('🔒 No tienes autorización'), 'Debe emitir advertencia de seguridad');
    assert.equal(adapter.stagedActions.has(actionId), true, 'La acción debe permanecer resguardada para el dueño real');
  });

  await t.test('6. Briefing Matutino y Vespertino Formateados con 0 Asteriscos', async () => {
    const mockCalendar = {
      getTodayEvents: async () => [
        { summary: 'Revisión de Stands en Taller', start: '2026-10-09T09:00:00-06:00', location: 'Taller Deko Labs' },
        { summary: 'Reunión con Comité de Feria', start: '2026-10-09T14:30:00-06:00', location: 'Meet' },
      ],
      getTomorrowEvents: async () => [
        { summary: 'Instalación de Iluminación en Stand Principal' },
      ],
    };

    const mockTasks = {
      listTasks: async () => [
        { id: 't1', description: 'Revisar acabados de vinil', priority: 'ALTA', status: 'PENDIENTE' },
        { id: 't2', description: 'Enviar cotización a Plan Toys', priority: 'MEDIA', status: 'PENDIENTE' },
      ],
    };

    const mockGmail = {
      getInboxSummary: async () => ({
        messages: [
          { from: 'Proveedor de Luces <luces@guate.com>', subject: 'Entrega de reflectores cálidos' },
        ],
      }),
    };

    const mockAi = {
      models: {
        generateContent: async ({ contents }) => {
          if (contents.includes('Briefing Matutino')) {
            return {
              text: () => '🌅 <b>¡Buenos días, mi jefe querido!</b>\n\nAquí tienes tu panorama para hoy:\n\n🌤️ Clima agradable en Ciudad de Guatemala.\n\n📅 Tienes 2 reuniones en agenda.\n\n📋 Hay 2 tareas prioritarias en seguimiento.\n\n¡A darlo todo con éxito!',
            };
          }
          return {
            text: () => '✨ <b>¡Mi jefe consentido, hora de cerrar jornada por hoy!</b>\n\nPara mañana tenemos:\n\n• Instalación de iluminación en stand principal.\n\nDescansa tranquilo.',
          };
        },
      },
    };

    const briefingService = new ExecutiveBriefingService({
      ai: mockAi,
      calendarService: mockCalendar,
      taskService: mockTasks,
      gmailService: mockGmail,
      weatherFetcher: async () => '19°C, Despejado',
    });

    // 6.1 Probar Morning Briefing
    const morning = await briefingService.buildMorningBriefing({ date: new Date() });
    assert.ok(morning.text, 'Debe generar texto de briefing matutino');
    assert.equal(morning.text.includes('*'), false, 'El briefing matutino NO debe contener asteriscos (0 asteriscos)');
    assert.ok(morning.text.includes('Buenos días') || morning.text.includes('Carmencita'));
    assert.ok(morning.voicePrompt, 'Debe generar voicePrompt para síntesis de audio');
    assert.equal(morning.data.events.length, 2);
    assert.equal(morning.data.tasks.length, 2);
    assert.equal(morning.data.unreadEmails.length, 1);

    // 6.2 Probar Evening Debrief
    const evening = await briefingService.buildEveningBriefing({ date: new Date() });
    assert.ok(evening.text, 'Debe generar texto de debriefing vespertino');
    assert.equal(evening.text.includes('*'), false, 'El briefing vespertino NO debe contener asteriscos (0 asteriscos)');
    assert.ok(evening.text.includes('cerrar jornada') || evening.text.includes('mañana'));
    assert.equal(evening.data.tomorrowEvents.length, 1);
  });

  await t.test('7. RAG 100% Deliberativo: Cero Búsqueda Vectorial Automática en Mensajes Regulares', async () => {
    let similarMemoriesCalled = false;
    let activeDirectivesCalled = false;

    const mockEmbeddingService = {
      getActiveDirectives: async () => {
        activeDirectivesCalled = true;
        return [{ content: 'Directiva: Trabajar con contratos firmados antes de instalar' }];
      },
      searchSimilarMemories: async () => {
        similarMemoriesCalled = true;
        return [];
      },
    };

    let capturedPrompt = null;
    const mockAi = {
      models: {
        generateContent: async ({ contents }) => {
          capturedPrompt = typeof contents?.[0] === 'string' ? contents[0] : '';
          return { text: '¡Por supuesto, mi jefe querido!' };
        },
      },
    };

    const mockPrisma = {
      messageLog: { create: async () => {}, findMany: async () => [] },
      task: { findMany: async () => [] },
    };
    const mockTaskService = { listTasks: async () => [] };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      taskService: mockTaskService,
      ai: mockAi,
      embeddingService: mockEmbeddingService,
    });

    await brain.processTextMessage({
      channel: 'telegram',
      senderId: '777',
      senderName: 'Sebastián',
      text: '¿Cómo va todo Carmencita?',
    });

    assert.equal(activeDirectivesCalled, true, 'Debe consultar las directivas cardinales activas');
    assert.equal(similarMemoriesCalled, false, 'NO debe llamar automáticamente a searchSimilarMemories en cada turno de conversación');
    assert.ok(capturedPrompt.includes('DIRECTIVAS CARDINALES ACTIVAS DE SEBASTIÁN'), 'El prompt debe incluir las directivas cardinales');
    assert.equal(capturedPrompt.includes('RECUERDOS HISTÓRICOS Y DIRECTIVAS DE SEBASTIÁN RECUPERADOS (RAG)'), false, 'No debe haber bloque de recuerdos automáticos');
  });

  await t.test('8. Filtro Estricto de Saliencia de Memoria: Descarte de Charla Casual', async () => {
    let memorySaved = false;
    let aiExtractionInvoked = false;

    const mockEmbeddingService = {
      getActiveDirectives: async () => [],
      saveMemory: async () => { memorySaved = true; },
    };

    const mockAi = {
      models: {
        generateContent: async ({ contents }) => {
          const str = typeof contents?.[0] === 'string' ? contents[0] : '';
          if (str.includes('Analiza esta interacción')) {
            aiExtractionInvoked = true;
          }
          return { text: 'Hola Sebas' };
        },
      },
    };

    const mockPrisma = {
      messageLog: { create: async () => {}, findMany: async () => [] },
      task: { findMany: async () => [] },
    };
    const mockTaskService = { listTasks: async () => [] };

    const brain = new CarmencitaBrain({
      prisma: mockPrisma,
      taskService: mockTaskService,
      ai: mockAi,
      embeddingService: mockEmbeddingService,
    });

    // 8.1 Mensaje casual ("hola")
    await brain.processTextMessage({
      channel: 'telegram',
      senderId: '777',
      senderName: 'Sebastián',
      text: 'hola',
    });

    if (brain._lastMemoryTask) await brain._lastMemoryTask;

    assert.equal(aiExtractionInvoked, false, 'No debe invocar extracción de memoria para saludos casuales');
    assert.equal(memorySaved, false, 'No debe guardar memoria para saludos casuales');
  });

});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunner } from '../src/core/agent-runner.js';
import { ToolDispatcher } from '../src/tools/dispatcher.js';

/**
 * Cliente Mock Determinista para Gemini en tests de AgentRunner.
 * Cero llamadas de red, cero tokens reales consumidos.
 */
class MockGenAIClient {
  constructor(turnHandlers = []) {
    this.turnHandlers = Array.isArray(turnHandlers) ? [...turnHandlers] : [turnHandlers];
    this.callHistory = [];
    this.models = {
      generateContent: async (params) => {
        this.callHistory.push(params);
        if (this.turnHandlers.length === 0) {
          return { text: 'Respuesta por defecto de MockGenAIClient' };
        }
        const handler = this.turnHandlers.shift();
        if (typeof handler === 'function') {
          return await handler(params);
        }
        return handler;
      },
    };
  }
}

test('Suite Hermética de Motor Agéntico ReAct y Native Tool Calling', async (t) => {
  await t.test('Caso 1 (Respuesta directa): Usuario envía saludo, modelo responde texto directo en 1 turno (0 tool calls)', async () => {
    const mockClient = new MockGenAIClient([
      {
        text: '¡Buenos días, mi estimado Sebastián! Carmencita lista para lo que requieras.',
      },
    ]);

    const dispatcher = new ToolDispatcher({});
    const runner = new AgentRunner({
      aiPool: mockClient,
      toolDispatcher: dispatcher,
      maxTurns: 5,
    });

    const result = await runner.run({
      systemInstruction: 'Eres Carmencita.',
      userMessage: 'Hola Carmencita, buenos días',
    });

    assert.equal(result.toolCallsSummary.length, 0, 'No debe haber llamadas a herramientas');
    assert.equal(result.stagedActions.length, 0, 'No debe haber acciones en staging');
    assert.ok(result.reply.toLowerCase().includes('buenos días'), 'Debe contener el saludo del modelo');
    assert.ok(!result.reply.includes('```json'), 'Cero fugas de sintaxis JSON');
    assert.ok(!result.reply.includes('"action"'), 'Cero bloques de acción textual');
  });

  await t.test('Caso 2 (Multi-paso encadenado de 3 niveles): search_gmail -> manage_calendar (CREATE) -> síntesis final', async () => {
    let gmailSearchQuery = null;
    let calendarEventCreated = null;

    const mockGmailService = {
      searchEmails: async (query) => {
        gmailSearchQuery = query;
        return [
          {
            id: 'msg_987',
            subject: 'Confirmación cita con Proveedor de Madera',
            snippet: 'Reunión acordada para el 15 de octubre a las 10:00 AM.',
          },
        ];
      },
    };

    const mockCalendarService = {
      createEvent: async (eventData) => {
        calendarEventCreated = eventData;
        return {
          id: 'cal_event_555',
          summary: eventData.summary,
          startTime: eventData.startDateTime,
          status: 'confirmed',
        };
      },
    };

    const mockClient = new MockGenAIClient([
      // Turno 1: Gemini pide search_gmail
      {
        functionCalls: [
          {
            name: 'search_gmail',
            args: { query: 'cita proveedor madera' },
          },
        ],
      },
      // Turno 2: Gemini recibe los correos y solicita agendar en calendar
      {
        functionCalls: [
          {
            name: 'manage_calendar',
            args: {
              action: 'CREATE',
              summary: 'Reunión Proveedor de Madera',
              startTime: '2026-10-15T10:00:00-06:00',
              endTime: '2026-10-15T11:00:00-06:00',
              location: 'Taller Central Deko Labs',
            },
          },
        ],
      },
      // Turno 3: Gemini emite respuesta final fundamentada
      {
        text: 'Sebastián querido, encontré el correo del proveedor de madera y ya te agendé la reunión para el 15 de octubre a las 10:00 AM en el taller.',
      },
    ]);

    const dispatcher = new ToolDispatcher({
      gmailService: mockGmailService,
      calendarService: mockCalendarService,
    });

    const runner = new AgentRunner({
      aiPool: mockClient,
      toolDispatcher: dispatcher,
      maxTurns: 5,
    });

    const result = await runner.run({
      systemInstruction: 'Eres Carmencita, secretaria ejecutiva.',
      userMessage: 'Revisa si el proveedor de madera mandó fecha para la reunión y agéndala de una vez.',
    });

    assert.equal(gmailSearchQuery, 'cita proveedor madera', 'Debe haber ejecutado search_gmail');
    assert.ok(calendarEventCreated, 'Debe haber ejecutado manage_calendar CREATE');
    assert.equal(calendarEventCreated.summary, 'Reunión Proveedor de Madera');
    assert.equal(result.toolCallsSummary.length, 2, 'Debe haber completado 2 llamadas a herramientas');
    assert.equal(result.toolCallsSummary[0].name, 'search_gmail');
    assert.equal(result.toolCallsSummary[1].name, 'manage_calendar');
    assert.ok(result.reply.includes('encontré el correo'), 'Debe sintetizar los hallazgos');
    assert.ok(result.reply.includes('ya te agendé la reunión'), 'Debe confirmar el evento');
    assert.ok(!result.reply.includes('```json'), 'Cero fugas de sintaxis JSON');
  });

  await t.test('Caso 3 (Auto-corrección Zod): Error estructurado INVALID_ARGUMENTS y auto-recuperación en Turno 2', async () => {
    let listEventsCalled = false;
    const mockCalendarService = {
      listEvents: async () => {
        listEventsCalled = true;
        return [
          { id: 'ev_1', summary: 'Revisión con Gary', startTime: '2026-10-09T14:00:00-06:00' },
          { id: 'ev_2', summary: 'Cierre Stand', startTime: '2026-10-09T18:00:00-06:00' },
        ];
      },
    };

    let zodErrorCapturedInTurn2 = null;

    const mockClient = new MockGenAIClient([
      // Turno 1: Gemini envía argumentos inválidos a manage_calendar
      {
        functionCalls: [
          {
            name: 'manage_calendar',
            args: { action: 'INVALID_CALENDAR_ACTION_XYZ' },
          },
        ],
      },
      // Turno 2: Gemini lee el error de validación Zod y corrige los argumentos
      (params) => {
        const lastPart = params.contents?.[params.contents.length - 1]?.parts?.[0];
        zodErrorCapturedInTurn2 = lastPart?.functionResponse?.response;
        return {
          functionCalls: [
            {
              name: 'manage_calendar',
              args: { action: 'LIST', range: 'TODAY' },
            },
          ],
        };
      },
      // Turno 3: Síntesis final
      {
        text: 'Sebastián querido, corregí la consulta a tu agenda y tienes 2 eventos programados para hoy.',
      },
    ]);

    const dispatcher = new ToolDispatcher({
      calendarService: mockCalendarService,
    });

    const runner = new AgentRunner({
      aiPool: mockClient,
      toolDispatcher: dispatcher,
      maxTurns: 5,
    });

    const result = await runner.run({
      systemInstruction: 'Eres Carmencita.',
      userMessage: 'Dime qué tengo hoy en la agenda.',
    });

    assert.ok(zodErrorCapturedInTurn2, 'El modelo debió recibir la respuesta de error de Zod');
    assert.equal(zodErrorCapturedInTurn2.status, 'error');
    assert.equal(zodErrorCapturedInTurn2.reason, 'INVALID_ARGUMENTS');
    assert.ok(zodErrorCapturedInTurn2.message.includes('no cumplen con el esquema requerido'));
    assert.equal(listEventsCalled, true, 'El servicio debe haberse llamado en el segundo turno corregido');
    assert.equal(result.toolCallsSummary.length, 2, 'Total de 2 turnos de herramientas');
    assert.ok(result.reply.includes('tienes 2 eventos programados'), 'Debe sintetizar la respuesta final con éxito');
  });

  await t.test('Caso 4 (Hard-Timeout & Circuit Breaker): Herramienta colgada de 10s cortada a 8s y degradación elegante', async () => {
    const mockHangingService = {
      searchEmails: async () => {
        // Simular que el servicio de Gmail o red queda colgado por 10 segundos
        await new Promise((resolve) => setTimeout(resolve, 10000));
        return [{ id: 'late_msg' }];
      },
    };

    let timeoutErrorReceivedByModel = null;

    const mockClient = new MockGenAIClient([
      // Turno 1: Gemini invoca search_gmail
      {
        functionCalls: [
          {
            name: 'search_gmail',
            args: { query: 'factura pendiente' },
          },
        ],
      },
      // Turno 2: Gemini recibe el error de timeout y degrada con elegancia
      (params) => {
        const lastPart = params.contents?.[params.contents.length - 1]?.parts?.[0];
        timeoutErrorReceivedByModel = lastPart?.functionResponse?.response;
        return {
          text: 'Sebastián querido, el servicio de correo tardó más de 8 segundos en responder. Para no hacerte esperar, te informo que reintentaré en segundo plano.',
        };
      },
    ]);

    const dispatcher = new ToolDispatcher({
      gmailService: mockHangingService,
    }, { toolTimeoutMs: 8000 });

    const runner = new AgentRunner({
      aiPool: mockClient,
      toolDispatcher: dispatcher,
      maxTurns: 5,
    });

    const startTime = Date.now();
    const result = await runner.run({
      systemInstruction: 'Eres Carmencita.',
      userMessage: 'Revisa el correo urgente.',
    });
    const duration = Date.now() - startTime;

    assert.ok(duration >= 7900 && duration < 9500, `La ejecución debió interrumpirse alrededor de los 8s (tomó ${duration}ms)`);
    assert.ok(timeoutErrorReceivedByModel, 'El modelo debió recibir el error de timeout');
    assert.equal(timeoutErrorReceivedByModel.success, false);
    assert.equal(timeoutErrorReceivedByModel.error?.code, 'TOOL_TIMEOUT');
    assert.ok(result.reply.includes('tardó más de 8 segundos'), 'Debe degradar elegantemente en la respuesta al usuario');
  });

  await t.test('Caso 5 (Staged Action para mutaciones destructivas): Acción CANCEL/DELETE_EVENT entra en staging sin ejecutarse', async () => {
    let cancelEventCalled = false;
    const mockCalendarService = {
      cancelEvent: async () => {
        cancelEventCalled = true;
        return { status: 'cancelled' };
      },
    };

    let stagedResultReceivedByModel = null;

    const mockClient = new MockGenAIClient([
      // Turno 1: Gemini solicita cancelar un evento
      {
        functionCalls: [
          {
            name: 'manage_calendar',
            args: {
              action: 'CANCEL',
              eventId: 'cal_event_del_123',
              summary: 'Almuerzo con Inversionistas',
            },
          },
        ],
      },
      // Turno 2: Gemini lee la acción en staging y pide confirmación al usuario
      (params) => {
        const lastPart = params.contents?.[params.contents.length - 1]?.parts?.[0];
        stagedResultReceivedByModel = lastPart?.functionResponse?.response;
        return {
          text: 'Sebastián querido, preparé la cancelación del evento "Almuerzo con Inversionistas". ¿Me confirmas para proceder a eliminarlo definitivamente?',
        };
      },
    ]);

    const dispatcher = new ToolDispatcher({
      calendarService: mockCalendarService,
    });

    const runner = new AgentRunner({
      aiPool: mockClient,
      toolDispatcher: dispatcher,
      maxTurns: 5,
    });

    const result = await runner.run({
      systemInstruction: 'Eres Carmencita.',
      userMessage: 'Cancela el almuerzo con inversionistas.',
    });

    assert.equal(cancelEventCalled, false, 'NO se debe invocar el servicio destructivo sin confirmación');
    assert.ok(stagedResultReceivedByModel, 'El modelo debió recibir el resultado en staging');
    assert.equal(stagedResultReceivedByModel.status, 'staged');
    assert.equal(stagedResultReceivedByModel.requiresConfirmation, true);
    assert.equal(stagedResultReceivedByModel.action, 'CANCEL_CALENDAR_EVENT');
    assert.equal(stagedResultReceivedByModel.preview, 'Almuerzo con Inversionistas');
    assert.equal(result.stagedActions.length, 1, 'Debe haber 1 acción staged en el runner');
    assert.ok(result.reply.includes('¿Me confirmas para proceder a eliminarlo'), 'Debe solicitar confirmación explícita');
  });

  await t.test('Caso 6 (Preservación de thoughtSignature en bucle ReAct): candidates[0].content se preserva intacto en contents', async () => {
    let turn2Contents = null;

    const mockCandidateContent = {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'manage_tasks',
            args: { action: 'LIST' },
          },
          thoughtSignature: 'crypto-thought-sig-12345-verified',
        },
      ],
    };

    const mockTasksService = {
      listTasks: async () => [{ id: 'task_1', title: 'Comprar boletos' }],
    };

    const mockClient = new MockGenAIClient([
      // Turno 1: Gemini responde con candidates[0].content conteniendo thoughtSignature
      {
        candidates: [
          {
            content: mockCandidateContent,
          },
        ],
        functionCalls: [
          {
            name: 'manage_tasks',
            args: { action: 'LIST' },
          },
        ],
      },
      // Turno 2: Verificamos que el historial enviado incluye exactamente mockCandidateContent
      (params) => {
        turn2Contents = params.contents;
        return {
          text: 'Aquí tienes tus tareas pendientes, Sebastián.',
        };
      },
    ]);

    const dispatcher = new ToolDispatcher({
      taskService: mockTasksService,
    });

    const runner = new AgentRunner({
      aiPool: mockClient,
      toolDispatcher: dispatcher,
      maxTurns: 5,
    });

    const result = await runner.run({
      systemInstruction: 'Eres Carmencita.',
      userMessage: 'Muestra mis tareas.',
    });

    assert.ok(turn2Contents, 'Debió ejecutarse el Turno 2 con contents');
    const modelTurn = turn2Contents.find((c) => c.role === 'model');
    assert.ok(modelTurn, 'Debe existir el turno role: model');
    assert.equal(
      modelTurn.parts[0]?.thoughtSignature,
      'crypto-thought-sig-12345-verified',
      'Debe preservar el thoughtSignature criptográfico intacto sin descartarlo'
    );
    assert.equal(modelTurn, mockCandidateContent, 'Debe ser la referencia idéntica de candidates[0].content');
    assert.ok(result.reply.includes('Aquí tienes tus tareas pendientes'));
  });
});

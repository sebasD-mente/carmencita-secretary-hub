import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEventDates,
  handleWorkspaceAction,
  handleCalendarAction,
  handleGmailAction,
  handleTasksAction,
  handleContactsAction,
} from '../src/tools/workspace.tools.js';
import { CarmencitaBrain } from '../src/core/brain.js';

test('🏛️ Workspace Modular & RAG Concurrente — Suite Coercitiva [DEKO-CARMEN-044]', async (t) => {
  // 1. Exportación e integridad de formatEventDates y los 4 handlers modulares
  await t.test('1. Exportación e integridad de formatEventDates y los 4 handlers modulares', () => {
    assert.equal(typeof formatEventDates, 'function', 'formatEventDates debe ser una función');
    assert.equal(typeof handleCalendarAction, 'function', 'handleCalendarAction debe ser una función');
    assert.equal(typeof handleGmailAction, 'function', 'handleGmailAction debe ser una función');
    assert.equal(typeof handleTasksAction, 'function', 'handleTasksAction debe ser una función');
    assert.equal(typeof handleContactsAction, 'function', 'handleContactsAction debe ser una función');
    assert.equal(typeof handleWorkspaceAction, 'function', 'handleWorkspaceAction debe ser una función');

    // Validación de formateo de fechas
    const formatted = formatEventDates({
      start: '2026-10-15T09:00:00Z',
      end: '2026-10-15T10:00:00Z',
      summary: 'Reunión Ejecutiva',
    });
    assert.ok(formatted.summary, 'Debe generar summary');
    assert.ok(formatted.fallback, 'Debe generar fallback');
  });

  // 2. handleWorkspaceAction despacha correctamente a Calendar, Gmail, Tasks y Contacts retornando DTOs válidos
  await t.test('2. handleWorkspaceAction despacha a los 4 submódulos retornando DTOs puros', async () => {
    const mockDeps = {
      calendarService: {
        createEvent: async (ev) => ({
          id: 'cal_123',
          summary: ev.summary,
          start: ev.startDateTime,
          end: ev.endDateTime,
          location: ev.location,
          htmlLink: 'https://calendar.google.com/event/cal_123',
        }),
        getTodayEvents: async () => [
          { id: 'ev_1', summary: 'Reunión de Diseño', start: '2026-10-10T15:00:00Z' },
        ],
      },
      gmailService: {
        searchEmails: async () => [
          { id: 'msg_1', from: 'erick@dekolabs.org', subject: 'Actualización VPS', snippet: 'El servidor Dokploy está al 100%' },
        ],
      },
      taskService: {
        createTask: async (t) => ({ id: 'task_123', description: t.description, status: 'PENDIENTE' }),
        listTasks: async () => [
          { id: 'task_1', description: 'Revisar contratos de feria', status: 'PENDIENTE', priority: 'ALTA' },
        ],
      },
      contactService: {
        createOrUpdateContact: async (c) => ({ id: 'con_1', name: c.name, role: c.role, phone: c.phone }),
        searchContacts: async () => [
          { id: 'con_1', name: 'Gary CTO', role: 'CTO Local', phone: '+502 1234 5678' },
        ],
      },
    };

    // Calendar CREATE
    const resCalCreate = await handleWorkspaceAction({
      action: 'CREATE_CALENDAR_EVENT',
      summary: 'Reunión Gary y Sebastián',
      startDateTime: '2026-10-12T10:00:00Z',
      endDateTime: '2026-10-12T11:00:00Z',
    }, mockDeps);
    assert.ok(resCalCreate.hasCalendarEvent, 'Debe agendar evento');
    assert.ok(resCalCreate.data?.event?.id === 'cal_123', 'DTO debe contener el evento');

    // Calendar LIST
    const resCalList = await handleWorkspaceAction({
      action: 'LIST_CALENDAR_EVENTS',
      range: 'TODAY',
    }, mockDeps);
    assert.ok(resCalList.calendarEvents?.length > 0, 'Debe listar eventos');
    assert.equal(resCalList.data?.events?.length, 1, 'DTO debe contener eventos');

    // Gmail CHECK
    const resGmail = await handleWorkspaceAction({
      action: 'CHECK_GMAIL',
      query: 'VPS',
    }, mockDeps);
    assert.ok(resGmail.hasGmailEmails, 'Debe recuperar correos');
    assert.equal(resGmail.data?.emails?.length, 1, 'DTO debe contener emails');
    assert.equal(resGmail.data?.query, 'VPS');

    // Tasks SAVE
    const resTaskSave = await handleWorkspaceAction({
      action: 'SAVE_TASK',
      description: 'Preparar despliegue P0',
      priority: 'ALTA',
    }, mockDeps);
    assert.ok(resTaskSave.data?.success, 'DTO debe indicar éxito al guardar tarea');
    assert.equal(resTaskSave.data?.description, 'Preparar despliegue P0');

    // Tasks LIST
    const resTaskList = await handleWorkspaceAction({
      action: 'LIST_TASKS',
      status: 'PENDIENTE',
    }, mockDeps);
    assert.ok(resTaskList.hasTask, 'Debe encontrar tareas pendientes');
    assert.equal(resTaskList.data?.count, 1, 'DTO debe contener el conteo');

    // Contacts SAVE
    const resContactSave = await handleWorkspaceAction({
      action: 'SAVE_CONTACT',
      name: 'Erick Taveras',
      role: 'CTO DevOps',
      phone: '+1 809 000 0000',
    }, mockDeps);
    assert.ok(resContactSave.data?.success, 'DTO debe registrar contacto');
    assert.equal(resContactSave.data?.contact?.name, 'Erick Taveras');

    // Contacts SEARCH
    const resContactSearch = await handleWorkspaceAction({
      action: 'SEARCH_CONTACT',
      query: 'Gary',
    }, mockDeps);
    assert.ok(resContactSearch.contacts?.length > 0, 'Debe encontrar contactos');
    assert.equal(resContactSearch.data?.count, 1, 'DTO debe contener resultados');
  });

  // 3. _resolveRAGContext en CarmencitaBrain ejecuta concurrentemente directivas y memorias afines
  await t.test('3. _resolveRAGContext ejecuta concurrentemente directivas y memorias afines con Promise.all', async () => {
    let directivesCalled = false;
    let memoriesCalled = false;

    const mockEmbeddingService = {
      getActiveDirectives: async () => {
        directivesCalled = true;
        await new Promise((r) => setTimeout(r, 20));
        return [{ content: 'Directiva 1: Cero supuestos' }];
      },
      searchSimilarMemories: async (query, opts) => {
        memoriesCalled = true;
        await new Promise((r) => setTimeout(r, 20));
        return [
          { category: 'ACUERDO', content: 'Acuerdo con carpintería de pino', similarity: 0.89 },
        ];
      },
    };

    const brain = new CarmencitaBrain({
      embeddingService: mockEmbeddingService,
    });

    const start = Date.now();
    const { directivesBlock, memoriesBlock } = await brain._resolveRAGContext('acuerdo carpinteria');
    const elapsed = Date.now() - start;

    assert.ok(directivesCalled, 'Debe haber invocado getActiveDirectives');
    assert.ok(memoriesCalled, 'Debe haber invocado searchSimilarMemories');
    assert.ok(directivesBlock.includes('DIRECTIVAS CARDINALES ACTIVAS'), 'directivesBlock debe incluir directivas');
    assert.ok(memoriesBlock.includes('Acuerdo con carpintería de pino'), 'memoriesBlock debe incluir contenido');
    assert.ok(memoriesBlock.includes('(Afinidad: 89%)'), 'memoriesBlock debe incluir porcentaje de afinidad');

    // Demostración empírica de concurrencia: si corrieran en serie tardarían >= 40ms; en paralelo tardan < 39ms
    assert.ok(elapsed < 39, `Debieron ejecutarse concurrentemente en paralelo (elapsed: ${elapsed}ms)`);
  });
});

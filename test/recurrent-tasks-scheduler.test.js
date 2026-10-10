import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskService } from '../src/services/task.service.js';
import { SchedulerService } from '../src/services/scheduler.service.js';
import { isImportantEmail, isPromotionalOrNoise } from '../src/services/gmail.service.js';
import { MEMORY_EXTRACT_PROMPT } from '../src/core/carmencita.prompt.js';

test('🧠 Suite Coercitiva: Blindaje Proactivo, Tareas Recurrentes y Scheduler Persistente [DEKO-CARMEN-045]', async (t) => {
  // 1. Parser heurístico de intervalos en TaskService
  await t.test('1. _parseRecurrence detecta con precisión horas, días y frecuencias periódicas', () => {
    const service = new TaskService();

    const case2Hours = service._parseRecurrence('Recuérdame revisar el stand cada 2 horas');
    assert.equal(case2Hours.isRecurring, true);
    assert.equal(case2Hours.intervalHours, 2);

    const case1Hour = service._parseRecurrence('Chequear estado de Dokploy cada hora');
    assert.equal(case1Hour.isRecurring, true);
    assert.equal(case1Hour.intervalHours, 1);

    const case3Days = service._parseRecurrence('Dar mantenimiento preventivo cada 3 días');
    assert.equal(case3Days.isRecurring, true);
    assert.equal(case3Days.intervalHours, 72);

    const caseDaily = service._parseRecurrence('Revisar facturación cada día');
    assert.equal(caseDaily.isRecurring, true);
    assert.equal(caseDaily.intervalHours, 24);

    const caseNone = service._parseRecurrence('Comprar 50 tornillos para el stand de Deco Vintage');
    assert.equal(caseNone.isRecurring, false);
    assert.equal(caseNone.intervalHours, null);
  });

  // 2. Creación y asignación automática de dueDate en tareas recurrentes
  await t.test('2. createTask asigna isRecurring, intervalHours y primer dueDate automático si no viene explícito', async () => {
    let createdRecord = null;
    const mockPrisma = {
      task: {
        create: async ({ data }) => {
          createdRecord = { id: 'task_rec_1', ...data };
          return createdRecord;
        },
      },
    };

    const taskService = new TaskService(mockPrisma, null);
    const beforeNow = Date.now();
    const result = await taskService.createTask({
      description: 'Llamar al suplidor de madera cada 4 horas',
      priority: 'ALTA',
    });

    assert.equal(result.isRecurring, true);
    assert.equal(result.intervalHours, 4);
    assert.ok(result.dueDate instanceof Date, 'dueDate debe haber sido calculado');
    const expectedMinMs = beforeNow + 4 * 60 * 60 * 1000 - 1000;
    const expectedMaxMs = Date.now() + 4 * 60 * 60 * 1000 + 1000;
    assert.ok(result.dueDate.getTime() >= expectedMinMs && result.dueDate.getTime() <= expectedMaxMs);
  });

  // 3. Scheduler reprograma dinámicamente tareas recurrentes sumando intervalHours
  await t.test('3. checkPendingTasks reprograma tareas recurrentes y no las silencia con notifiedAt', async () => {
    const referenceDate = new Date('2026-10-10T14:00:00.000Z');
    let updatedPayload = null;

    const mockTask = {
      id: 'task_midas_1',
      description: 'Revisar balance de caja cada 2 horas',
      dueDate: new Date('2026-10-10T13:30:00.000Z'),
      priority: 'ALTA',
      status: 'PENDIENTE',
      isRecurring: true,
      intervalHours: 2,
      executionCount: 0,
      notifiedAt: null,
    };

    let dispatchedTelegramText = null;
    const mockPrisma = {
      task: {
        findMany: async ({ where }) => {
          assert.equal(where.status, 'PENDIENTE');
          assert.ok(where.OR, 'Debe incluir clausula OR para recurrentes');
          return [mockTask];
        },
        update: async ({ where, data }) => {
          updatedPayload = { id: where.id, ...data };
          return { ...mockTask, ...data };
        },
      },
    };

    const mockTelegram = {
      sendMessage: async (_chatId, text) => {
        dispatchedTelegramText = text;
      },
    };

    const scheduler = new SchedulerService({
      prisma: mockPrisma,
      telegramAdapter: mockTelegram,
    });

    const result = await scheduler.checkPendingTasks(referenceDate);

    assert.equal(result.length, 1);
    assert.ok(dispatchedTelegramText.includes('Revisar balance de caja cada 2 horas'));
    assert.ok(updatedPayload, 'Debe haber actualizado la tarea en base de datos');
    assert.equal(updatedPayload.id, 'task_midas_1');
    assert.equal(updatedPayload.executionCount.increment, 1);
    // Nuevo dueDate debe ser referenceDate + 2 horas = 16:00:00
    const expectedNextDue = new Date(referenceDate.getTime() + 2 * 60 * 60 * 1000);
    assert.equal(updatedPayload.dueDate.getTime(), expectedNextDue.getTime());
  });

  // 4. Persistencia Soberana de Radar Gmail en PostgreSQL (Inmune a Reinicios)
  await t.test('4. checkInboxWatchdog persiste correos en NotifiedEmail y evita repeticiones tras reinicio', async () => {
    const referenceDate = new Date('2026-10-10T15:00:00-06:00'); // 3 PM Guatemala
    const notifiedEmailDB = new Map();

    const mockPrisma = {
      notifiedEmail: {
        findUnique: async ({ where }) => {
          return notifiedEmailDB.get(where.emailId) || null;
        },
        create: async ({ data }) => {
          notifiedEmailDB.set(data.emailId, data);
          return data;
        },
      },
    };

    const mockGmailMessages = [
      {
        id: 'msg_banco_100',
        from: 'notificaciones@bi.com.gt',
        subject: 'Transferencia recibida por Q15,000.00',
        snippet: 'Se ha acreditado el pago de cliente VIP para Deco Vintage',
      },
    ];

    const mockGmailService = {
      getUnreadInboxMessages: async () => mockGmailMessages,
    };

    let dispatchCount = 0;
    const mockTelegram = {
      sendMessage: async () => {
        dispatchCount++;
      },
    };

    // Instancia 1: Servidor en ejecución
    const scheduler1 = new SchedulerService({
      prisma: mockPrisma,
      gmailService: mockGmailService,
      telegramAdapter: mockTelegram,
    });

    const firstRun = await scheduler1.checkInboxWatchdog(referenceDate, true);
    assert.equal(firstRun.length, 1, 'Primera pasada debe notificar el correo');
    assert.equal(dispatchCount, 1);
    assert.ok(notifiedEmailDB.has('msg_banco_100'), 'Debe haberlo registrado en PostgreSQL NotifiedEmail');

    // Instancia 2: Simulación de reinicio completo del contenedor/servidor
    // La memoria RAM volátil se inicializa limpia (Set vacío)
    const scheduler2 = new SchedulerService({
      prisma: mockPrisma,
      gmailService: mockGmailService,
      telegramAdapter: mockTelegram,
      notifiedEmailIds: [], // Set vacío post-reboot
    });

    const secondRun = await scheduler2.checkInboxWatchdog(referenceDate, true);
    assert.equal(secondRun.length, 0, 'Segunda pasada post-reboot debe descartar por DB y no volver a notificar');
    assert.equal(dispatchCount, 1, 'No debe disparar mensajes duplicados a Telegram');
  });

  // 5. Erradicación del Filtro de Fin de Semana (Operación 24/7/365) y Midday Briefing
  await t.test('5. checkMiddaySync y checkEveningDebrief operan en sábado y domingo llamando a buildMiddayBriefing', async () => {
    // Sábado 10 de octubre de 2026, 1:05 PM Guatemala
    const saturdayMidday = new Date('2026-10-10T13:05:00-06:00');

    let middayBriefBuilt = false;
    let telegramDispatched = null;

    const mockExecutiveBriefingService = {
      buildMiddayBriefing: async ({ date }) => {
        middayBriefBuilt = true;
        return {
          text: '☕ <b>Check-in de mitad de jornada</b>\n\nResumen ejecutivo de las 01:00 PM.',
          data: { date },
        };
      },
      buildEveningBriefing: async () => ({
        text: '✨ <b>Debriefing vespertino de sábado</b>',
      }),
    };

    const mockTelegram = {
      sendMessage: async (_chatId, text) => {
        telegramDispatched = text;
      },
    };

    const scheduler = new SchedulerService({
      telegramAdapter: mockTelegram,
      executiveBriefingService: mockExecutiveBriefingService,
    });

    const middayResult = await scheduler.checkMiddaySync(saturdayMidday);
    assert.ok(middayBriefBuilt, 'buildMiddayBriefing debe ser invocado en fin de semana sin censura');
    assert.ok(middayResult.includes('Check-in de mitad de jornada'));
    assert.ok(telegramDispatched.includes('Check-in de mitad de jornada'));

    // Domingo 11 de octubre de 2026, 6:32 PM Guatemala
    const sundayEvening = new Date('2026-10-11T18:32:00-06:00');
    let eveningDispatched = false;
    mockTelegram.sendMessage = async () => {
      eveningDispatched = true;
    };

    const eveningResult = await scheduler.checkEveningDebrief(sundayEvening);
    assert.ok(eveningResult, 'Evening debrief debe ejecutarse en domingo');
    assert.equal(eveningDispatched, true);
  });

  // 6. Doble Blindaje y Taxonomía en MEMORY_EXTRACT_PROMPT
  await t.test('6. MEMORY_EXTRACT_PROMPT exige taxonomía de 6 categorías y compuerta coercitiva de descarte', () => {
    const prompt = MEMORY_EXTRACT_PROMPT('recuérdame cada 2 horas comprar tornillos', 'Entendido, lo agendo.');

    // 6 categorías positivas
    assert.ok(prompt.includes('DIRECTIVA_GOBERNANZA'));
    assert.ok(prompt.includes('PREFERENCIA'));
    assert.ok(prompt.includes('ACUERDO'));
    assert.ok(prompt.includes('PROVEEDOR'));
    assert.ok(prompt.includes('FAMILIA_Y_VINCULOS'));
    assert.ok(prompt.includes('CONTEXTO_EMPRESARIAL'));

    // Compuerta coercitiva de descarte
    assert.ok(prompt.includes('COMPUERTA COERCITIVA DE DESCARTE'));
    assert.ok(prompt.includes('"shouldSave": false'));
    assert.ok(prompt.includes('"reason": "ACCION_TRANSACCIONAL_EFIMERA"'));
  });

  // 7. Filtro Agéntico de Gmail sin agujeros negros para remitentes oficiales
  await t.test('7. isImportantEmail rescata bancos, sat, google y palabras transaccionales descartando spam', () => {
    // 1. Remitente oficial bancario sin palabras rígidas
    assert.equal(
      isImportantEmail({
        from: 'notificaciones@bi.com.gt',
        subject: 'Actualización en su saldo disponible',
        snippet: 'Estimado cliente, su saldo ha cambiado',
      }),
      true
    );

    // 2. SAT de Guatemala
    assert.equal(
      isImportantEmail({
        from: 'avisos@sat.gob.gt',
        subject: 'Notificación de buzón tributario',
        snippet: 'Se le informa la recepción de un documento electrónico',
      }),
      true
    );

    // 3. Google Workspace / Dokploy
    assert.equal(
      isImportantEmail({
        from: 'alerts@google.com',
        subject: 'Alerta de inicio de sesión o servicio',
        snippet: 'Nuevo dispositivo detectado',
      }),
      true
    );

    // 4. Correo legítimo de negocio
    assert.equal(
      isImportantEmail({
        from: 'arq.morales@estudio-diseno.com',
        subject: 'Presupuesto y propuesta de stand ferial',
        snippet: 'Adjunto el desglose de materiales para Deco Vintage',
      }),
      true
    );

    // 5. Spam / Publicidad / Redes sociales debe descartarse
    assert.equal(
      isImportantEmail({
        from: 'promociones@deals-marketing.com',
        subject: '50% off en cursos de fin de semana',
        snippet: 'Aprovecha el descuento exclusivo semanal',
        hasUnsubscribe: true,
      }),
      false
    );
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmailTriageService,
  EmailCategory,
  EmailUrgency,
  EmailTriageOutputSchema,
} from '../src/services/email-triage.service.js';
import { GmailService, DEFAULT_GMAIL_QUERY } from '../src/services/gmail.service.js';
import { SchedulerService } from '../src/services/scheduler.service.js';

test('🧠 Suite Coercitiva: Motor de Triaje Cognitivo Gmail, Radar VIP y Canal de Emergencia [DEKO-CARMEN-047]', async (t) => {
  await t.test('1. DEFAULT_GMAIL_QUERY elimina category:primary para visibilizar actualizaciones de infraestructura y bancos', () => {
    assert.ok(!DEFAULT_GMAIL_QUERY.includes('category:primary'), 'No debe excluir la categoría primary ni forzarla');
    assert.ok(DEFAULT_GMAIL_QUERY.includes('label:INBOX'), 'Debe buscar en INBOX');
    assert.ok(DEFAULT_GMAIL_QUERY.includes('-category:social'), 'Debe excluir redes sociales');
    assert.ok(DEFAULT_GMAIL_QUERY.includes('-category:promotions'), 'Debe excluir promociones');
  });

  await t.test('2. classifyEmail asigna CRITICO e INFRAESTRUCTURA a alertas de Google sobre spend caps, seguridad y claves', async () => {
    const triage = new EmailTriageService();

    // Caso A: Límite de presupuesto / Spend Cap
    const resSpendCap = await triage.classifyEmail({
      from: 'Google Cloud Billing <billing-noreply@google.com>',
      subject: 'Alerta de presupuesto: Spend cap superado en proyecto carmencita-hub',
      snippet: 'El presupuesto mensual ha alcanzado el 100% de la cuota asignada.',
      bodyText: 'Su proyecto carmencita-hub superó el límite de gasto en Google Cloud Platform.',
    });
    assert.equal(resSpendCap.category, EmailCategory.INFRAESTRUCTURA);
    assert.equal(resSpendCap.urgency, EmailUrgency.CRITICO);
    assert.equal(resSpendCap.isActionable, true);

    // Caso B: Seguridad y 2FA / Passkeys
    const resSecurity = await triage.classifyEmail({
      from: 'Google Accounts <no-reply@accounts.google.com>',
      subject: 'Alerta de seguridad: Nueva passkey agregada o verificación 2FA requerida',
      snippet: 'Hemos detectado un intento de inicio de sesión sospechoso.',
    });
    assert.equal(resSecurity.category, EmailCategory.INFRAESTRUCTURA);
    assert.equal(resSecurity.urgency, EmailUrgency.CRITICO);
  });

  await t.test('3. classifyEmail asigna CRITICO y FINANCIERO a transferencias de Banco Industrial y avisos SAT', async () => {
    const triage = new EmailTriageService();

    // Caso A: Banco Industrial (BI)
    const resBI = await triage.classifyEmail({
      from: 'Banco Industrial <notificaciones@bi.com.gt>',
      subject: 'Transferencia recibida por GTQ 3,500.00',
      snippet: 'Se ha acreditado una transferencia ACH a su cuenta monetaria en Banco Industrial.',
    });
    assert.equal(resBI.category, EmailCategory.FINANCIERO);
    assert.equal(resBI.urgency, EmailUrgency.CRITICO);
    assert.equal(resBI.isActionable, true);

    // Caso B: SAT Guatemala (Declaraguate)
    const resSAT = await triage.classifyEmail({
      from: 'SAT Guatemala <avisos@sat.gob.gt>',
      subject: 'Notificación de Declaraguate pendiente de pago',
      snippet: 'Su formulario fiscal SAT-2026 tiene un saldo pendiente de liquidación.',
    });
    assert.equal(resSAT.category, EmailCategory.FINANCIERO);
    assert.equal(resSAT.urgency, EmailUrgency.CRITICO);
  });

  await t.test('4. classifyEmail descarta como RUIDO correos publicitarios de Uber Eats y Spotify', async () => {
    const triage = new EmailTriageService();

    // Caso A: Uber Eats
    const resUber = await triage.classifyEmail({
      from: 'Uber Eats <eats@uber.com>',
      subject: '50% de descuento en tu almuerzo de hoy con este cupón',
      snippet: 'Pide tu comida favorita con envío gratis y ahorra en tu pedido.',
    });
    assert.equal(resUber.category, EmailCategory.RUIDO);
    assert.equal(resUber.urgency, EmailUrgency.RUIDO);
    assert.equal(resUber.isActionable, false);

    // Caso B: Spotify
    const resSpotify = await triage.classifyEmail({
      from: 'Spotify <no-reply@spotify.com>',
      subject: 'Consigue 3 meses gratis de Spotify Premium',
      snippet: 'Disfruta de música sin límites ni anuncios durante el verano.',
    });
    assert.equal(resSpotify.category, EmailCategory.RUIDO);
    assert.equal(resSpotify.urgency, EmailUrgency.RUIDO);
    assert.equal(resSpotify.isActionable, false);
  });

  await t.test('5. classifyEmail reconoce canal asíncrono de emergencia cuando el remitente es Sebastián', async () => {
    const triage = new EmailTriageService();

    // Caso A: Asunto que inicia con "Carmencita:"
    const resEmergencyA = await triage.classifyEmail({
      from: 'Sebastián Jiménez <sebasjimenez0330@gmail.com>',
      subject: 'Carmencita: Por favor envía el presupuesto de Deco Vintage urgentemente',
      snippet: 'Se me descargó el teléfono fuera de casa, procesa esto de inmediato.',
    });
    assert.equal(resEmergencyA.category, EmailCategory.EMERGENCIA_SEBASTIAN);
    assert.equal(resEmergencyA.urgency, EmailUrgency.CRITICO);
    assert.equal(resEmergencyA.isActionable, true);

    // Caso B: Asunto con "Para Carmencita:"
    const resEmergencyB = await triage.classifyEmail({
      from: 'sebasjimenez0330@gmail.com',
      subject: 'Para Carmencita: Revisa el servidor VPS de Hostinger',
      snippet: 'Confírmame si el contenedor de Dokploy sigue arriba.',
    });
    assert.equal(resEmergencyB.category, EmailCategory.EMERGENCIA_SEBASTIAN);
    assert.equal(resEmergencyB.urgency, EmailUrgency.CRITICO);

    // Caso C: Dirección dirigida al alias de emergencia
    const resEmergencyC = await triage.classifyEmail({
      from: 'sebasjimenez0330@gmail.com',
      to: 'sebasjimenez0330+carmencita@gmail.com',
      subject: 'Instrucción de contingencia',
      snippet: 'Ejecutar script de respaldo.',
    });
    assert.equal(resEmergencyC.category, EmailCategory.EMERGENCIA_SEBASTIAN);
    assert.equal(resEmergencyC.urgency, EmailUrgency.CRITICO);
  });

  await t.test('6. classifyEmail con mock LLM valida estructuración Zod y respeta guardarraíles VIP', async () => {
    const mockAi = {
      models: {
        generateContent: async () => ({
          text: () => JSON.stringify({
            category: 'INFRAESTRUCTURA',
            urgency: 'CRITICO',
            isActionable: true,
            executiveReason: 'Alerta crítica de cuota de API en Google AI Studio',
            oneLineSummary: 'Google AI Studio: Cuota de API al 95%',
          }),
        }),
      },
    };

    const triage = new EmailTriageService({ ai: mockAi });
    const res = await triage.classifyEmail({
      from: 'Google Developers <google-noreply@google.com>',
      subject: 'Cuota de API próxima al agotamiento',
      snippet: 'Su proyecto ha consumido el 95% de tokens.',
    });

    assert.equal(res.category, 'INFRAESTRUCTURA');
    assert.equal(res.urgency, 'CRITICO');
    assert.equal(res.isActionable, true);
    assert.ok(res.oneLineSummary.includes('Google AI Studio'));

    const parsed = EmailTriageOutputSchema.safeParse(res);
    assert.ok(parsed.success, 'El resultado debe validar estrictamente contra EmailTriageOutputSchema');
  });

  await t.test('7. sendEmail formatea RFC 2822 en base64url, impone asunto "Carmencita Comunica:" a Sebastián y despacha al API', async () => {
    let capturedCall = null;
    const mockGmailClient = {
      users: {
        messages: {
          send: async (params) => {
            capturedCall = params;
            return { data: { id: 'sent_msg_abc123' } };
          },
        },
      },
    };

    const gmailService = new GmailService({ gmailClient: mockGmailClient });
    const sendResult = await gmailService.sendEmail({
      to: 'sebasjimenez0330@gmail.com',
      subject: 'Presupuesto de Stands Deco Vintage',
      bodyText: 'Hola Sebas, adjunto el desglose solicitado.',
    });

    assert.equal(sendResult.success, true);
    assert.equal(sendResult.messageId, 'sent_msg_abc123');
    assert.ok(capturedCall, 'Se debió llamar a messages.send');
    assert.equal(capturedCall.userId, 'me');

    const decoded = Buffer.from(capturedCall.requestBody.raw, 'base64url').toString('utf-8');
    assert.ok(decoded.includes('To: sebasjimenez0330@gmail.com'));
    assert.ok(decoded.includes('MIME-Version: 1.0'));
    assert.ok(decoded.includes('Subject: =?utf-8?B?'));

    // Verificar que el asunto decodificado empiece con "Carmencita Comunica:"
    const subjectMatch = decoded.match(/Subject: =\?utf-8\?B\?([^?]+)\?=/);
    assert.ok(subjectMatch, 'El asunto debe estar codificado en Base64 UTF-8');
    const rawSubject = Buffer.from(subjectMatch[1], 'base64').toString('utf-8');
    assert.ok(rawSubject.startsWith('Carmencita Comunica:'), `El asunto debe iniciar con el prefijo obligatorio: "${rawSubject}"`);
  });

  await t.test('8. checkInboxWatchdog respeta ciclo de throttling de 5 minutos', async () => {
    const scheduler = new SchedulerService({
      gmailService: { getUnreadInboxMessages: async () => [] },
    });

    const t0 = new Date('2026-10-10T10:00:00-06:00');
    await scheduler.checkInboxWatchdog(t0, true);
    assert.equal(scheduler.lastInboxCheckTime, t0.getTime());

    // 2 minutos después: debe ignorarse por throttling (< 5 min)
    const t2min = new Date('2026-10-10T10:02:00-06:00');
    const skipped = await scheduler.checkInboxWatchdog(t2min, false);
    assert.equal(skipped.length, 0);

    // 5 minutos + 1s después: debe ejecutarse
    const t5min = new Date('2026-10-10T10:05:01-06:00');
    await scheduler.checkInboxWatchdog(t5min, false);
    assert.equal(scheduler.lastInboxCheckTime, t5min.getTime());
  });

  await t.test('9. checkInboxWatchdog consolida múltiples correos prioritarios en un único mensaje de Telegram (Batching)', async () => {
    const capturedTg = [];
    const mockTelegram = {
      sendMessage: async (chatId, text) => {
        capturedTg.push({ chatId, text });
      },
    };

    const mockEmails = [
      {
        id: 'mail_google_01',
        from: 'Google Cloud Platform <billing@google.com>',
        subject: 'Límite de presupuesto superado en proyecto Deko Labs',
        snippet: 'Gasto al 105% de la cuota.',
      },
      {
        id: 'mail_bi_02',
        from: 'Banco Industrial <avisos@bi.com.gt>',
        subject: 'Transferencia recibida por GTQ 5,000.00',
        snippet: 'Acreditado a cuenta 001.',
      },
      {
        id: 'mail_spam_03',
        from: 'Uber Eats <promo@uber.com>',
        subject: 'Cupón de 30% en comida',
        snippet: 'Aprovecha hoy mismo.',
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
      gmailService: { getUnreadInboxMessages: async () => mockEmails },
      prisma: mockPrisma,
    });

    const now = new Date('2026-10-10T11:00:00-06:00');
    const result = await scheduler.checkInboxWatchdog(now, true);

    // Solo los 2 prioritarios deben ser alertados y registrados
    assert.equal(result.length, 2);
    assert.equal(notifiedDb.length, 2);
    assert.ok(scheduler.notifiedEmailIds.has('mail_google_01'));
    assert.ok(scheduler.notifiedEmailIds.has('mail_bi_02'));
    assert.ok(!scheduler.notifiedEmailIds.has('mail_spam_03'));

    // Se emitió exactamente 1 mensaje consolidado a Telegram (Batching) con síntesis ejecutiva
    assert.equal(capturedTg.length, 1);
    const batchMessage = capturedTg[0].text;
    assert.ok(batchMessage.includes('Google Cloud Platform'));
    assert.ok(batchMessage.includes('Banco Industrial'));
    assert.ok(!batchMessage.includes('Uber Eats'));
    assert.ok(!batchMessage.includes('¿Deseas que prepare alguna respuesta'));
    assert.ok(!batchMessage.includes('¿Quieres que prepare una respuesta'));
  });

  await t.test('10. checkInboxWatchdog procesa directiva de emergencia de Sebastián y responde automáticamente vía Gmail', async () => {
    let sentEmailPayload = null;
    let brainReceivedPrompt = null;

    const mockGmail = {
      getUnreadInboxMessages: async () => [
        {
          id: 'mail_emergency_99',
          from: 'Sebastián Jiménez <sebasjimenez0330@gmail.com>',
          subject: 'Carmencita: Revisa el estatus de la cotización para Midas',
          snippet: 'Favor confirmar si se envió el PDF.',
          bodyText: 'Carmencita: Revisa el estatus de la cotización para Midas. Favor confirmar si se envió el PDF.',
        },
      ],
      sendEmail: async (payload) => {
        sentEmailPayload = payload;
        return { success: true, messageId: 'reply_msg_777' };
      },
    };

    const mockBrain = {
      processTextMessage: async (params) => {
        brainReceivedPrompt = params;
        return 'Sebas, he verificado la cotización de Midas y el PDF fue entregado con éxito.';
      },
    };

    const mockPrisma = {
      notifiedEmail: {
        findUnique: async () => null,
        create: async ({ data }) => data,
      },
    };

    const scheduler = new SchedulerService({
      gmailService: mockGmail,
      brain: mockBrain,
      prisma: mockPrisma,
    });

    const now = new Date('2026-10-10T12:00:00-06:00');
    const result = await scheduler.checkInboxWatchdog(now, true);

    assert.equal(result.length, 1);
    assert.equal(result[0].isEmergency, true);

    // Brain fue invocado
    assert.ok(brainReceivedPrompt, 'CarmencitaBrain debe procesar el correo de emergencia');
    const textPassed = typeof brainReceivedPrompt === 'string' ? brainReceivedPrompt : brainReceivedPrompt.text;
    assert.ok(textPassed.includes('Midas'));

    // Respuesta enviada por correo
    assert.ok(sentEmailPayload, 'Debe enviar un correo de respuesta a Sebastián');
    assert.equal(sentEmailPayload.to, 'sebasjimenez0330@gmail.com');
    assert.ok(sentEmailPayload.subject.startsWith('Carmencita Comunica: Re:'));
    assert.ok(sentEmailPayload.bodyText.includes('Sebas, he verificado la cotización de Midas'));
    assert.ok(scheduler.notifiedEmailIds.has('mail_emergency_99'));
  });

  await t.test('11. generateExecutiveEmailBriefing genera síntesis cognitiva con LLM sin plantillas rígidas ni preguntas acartonadas [DEKO-CARMEN-048]', async () => {
    let capturedPrompt = '';
    const mockAi = {
      models: {
        generateContent: async ({ contents }) => {
          capturedPrompt = contents;
          return {
            text: () => '✉️ <b>Sebas</b>: Carlos de ComicCon escribió consultando dimensiones de stands. Te preparo un borrador cuando gustes.',
          };
        },
      },
    };

    const triage = new EmailTriageService({ ai: mockAi });
    const briefing = await triage.generateExecutiveEmailBriefing([
      {
        email: { from: 'Carlos Mendoza <carlos@comiccon.gt>', subject: 'Medidas Stand ComicCon', snippet: 'Hola Sebas, requerimos medidas.' },
        classification: { category: EmailCategory.CLIENTE_NEGOCIO, urgency: EmailUrgency.ALTA, oneLineSummary: 'ComicCon: Solicitud de medidas de stand' },
      },
    ]);

    assert.ok(briefing.includes('Carlos de ComicCon'));
    assert.ok(!briefing.includes('¿Deseas que prepare una respuesta o lo revisamos más tarde?'));
    assert.ok(!briefing.includes('¿Deseas que prepare alguna respuesta'));
    assert.ok(capturedPrompt.includes('CERO PLANTILLAS QUEMADAS'));
    assert.ok(capturedPrompt.includes('DISCERNIMIENTO REAL'));
  });

  await t.test('12. generateExecutiveEmailBriefing identifica correos automáticos o no-reply e indica que no requieren acción de Sebastián [DEKO-CARMEN-048]', async () => {
    const triage = new EmailTriageService(); // usa fallback dinámico sin IA

    const briefingNoReply = await triage.generateExecutiveEmailBriefing([
      {
        email: { from: 'Apple <no_reply@email.apple.com>', subject: 'Tu recibo de Apple', snippet: 'Suscripción iCloud renovada.' },
        classification: { category: EmailCategory.SUSCRIPCION, urgency: EmailUrgency.ALTA, oneLineSummary: 'Recibo de renovación Apple' },
      },
      {
        email: { from: 'Google Payments <payments-noreply@google.com>', subject: 'Confirmación de pago de Google Cloud', snippet: 'Pago procesado exitosamente.' },
        classification: { category: EmailCategory.INFRAESTRUCTURA, urgency: EmailUrgency.CRITICO, oneLineSummary: 'Google Cloud: Pago procesado' },
      },
    ]);

    assert.ok(!briefingNoReply.includes('¿Deseas que prepare una respuesta'));
    assert.ok(!briefingNoReply.includes('¿Quieres que prepare una respuesta'));
    assert.ok(briefingNoReply.includes('Apple'));
    assert.ok(briefingNoReply.includes('Google Payments'));
    assert.ok(briefingNoReply.includes('actualizaciones automáticas') || briefingNoReply.includes('no requiere') || briefingNoReply.includes('en orden'));
  });

  await t.test('13. checkInboxWatchdog descarta correos con más de 2 horas de antigüedad sin disparar Telegram y los registra silenciosamente [DEKO-CARMEN-048]', async () => {
    const capturedTg = [];
    const mockTelegram = {
      sendMessage: async (chatId, text) => {
        capturedTg.push({ chatId, text });
      },
    };

    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const oldEmails = [
      {
        id: 'mail_old_apple_receipt',
        from: 'Apple <no_reply@email.apple.com>',
        subject: 'Recibo antiguo de suscripción',
        snippet: 'Factura del 9 de octubre.',
        date: threeHoursAgo,
      },
      {
        id: 'mail_old_gcp_bill',
        from: 'Google Cloud Billing <billing@google.com>',
        subject: 'Resumen de facturación de hace 2 días',
        snippet: 'Resumen mensual.',
        date: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
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
      gmailService: { getUnreadInboxMessages: async () => oldEmails },
      prisma: mockPrisma,
    });

    const now = new Date();
    const result = await scheduler.checkInboxWatchdog(now, true);

    // No se envía ninguna notificación a Telegram
    assert.equal(capturedTg.length, 0);
    assert.equal(result.length, 0);

    // Fueron registrados silenciosamente en NotifiedEmail para evitar reprocesamiento
    assert.equal(notifiedDb.length, 2);
    assert.ok(scheduler.notifiedEmailIds.has('mail_old_apple_receipt'));
    assert.ok(scheduler.notifiedEmailIds.has('mail_old_gcp_bill'));
  });

  await t.test('14. checkInboxWatchdog procesa correos frescos dentro de la ventana de 2 horas y genera síntesis ejecutiva dinámica [DEKO-CARMEN-048]', async () => {
    const capturedTg = [];
    const mockTelegram = {
      sendMessage: async (chatId, text) => {
        capturedTg.push({ chatId, text });
      },
    };

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const freshEmails = [
      {
        id: 'mail_fresh_lead',
        from: 'Feria Midas <ventas@midas.gt>',
        subject: 'Cotización Urgente para Stand Feria Central',
        snippet: 'Requerimos cotización hoy mismo.',
        date: thirtyMinutesAgo,
      },
    ];

    const mockPrisma = {
      notifiedEmail: {
        findUnique: async () => null,
        create: async ({ data }) => data,
      },
    };

    const scheduler = new SchedulerService({
      telegramAdapter: mockTelegram,
      gmailService: { getUnreadInboxMessages: async () => freshEmails },
      prisma: mockPrisma,
    });

    const now = new Date();
    const result = await scheduler.checkInboxWatchdog(now, true);

    assert.equal(result.length, 1);
    assert.equal(capturedTg.length, 1);
    const tgMsg = capturedTg[0].text;
    assert.ok(tgMsg.includes('Feria Midas'));
    assert.ok(tgMsg.includes('Cotización Urgente para Stand Feria Central'));
    assert.ok(!tgMsg.includes('¿Deseas que prepare una respuesta o lo revisamos más tarde?'));
    assert.ok(!tgMsg.includes('¿Quieres que prepare una respuesta'));
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from 'grammy';
import { UserSessionQueue, defaultSessionQueue } from '../src/adapters/session-queue.js';
import { TelegramAdapter } from '../src/adapters/telegram.js';
import { config } from '../src/config.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Suite de Pruebas Unitarias de Concurrencia y Serialización FIFO de Sesión (Milestone 3)', async (t) => {
  await t.test('Caso 1 (Orden FIFO Estricto): Tareas asimétricas del mismo usuario se ejecutan y resuelven en orden exacto [1, 2, 3]', async () => {
    const queue = new UserSessionQueue();
    const executionOrder = [];
    const completionOrder = [];

    // Tarea 1: 50ms (lenta)
    const p1 = queue.enqueue('user-1', async () => {
      executionOrder.push(1);
      await delay(50);
      completionOrder.push(1);
      return 'res1';
    });

    // Tarea 2: 10ms (media)
    const p2 = queue.enqueue('user-1', async () => {
      executionOrder.push(2);
      await delay(10);
      completionOrder.push(2);
      return 'res2';
    });

    // Tarea 3: 5ms (rápida)
    const p3 = queue.enqueue('user-1', async () => {
      executionOrder.push(3);
      await delay(5);
      completionOrder.push(3);
      return 'res3';
    });

    const results = await Promise.all([p1, p2, p3]);

    assert.deepStrictEqual(executionOrder, [1, 2, 3], 'El inicio de ejecución debe ser estrictamente secuencial FIFO');
    assert.deepStrictEqual(completionOrder, [1, 2, 3], 'La finalización de tareas debe ser estrictamente secuencial FIFO');
    assert.deepStrictEqual(results, ['res1', 'res2', 'res3'], 'Cada promesa debe resolver su resultado respectivo');
  });

  await t.test('Caso 2 (Aislamiento y Paralelismo Multi-Usuario): UserB rápido termina antes que UserA lento sin bloqueo cruzado', async () => {
    const queue = new UserSessionQueue();
    const completionOrder = [];

    // UserA tiene tarea lenta de 60ms
    const pA = queue.enqueue('UserA', async () => {
      await delay(60);
      completionOrder.push('UserA');
      return 'doneA';
    });

    // UserB tiene tarea rápida de 10ms
    const pB = queue.enqueue('UserB', async () => {
      await delay(10);
      completionOrder.push('UserB');
      return 'doneB';
    });

    const [resA, resB] = await Promise.all([pA, pB]);

    assert.strictEqual(resA, 'doneA');
    assert.strictEqual(resB, 'doneB');
    assert.deepStrictEqual(
      completionOrder,
      ['UserB', 'UserA'],
      'UserB debe completar antes que UserA; no debe existir bloqueo entre diferentes usuarios'
    );
  });

  await t.test('Caso 3 (Resiliencia ante Excepciones): Error en Tarea 1 de UserA no congela la cola; Tarea 2 se ejecuta y resuelve con éxito', async () => {
    const queue = new UserSessionQueue();
    const executionLog = [];

    const p1 = queue.enqueue('UserA', async () => {
      executionLog.push('tarea_1_fallida');
      throw new Error('Fallo simulado en Tarea 1');
    });

    const p2 = queue.enqueue('UserA', async () => {
      executionLog.push('tarea_2_exitosa');
      return 'exito_tarea_2';
    });

    // Tarea 1 debe arrojar el error original esperado
    await assert.rejects(
      async () => {
        await p1;
      },
      /Fallo simulado en Tarea 1/,
      'La promesa de Tarea 1 debe rechazar con la excepción lanzada'
    );

    // Tarea 2 debe resolverse con éxito a pesar del fallo previo
    const res2 = await p2;
    assert.strictEqual(res2, 'exito_tarea_2', 'La cola no debe congelarse tras un error');
    assert.deepStrictEqual(executionLog, ['tarea_1_fallida', 'tarea_2_exitosa']);
    assert.strictEqual(queue.getQueueLength('UserA'), 0, 'La longitud de la cola debe quedar en 0');
  });

  await t.test('Caso 4 (Limpieza de Memoria / Garbage Collection): Cola vacía elimina entradas en Map y libera memoria sin leaks', async () => {
    const queue = new UserSessionQueue();
    const userId = 'user-gc';

    assert.strictEqual(queue.getActiveUsersCount(), 0);
    assert.strictEqual(queue.isProcessing(userId), false);

    const p1 = queue.enqueue(userId, async () => {
      await delay(20);
      return 'gc1';
    });
    const p2 = queue.enqueue(userId, async () => {
      await delay(20);
      return 'gc2';
    });

    assert.strictEqual(queue.getQueueLength(userId), 2, 'Debe haber 2 tareas registradas');
    assert.strictEqual(queue.isProcessing(userId), true);
    assert.strictEqual(queue.getActiveUsersCount(), 1);

    await Promise.all([p1, p2]);

    assert.strictEqual(queue.getQueueLength(userId), 0, 'La longitud de la cola debe ser 0 tras finalizar');
    assert.strictEqual(queue.isProcessing(userId), false);
    assert.strictEqual(queue.getActiveUsersCount(), 0, 'No deben quedar usuarios activos en memoria');
    assert.strictEqual(queue._userQueues.has(userId), false, 'Mapa _userQueues no debe retener referencia huérfana');
    assert.strictEqual(queue._queueLengths.has(userId), false, 'Mapa _queueLengths no debe retener clave huérfana');

    // Comprobar también defaultSessionQueue singleton exportado
    assert.ok(defaultSessionQueue instanceof UserSessionQueue, 'defaultSessionQueue debe ser una instancia de UserSessionQueue');
  });

  await t.test('Caso 5 (Integración con Simulación de Ráfaga en Telegram): Ráfaga rápida (audio + texto 1 + texto 2) serializada a 1 ejecución a la vez', async () => {
    const origAllowed = config.telegram.allowedUsers;
    const origToken = config.telegram.token;
    const origFetch = globalThis.fetch;

    try {
      config.telegram.allowedUsers = ['777'];
      config.telegram.token = '123456:TEST_TELEGRAM_BOT_TOKEN_BURST';

      globalThis.fetch = async (url) => {
        if (String(url).includes('api.telegram.org')) {
          return { arrayBuffer: async () => Buffer.from('FAKE_AUDIO_DATA') };
        }
        return origFetch(url);
      };

      let activeExecutions = 0;
      let maxConcurrentExecutions = 0;
      const processedLog = [];

      const mockBrain = {
        processAudio: async ({ channel, senderId, senderName }) => {
          activeExecutions++;
          maxConcurrentExecutions = Math.max(maxConcurrentExecutions, activeExecutions);
          await delay(40);
          processedLog.push('audio_processed');
          activeExecutions--;
          return { reply: 'Audio procesado exitosamente.' };
        },
        processTextMessage: async ({ channel, senderId, senderName, text }) => {
          activeExecutions++;
          maxConcurrentExecutions = Math.max(maxConcurrentExecutions, activeExecutions);
          await delay(text.includes('4') ? 20 : 10);
          processedLog.push(text);
          activeExecutions--;
          return { reply: `Texto recibido: ${text}` };
        },
      };

      const customBot = new Bot(config.telegram.token, {
        botInfo: {
          id: 1,
          is_bot: true,
          first_name: 'CarmencitaBot',
          username: 'carmencita_bot',
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
        },
      });

      const actionsEmitted = [];
      customBot.api.config.use(async (prev, method, payload) => {
        if (method === 'getFile') {
          return { ok: true, result: { file_path: 'mock/voice.ogg' } };
        }
        if (method === 'sendChatAction') {
          actionsEmitted.push(payload.action);
          return { ok: true, result: true };
        }
        if (method === 'sendMessage') {
          return { ok: true, result: { message_id: 100 } };
        }
        return { ok: true, result: true };
      });

      const adapter = new TelegramAdapter(mockBrain, null);
      adapter.init(customBot);

      // Simular llegada consecutiva en ráfaga de 3 mensajes desde Telegram
      const p1 = customBot.handleUpdate({
        update_id: 101,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Sebastián', is_bot: false },
          voice: { file_id: 'voice_burst_1', duration: 10 },
        },
      });
      await delay(5);

      const p2 = customBot.handleUpdate({
        update_id: 102,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Sebastián', is_bot: false },
          text: 'Oye Sebas, recuerda que la cita es a las 4',
        },
      });
      await delay(5);

      const p3 = customBot.handleUpdate({
        update_id: 103,
        message: {
          message_id: 3,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'Sebastián', is_bot: false },
          text: 'Y revisa también el correo',
        },
      });

      await Promise.all([p1, p2, p3]);

      assert.strictEqual(
        maxConcurrentExecutions,
        1,
        'Cero colisiones: el cerebro de Carmencita solo debe procesar 1 mensaje a la vez por usuario'
      );
      assert.deepStrictEqual(
        processedLog,
        [
          'audio_processed',
          'Oye Sebas, recuerda que la cita es a las 4',
          'Y revisa también el correo',
        ],
        'Los mensajes deben ser procesados en estricto orden de llegada FIFO'
      );
      assert.strictEqual(
        adapter.sessionQueue.getActiveUsersCount(),
        0,
        'La cola debe recolectarse y quedar con 0 usuarios activos'
      );
      assert.ok(actionsEmitted.includes('record_voice'), 'Debe emitir acción record_voice para el audio');
      assert.ok(actionsEmitted.includes('typing'), 'Debe emitir acción typing para los mensajes de texto');
    } finally {
      config.telegram.allowedUsers = origAllowed;
      config.telegram.token = origToken;
      globalThis.fetch = origFetch;
    }
  });
});

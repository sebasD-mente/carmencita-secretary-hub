import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiPoolService } from '../src/services/gemini-pool.service.js';
import { validateEnv } from '../src/validators/env.schema.js';

test('GeminiPoolService: Inicialización y obtención de llave activa', () => {
  const pool = new GeminiPoolService({
    apiKeys: ['key_alpha_1', 'key_beta_2', 'key_gamma_3'],
    clientFactory: (key) => ({ mockedKey: key }),
  });

  assert.equal(pool.size, 3);
  assert.equal(pool.getActiveKey(), 'key_alpha_1');

  const client = pool.getClient();
  assert.equal(client.mockedKey, 'key_alpha_1');
});

test('GeminiPoolService: Rotación manual de llaves en caliente', () => {
  const pool = new GeminiPoolService({
    apiKeys: ['key_alpha_1', 'key_beta_2'],
    clientFactory: (key) => ({ mockedKey: key }),
  });

  const rot1 = pool.rotateKey({ reason: 'Prueba unitaria 1' });
  assert.equal(rot1.previousIndex, 0);
  assert.equal(rot1.newIndex, 1);
  assert.equal(rot1.newKey, 'key_beta_2');
  assert.equal(pool.getActiveKey(), 'key_beta_2');

  const rot2 = pool.rotateKey({ reason: 'Prueba unitaria 2' });
  assert.equal(rot2.previousIndex, 1);
  assert.equal(rot2.newIndex, 0);
  assert.equal(rot2.newKey, 'key_alpha_1');
  assert.equal(pool.getStats().rotationCount, 2);
});

test('GeminiPoolService: Failover y rotación automática ante error HTTP 429 (Rate Limit)', async () => {
  const mockClients = {
    key_alpha_1: {
      generate: async () => {
        const error = new Error('Resource has been exhausted (e.g. check quota).');
        error.status = 429;
        throw error;
      },
    },
    key_beta_2: {
      generate: async () => {
        return { text: 'Respuesta exitosa tras rotación' };
      },
    },
  };

  const pool = new GeminiPoolService({
    apiKeys: ['key_alpha_1', 'key_beta_2'],
    clientFactory: (key) => mockClients[key],
  });

  let attempts = 0;
  const result = await pool.executeWithFailover(async (client, key) => {
    attempts++;
    return await client.generate();
  }, { backoffBaseMs: 10 });

  assert.equal(attempts, 2, 'Debió intentar primero con key_alpha_1 y luego con key_beta_2');
  assert.equal(result.text, 'Respuesta exitosa tras rotación');
  assert.equal(pool.getActiveKey(), 'key_beta_2');
  assert.equal(pool.getStats().rotationCount, 1);
});

test('DevSecOps EnvValidator: Validación Fail-Fast de variables obligatorias', () => {
  // Caso 1: Faltan variables críticas
  const invalidResult = validateEnv({
    NODE_ENV: 'production',
  });
  assert.equal(invalidResult.success, false);
  assert.ok(invalidResult.issues.some((i) => i.variable === 'DATABASE_URL'));
  assert.ok(invalidResult.issues.some((i) => i.variable === 'TELEGRAM_BOT_TOKEN'));
  assert.ok(invalidResult.issues.some((i) => i.variable === 'GEMINI_API_KEY'));

  // Caso 2: Variables completas con pool de llaves
  const validResult = validateEnv({
    NODE_ENV: 'production',
    PORT: '3050',
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    TELEGRAM_BOT_TOKEN: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    GEMINI_API_KEYS: 'key_1,key_2,key_3',
  });
  assert.equal(validResult.success, true);
  assert.equal(validResult.data.PORT, 3050);
  assert.equal(validResult.data.HOST, '0.0.0.0');
});

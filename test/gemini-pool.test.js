import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiPoolService, geminiPool } from '../src/services/gemini-pool.service.js';
import { validateEnv, EnvSchema } from '../src/validators/env.schema.js';
import { EmbeddingService } from '../src/services/embedding.service.js';

test('GeminiPoolService: Inicialización y singleton oficial', () => {
  const pool = new GeminiPoolService({
    apiKeys: ['key_alpha_1', 'key_beta_2', 'key_gamma_3'],
    clientFactory: (key) => ({ mockedKey: key }),
  });

  assert.equal(pool.size, 3);
  assert.equal(pool.getActiveKey(), 'key_alpha_1');
  assert.equal(pool.getClient().mockedKey, 'key_alpha_1');

  // Verificar export singleton
  assert.ok(geminiPool instanceof GeminiPoolService);
  const stats = pool.getPoolStats();
  assert.equal(stats.totalKeys, 3);
  assert.equal(stats.currentIndex, 0);
  assert.equal(stats.failoverCount, 0);
});

test('GeminiPoolService: Rotación de API keys con log forense y round-robin', () => {
  const pool = new GeminiPoolService({
    apiKeys: ['key_alpha_1', 'key_beta_2'],
    clientFactory: (key) => ({ mockedKey: key }),
  });

  const rot1 = pool.rotateKey('TEST_ROTATION_1');
  assert.equal(rot1.previousIndex, 0);
  assert.equal(rot1.newIndex, 1);
  assert.equal(rot1.newKey, 'key_beta_2');
  assert.equal(pool.getActiveKey(), 'key_beta_2');

  const rot2 = pool.rotateKey('TEST_ROTATION_2');
  assert.equal(rot2.previousIndex, 1);
  assert.equal(rot2.newIndex, 0);
  assert.equal(rot2.newKey, 'key_alpha_1');

  const stats = pool.getPoolStats();
  assert.equal(stats.failoverCount, 2);
  assert.equal(stats.currentIndex, 0);
});

test('GeminiPoolService: executeWithRetry con tolerancia HTTP 429 y backoff exponencial', async () => {
  const callLog = [];
  const mockClients = {
    key_alpha_1: {
      generate: async () => {
        callLog.push('key_alpha_1');
        const err = new Error('Resource has been exhausted (e.g. check quota).');
        err.status = 429;
        throw err;
      },
    },
    key_beta_2: {
      generate: async () => {
        callLog.push('key_beta_2');
        return { text: 'Inferencia exitosa tras failover de API key' };
      },
    },
  };

  const pool = new GeminiPoolService({
    apiKeys: ['key_alpha_1', 'key_beta_2'],
    clientFactory: (key) => mockClients[key],
  });

  const result = await pool.executeWithRetry(async (client, key) => {
    return await client.generate();
  }, { maxRetries: 3, backoffBaseMs: 10 });

  assert.deepEqual(callLog, ['key_alpha_1', 'key_beta_2']);
  assert.equal(result.text, 'Inferencia exitosa tras failover de API key');
  assert.equal(pool.getActiveKey(), 'key_beta_2');
  assert.equal(pool.getPoolStats().failoverCount, 1);
});

test('DevSecOps EnvValidator: Validación Fail-Fast y Schema Zod', () => {
  // 1. EnvSchema directo rechaza configuraciones incompletas
  const parseEmpty = EnvSchema.safeParse({});
  assert.equal(parseEmpty.success, false);
  const issueKeys = parseEmpty.error.issues.map((i) => i.path.join('.'));
  assert.ok(issueKeys.includes('DATABASE_URL'));
  assert.ok(issueKeys.includes('TELEGRAM_BOT_TOKEN'));

  // EnvSchema rechaza configuración sin GEMINI_API_KEY ni GEMINI_API_KEYS
  const parseNoKeys = EnvSchema.safeParse({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/carmencita_db?schema=public',
    TELEGRAM_BOT_TOKEN: 'token_123',
  });
  assert.equal(parseNoKeys.success, false);
  assert.ok(parseNoKeys.error.issues.some((i) => i.path.includes('GEMINI_API_KEY')));

  // 2. validateEnv({}) en entorno test lanza error descriptivo con campos faltantes
  assert.throws(
    () => validateEnv({ NODE_ENV: 'test' }),
    (err) => {
      assert.ok(err.message.includes('[FATAL BOOT ERROR]'));
      assert.ok(err.message.includes('DATABASE_URL'));
      assert.ok(err.message.includes('TELEGRAM_BOT_TOKEN'));
      assert.ok(err.message.includes('GEMINI_API_KEY'));
      return true;
    }
  );

  // 3. validateEnv con entorno completo retorna datos limpios y tipados
  const validData = validateEnv({
    NODE_ENV: 'test',
    PORT: '3050',
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgresql://carmencita_user:secure@localhost:5432/carmencita_db?schema=public',
    TELEGRAM_BOT_TOKEN: '8607372979:AAE-TestToken1234567890',
    GEMINI_API_KEYS: 'key_primary_1, key_secondary_2',
    CARMENCITA_API_KEY: 'test-hub-secret',
  });

  assert.equal(validData.PORT, 3050);
  assert.equal(validData.HOST, '0.0.0.0');
  assert.equal(validData.DATABASE_URL, 'postgresql://carmencita_user:secure@localhost:5432/carmencita_db?schema=public');
  assert.equal(validData.CARMENCITA_API_KEY, 'test-hub-secret');
});

test('DevSecOps SQL Injection: searchSimilarMemories utiliza parámetros posicionales seguros', async () => {
  let executedSql = '';
  let capturedParams = [];

  const mockPrisma = {
    $queryRawUnsafe: async (sql, ...params) => {
      executedSql = sql;
      capturedParams = params;
      return [];
    },
  };

  const mockAi = {
    models: {
      embedContent: async () => ({
        embedding: { values: new Array(768).fill(0.01) },
      }),
    },
  };

  const service = new EmbeddingService(mockPrisma, mockAi);

  // Intento de inyección SQL maliciosa en category y excludeCategory
  const maliciousCategory = "GENERAL'; DROP TABLE \"SemanticMemory\"; --";
  const maliciousExclude = "OBSIDIAN' OR '1'='1";

  await service.searchSimilarMemories('Hola Carmencita', {
    category: maliciousCategory,
    excludeCategory: maliciousExclude,
  });

  // La consulta SQL generada NO debe contener los payloads directamente
  assert.ok(!executedSql.includes('DROP TABLE'), 'La consulta SQL no debe contener sentencias inyectadas');
  assert.ok(!executedSql.includes("'1'='1'"), 'La consulta SQL no debe contener booleanos inyectados');

  // Debe contener únicamente placeholders parametrizados $4 y $5
  assert.ok(executedSql.includes('category = $4'), 'Debe utilizar el parámetro posicional $4');
  assert.ok(executedSql.includes('category != $5'), 'Debe utilizar el parámetro posicional $5');

  // Los valores crudos deben viajar de forma segura en el array de parámetros
  assert.equal(capturedParams[3], maliciousCategory);
  assert.equal(capturedParams[4], maliciousExclude);
});

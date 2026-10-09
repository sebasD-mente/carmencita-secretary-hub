import { z } from 'zod';

/**
 * ==============================================================================
 * CARMENCITA SECRETARY HUB — DEVSECOPS ENVIRONMENT VALIDATOR
 * Estándar Deko Labs: Fail-Fast en Arranque & Zero-Trust
 * Ticket: [DEKO-CARMEN-M0]
 * ==============================================================================
 */

export const EnvSchema = z
  .object({
    PORT: z.coerce.number().default(3050),
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z.string().url('DATABASE_URL debe ser una URL válida').min(1, 'DATABASE_URL es obligatoria'),
    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN es obligatorio'),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_API_KEYS: z.string().optional(),
    CARMENCITA_API_KEY: z.string().optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      const hasSingleKey = Boolean(data.GEMINI_API_KEY && data.GEMINI_API_KEY.trim().length > 0);
      const hasPoolKeys = Boolean(data.GEMINI_API_KEYS && data.GEMINI_API_KEYS.trim().length > 0);
      return hasSingleKey || hasPoolKeys;
    },
    {
      message: 'Al menos una de GEMINI_API_KEY o GEMINI_API_KEYS debe estar presente y no vacía.',
      path: ['GEMINI_API_KEY'],
    }
  );

/**
 * Valida las variables de entorno de arranque.
 * Si fallan las variables obligatorias:
 * - Imprime el log forense de error de DeKo Labs.
 * - Si env.NODE_ENV !== 'test', ejecuta process.exit(1).
 * - En entorno de test, lanza un Error descriptivo.
 *
 * @param {Record<string, any>} [env=process.env]
 * @param {Object} [options={}]
 * @param {boolean|null} [options.exitOnError=null]
 * @returns {z.infer<typeof EnvSchema>}
 */
export function validateEnv(env = process.env, { exitOnError = null } = {}) {
  const result = EnvSchema.safeParse(env);
  const issues = result.success ? [] : [...result.error.issues];

  const hasKey = Boolean(
    (env?.GEMINI_API_KEY && String(env.GEMINI_API_KEY).trim()) ||
    (env?.GEMINI_API_KEYS && String(env.GEMINI_API_KEYS).trim())
  );
  if (!hasKey && !issues.some((i) => i.path.includes('GEMINI_API_KEY'))) {
    issues.push({
      path: ['GEMINI_API_KEY'],
      message: 'Al menos una de GEMINI_API_KEY o GEMINI_API_KEYS debe estar presente y no vacía.',
    });
  }

  if (issues.length > 0) {
    console.error('❌ [FATAL BOOT ERROR] Variables de entorno inválidas o ausentes:');
    issues.forEach((issue) => {
      console.error(`  • [${issue.path.join('.') || 'ENV'}]: ${issue.message}`);
    });

    const isTest = (env?.NODE_ENV === 'test') || (process.env.NODE_ENV === 'test');
    const shouldExit = exitOnError !== null ? exitOnError : !isTest;

    if (shouldExit) {
      process.exit(1);
    }

    const errorDetails = issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    const err = new Error(`[FATAL BOOT ERROR] Variables de entorno inválidas o ausentes: ${errorDetails}`);
    err.issues = issues;
    throw err;
  }

  return result.data;
}

export default validateEnv;

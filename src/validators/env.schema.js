import { z } from 'zod';

/**
 * ==============================================================================
 * CARMENCITA SECRETARY HUB — DEVSECOPS ENVIRONMENT VALIDATOR
 * Estándar Deko Labs: Fail-Fast en Arranque & Zero-Trust
 * ==============================================================================
 */

export const EnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    PORT: z
      .coerce
      .number()
      .int()
      .min(1024, 'PORT debe ser mayor a 1023')
      .max(65535, 'PORT debe ser menor a 65536')
      .default(3050),

    HOST: z
      .string()
      .min(1, 'HOST no puede estar vacío')
      .default('127.0.0.1'),

    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL es obligatoria para la persistencia relacional'),

    TELEGRAM_BOT_TOKEN: z
      .string()
      .min(1, 'TELEGRAM_BOT_TOKEN es obligatorio para el adaptador de Telegram'),

    GEMINI_API_KEY: z
      .string()
      .optional(),

    GEMINI_API_KEYS: z
      .string()
      .optional(),

    TELEGRAM_ALLOWED_USERS: z
      .string()
      .optional(),

    STORAGE_DIR: z
      .string()
      .optional(),

    GCS_BUCKET_NAME: z
      .string()
      .optional()
      .default('carmencita-vault-deko'),
  })
  .superRefine((data, ctx) => {
    // Si estamos en entorno de pruebas, no forzar llaves de IA para permitir mocks limpios
    if (data.NODE_ENV === 'test') {
      return;
    }

    const hasSingleKey = Boolean(data.GEMINI_API_KEY && data.GEMINI_API_KEY.trim().length > 0);
    const hasKeyPool = Boolean(data.GEMINI_API_KEYS && data.GEMINI_API_KEYS.trim().length > 0);

    if (!hasSingleKey && !hasKeyPool) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Se requiere al menos GEMINI_API_KEY o GEMINI_API_KEYS en el entorno para inferencia agéntica.',
        path: ['GEMINI_API_KEY'],
      });
    }
  });

/**
 * Ejecuta validación exhaustiva de variables de entorno al arranque.
 * Si exitOnError es true y la validación falla, aborta inmediatamente con process.exit(1).
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @param {Object} [options={}]
 * @param {boolean} [options.exitOnError=false]
 * @returns {{ success: boolean, data?: z.infer<typeof EnvSchema>, errors?: any }}
 */
export function validateEnv(env = process.env, { exitOnError = false } = {}) {
  const result = EnvSchema.safeParse(env);
  let issueList = [];

  if (!result.success) {
    issueList = result.error.issues.map((issue) => ({
      variable: issue.path.join('.'),
      message: issue.message,
    }));
  }

  // Verificación explícita de llaves de IA independiente de otros campos
  const isTest = env.NODE_ENV === 'test';
  const hasGeminiKey = Boolean(
    (env.GEMINI_API_KEY && String(env.GEMINI_API_KEY).trim()) ||
    (env.GEMINI_API_KEYS && String(env.GEMINI_API_KEYS).trim())
  );

  if (!isTest && !hasGeminiKey) {
    if (!issueList.some((i) => i.variable === 'GEMINI_API_KEY')) {
      issueList.push({
        variable: 'GEMINI_API_KEY',
        message: 'Se requiere al menos GEMINI_API_KEY o GEMINI_API_KEYS en el entorno para inferencia agéntica.',
      });
    }
  }

  if (issueList.length > 0) {
    const formattedErrors = result.success ? {} : result.error.format();

    if (exitOnError) {
      console.error('\n❌ [FATAL DEVSECOPS - BOOT ABORTED] Variables de entorno críticas ausentes o inválidas:');
      issueList.forEach((issue) => {
        console.error(`  • [${issue.variable || 'ENV'}]: ${issue.message}`);
      });
      console.error('\nVerifica tu archivo .env o la configuración de Dokploy VPS antes de reiniciar.\n');
      process.exit(1);
    }

    return {
      success: false,
      errors: formattedErrors,
      issues: issueList,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

export default validateEnv;

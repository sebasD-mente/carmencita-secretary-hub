import { PrismaClient } from '@prisma/client';

let prismaInstance = null;

export function getPrismaClient() {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }
  return prismaInstance;
}

export function setPrismaClient(client) {
  prismaInstance = client;
}

/**
 * Validación activa de conexión a PostgreSQL (Pre-flight & Deep Healthcheck)
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function checkConnection() {
  try {
    const client = getPrismaClient();
    if (typeof client.$queryRaw !== 'function') {
      return { ok: false, error: 'Prisma Client no inicializado o sin soporte $queryRaw' };
    }
    await client.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Error desconocido al conectar con PostgreSQL' };
  }
}

/**
 * Wrapper con reintentos y retroceso exponencial para operaciones críticas de BD
 * @param {Function} operation - (client) => Promise<T>
 * @param {number} maxRetries
 * @param {number} baseDelayMs
 * @returns {Promise<T>}
 */
export async function withPrismaRetry(operation, maxRetries = 3, baseDelayMs = 500) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation(getPrismaClient());
    } catch (err) {
      attempt++;
      const isConnErr = err.message?.includes("Can't reach database") ||
        err.message?.includes('Connection closed') ||
        err.message?.includes('socket') ||
        err.code === 'P1001' || err.code === 'P1002';

      if (!isConnErr || attempt >= maxRetries) {
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[Prisma Retry] Intento ${attempt}/${maxRetries} falló: ${err.message}. Reintentando en ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Forzar reciclado de instancia ante socket roto
      try {
        if (prismaInstance && typeof prismaInstance.$disconnect === 'function') {
          await prismaInstance.$disconnect().catch(() => {});
        }
      } catch {}
      prismaInstance = null;
    }
  }
}

// Proxy transparente retrocompatible
export const prisma = new Proxy({}, {
  get(target, prop) {
    const client = getPrismaClient();
    const val = client[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  },
  set(target, prop, value) {
    const client = getPrismaClient();
    client[prop] = value;
    return true;
  },
});

export default prisma;

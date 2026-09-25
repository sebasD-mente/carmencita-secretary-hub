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

// Proxy transparente para que cualquier import estático de `prisma`
// siempre delegue a la instancia activa (permitiendo mocking limpio en tests)
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

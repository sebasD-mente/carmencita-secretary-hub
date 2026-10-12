# ========================================================
# CARMENCITA SECRETARY HUB - MULTI-STAGE DOCKERFILE
# Estándar Deko Labs: Rendimiento, Seguridad y Aislamiento
# ========================================================

# ----------------- STAGE 1: BUILDER -----------------
FROM node:22-alpine AS builder

WORKDIR /app

# Dependencias del sistema requeridas para Prisma Engine en Alpine
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

# ----------------- STAGE 2: PRODUCTION RUNNER -----------------
FROM node:22-alpine AS runner

WORKDIR /app

# Dependencias nativas del sistema:
# - ffmpeg: Transcodificación de audio OGG Opus para Telegram Voice Notes
# - wget: Sonda de Healthcheck HTTP nativo
# - openssl & libc6-compat: Ejecución de Prisma Query Engine en Alpine Linux
RUN apk add --no-cache ffmpeg wget openssl libc6-compat

ENV NODE_ENV=production \
    PORT=3050 \
    HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev

# Copiar artefactos pre-generados de Prisma desde builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY src/ ./src/
COPY prisma/ ./prisma/
COPY scripts/ ./scripts/

# Permisos mínimos y ejecución sin privilegios de root (Hardening Zero-Trust)
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# Healthcheck HTTP nativo contra endpoint /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3050/health || exit 1

EXPOSE 3050

CMD ["node", "src/index.js"]

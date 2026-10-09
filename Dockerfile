# ========================================================
# CARMENCITA SECRETARY HUB - MULTI-STAGE DOCKERFILE
# Estándar Deko Labs: Rendimiento, Seguridad y Aislamiento
# ========================================================

# Stage 1: Builder
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

# Stage 2: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app

# Dependencias nativas del sistema (transcodificación de voz en OGG Opus y sondeo de salud)
RUN apk add --no-cache ffmpeg wget

ENV NODE_ENV=production \
    PORT=3050 \
    HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY src/ ./src/
COPY prisma/ ./prisma/
COPY scripts/ ./scripts/

# Permisos mínimos y ejecución sin privilegios de root (Hardening Zero-Trust)
RUN mkdir -p /app/data && chown -R node:node /app

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3050/health || exit 1

EXPOSE 3050

CMD ["node", "src/index.js"]

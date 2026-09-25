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

EXPOSE 3050

CMD ["node", "src/index.js"]

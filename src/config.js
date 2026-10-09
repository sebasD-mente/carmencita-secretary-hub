import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnv } from './validators/env.schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Fail-fast coercitivo en arranque para producción Dokploy VPS
if (process.env.NODE_ENV === 'production') {
  validateEnv(process.env, { exitOnError: true });
}

export const config = {
  port: parseInt(process.env.PORT || '3050', 10),
  // Host binding flexible: 0.0.0.0 para contenedores Docker/Dokploy, 127.0.0.1 para desarrollo local
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  apiKey: process.env.CARMENCITA_API_KEY || '',
  storageDir: process.env.STORAGE_DIR || path.resolve(__dirname, '../data'),
  databaseUrl: process.env.DATABASE_URL || '',

  // Telegram Configuration
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUsers: (process.env.TELEGRAM_ALLOWED_USERS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean),
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '', // Empty = use Long Polling (easiest & instant)
  },

  // WhatsApp via Evolution API Configuration
  whatsapp: {
    evolutionUrl: (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/$/, ''),
    apiKey: process.env.EVOLUTION_API_KEY || '',
    instanceName: process.env.EVOLUTION_INSTANCE_NAME || 'carmencita',
    allowedNumbers: (process.env.WHATSAPP_ALLOWED_NUMBERS || '')
      .split(',')
      .map(num => num.replace(/\D/g, ''))
      .filter(Boolean),
  },

  // AI & Reasoning Engine
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    // Pool rotativo de llaves para tolerancia a 429
    geminiApiKeys: (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean),
    modelName: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    modelPool: (process.env.GEMINI_MODEL_POOL || 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest')
      .split(',')
      .map(m => m.trim())
      .filter(Boolean),
    agyBinPath: process.env.AGY_BIN_PATH || '/root/.local/bin/agy',
  },

  // Google Workspace & Cloud Storage
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    bucketName: process.env.GCS_BUCKET_NAME || 'carmencita-vault-deko',
  },

  // Obsidian & Google Drive Vault
  obsidian: {
    vaultFolderName: process.env.OBSIDIAN_VAULT_FOLDER_NAME || 'vault',
    vaultFolderId: process.env.OBSIDIAN_VAULT_FOLDER_ID || '',
  },
};

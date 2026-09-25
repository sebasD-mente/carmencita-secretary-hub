import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3050', 10),
  host: process.env.HOST || '0.0.0.0',
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
    modelName: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    agyBinPath: process.env.AGY_BIN_PATH || 'agy',
  },
};

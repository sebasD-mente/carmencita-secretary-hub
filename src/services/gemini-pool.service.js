import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

/**
 * ==============================================================================
 * GEMINI API KEY ROTATING POOL SERVICE
 * Estándar Deko Labs: Tolerancia HTTP 429 & Failover en Caliente
 * Ticket: [DEKO-CARMEN-M0]
 * ==============================================================================
 */
export class GeminiPoolService {
  /**
   * @param {string[]|string|Object} [keysOrOptions=null]
   * @param {Object} [options={}]
   */
  constructor(keysOrOptions = null, options = {}) {
    let rawKeys = keysOrOptions;
    let opts = options;
    if (keysOrOptions && typeof keysOrOptions === 'object' && !Array.isArray(keysOrOptions)) {
      rawKeys = keysOrOptions.apiKeys;
      opts = keysOrOptions;
    }

    this.apiKeys = Object.freeze(this._normalizeKeys(rawKeys));
    this.currentIndex = opts.initialIndex >= 0 && opts.initialIndex < this.apiKeys.length ? opts.initialIndex : 0;
    this.failoverCount = 0;
    this.clientFactory = opts.clientFactory || ((key) => new GoogleGenAI({ apiKey: key }));
    this.clientsCache = new Map();
  }

  _normalizeKeys(candidateKeys) {
    if (Array.isArray(candidateKeys)) {
      return candidateKeys.map((k) => String(k).trim()).filter(Boolean);
    }
    if (typeof candidateKeys === 'string' && candidateKeys.trim()) {
      return candidateKeys.split(',').map((k) => k.trim()).filter(Boolean);
    }
    const fromConfig = config?.ai?.geminiApiKeys || [];
    if (fromConfig.length > 0) return fromConfig;
    const single = config?.ai?.geminiApiKey || process.env.GEMINI_API_KEY || '';
    return single ? [single.trim()] : [];
  }

  getActiveKey() {
    if (this.apiKeys.length === 0) return null;
    return this.apiKeys[this.currentIndex];
  }

  get size() {
    return this.apiKeys.length;
  }

  getClient() {
    const key = this.getActiveKey();
    if (!key) return null;
    if (!this.clientsCache.has(key)) {
      this.clientsCache.set(key, this.clientFactory(key));
    }
    return this.clientsCache.get(key);
  }

  rotateKey(reasonOrOpts = 'RATE_LIMIT') {
    const reason = typeof reasonOrOpts === 'object' && reasonOrOpts?.reason ? reasonOrOpts.reason : (reasonOrOpts || 'RATE_LIMIT');
    const total = this.apiKeys.length;
    if (total <= 1) {
      return { previousIndex: this.currentIndex, newIndex: this.currentIndex, newKey: this.getActiveKey() };
    }
    const previousIndex = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % total;
    this.failoverCount++;
    console.warn(`🔄 [GeminiPool] Rotando API Key (Razón: ${reason}). Key activa: index ${this.currentIndex}/${total}.`);
    return { previousIndex, newIndex: this.currentIndex, newKey: this.getActiveKey() };
  }

  getPoolStats() {
    return {
      totalKeys: this.apiKeys.length,
      currentIndex: this.currentIndex,
      failoverCount: this.failoverCount,
    };
  }

  getStats() {
    return {
      ...this.getPoolStats(),
      rotationCount: this.failoverCount,
      hasAvailableClient: Boolean(this.getActiveKey()),
    };
  }

  isRateLimitError(err) {
    if (!err) return false;
    const msg = String(err.message || '').toLowerCase();
    const status = err.status || err.statusCode || err.code;
    return (
      status === 429 ||
      status === '429' ||
      status === 503 ||
      msg.includes('429') ||
      msg.includes('resource_exhausted') ||
      msg.includes('quota exceeded') ||
      msg.includes('rate limit') ||
      msg.includes('high demand') ||
      msg.includes('spikes in demand')
    );
  }

  async executeWithRetry(asyncFn, { maxRetries = 3, backoffBaseMs = 1000 } = {}) {
    let lastError = null;
    const attempts = Math.max(maxRetries, 1);

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const client = this.getClient();
        const activeKey = this.getActiveKey();
        return await asyncFn(client, activeKey);
      } catch (err) {
        lastError = err;
        if (this.isRateLimitError(err) && attempt < attempts - 1 && this.apiKeys.length > 1) {
          this.rotateKey(`HTTP 429 RateLimit (intento ${attempt + 1}/${attempts})`);
          const delay = backoffBaseMs * Math.pow(2, attempt);
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('[GeminiPool] Fallaron todos los reintentos del pool de Gemini.');
  }

  async executeWithFailover(operationFn, options = {}) {
    return this.executeWithRetry(operationFn, options);
  }

  reset() {
    this.currentIndex = 0;
    this.failoverCount = 0;
    this.clientsCache.clear();
  }
}

export const geminiPool = new GeminiPoolService();
export const defaultGeminiPool = geminiPool;
export default geminiPool;

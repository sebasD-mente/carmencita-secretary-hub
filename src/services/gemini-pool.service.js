import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

/**
 * ==============================================================================
 * GEMINI API KEY ROTATING POOL SERVICE
 * Estándar Deko Labs: Cero Caídas por Cuota / Tolerancia HTTP 429 en Caliente
 * ==============================================================================
 */
export class GeminiPoolService {
  /**
   * @param {Object} [options={}]
   * @param {string[]|string} [options.apiKeys] - Array de llaves o string separado por comas
   * @param {Function} [options.clientFactory] - Factoría para inyección de mocks en tests
   * @param {number} [options.initialIndex=0] - Índice de partida para la rotación
   */
  constructor({
    apiKeys = null,
    clientFactory = null,
    initialIndex = 0,
  } = {}) {
    this.apiKeys = this._normalizeKeys(apiKeys);
    this.currentIndex = initialIndex >= 0 && initialIndex < this.apiKeys.length ? initialIndex : 0;
    this.clientFactory = clientFactory || ((key) => new GoogleGenAI({ apiKey: key }));
    this.clientsCache = new Map();
    this.rotationCount = 0;
    this.lastRotatedAt = null;
  }

  /**
   * Normaliza llaves desde argumentos, config o entorno
   * @private
   */
  _normalizeKeys(candidateKeys) {
    if (Array.isArray(candidateKeys)) {
      return candidateKeys.map((k) => String(k).trim()).filter(Boolean);
    }

    if (typeof candidateKeys === 'string' && candidateKeys.trim()) {
      return candidateKeys
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    }

    // Fallback a config.ai.geminiApiKeys o geminiApiKey
    const fromConfig = config?.ai?.geminiApiKeys || [];
    if (fromConfig.length > 0) {
      return fromConfig;
    }

    const singleKey = config?.ai?.geminiApiKey || process.env.GEMINI_API_KEY || '';
    return singleKey ? [singleKey.trim()] : [];
  }

  /**
   * Retorna la llave activa actual del pool
   * @returns {string|null}
   */
  getActiveKey() {
    if (this.apiKeys.length === 0) return null;
    return this.apiKeys[this.currentIndex];
  }

  /**
   * Retorna el número de llaves cargadas en el pool
   * @returns {number}
   */
  get size() {
    return this.apiKeys.length;
  }

  /**
   * Obtiene la instancia activa de GoogleGenAI asociada a la llave actual
   * @returns {GoogleGenAI|null}
   */
  getClient() {
    const key = this.getActiveKey();
    if (!key) return null;

    if (!this.clientsCache.has(key)) {
      try {
        const client = this.clientFactory(key);
        this.clientsCache.set(key, client);
      } catch (err) {
        console.error(`[GeminiPool] Error instanciando cliente para índice ${this.currentIndex}:`, err.message);
        throw err;
      }
    }

    return this.clientsCache.get(key);
  }

  /**
   * Rota el cursor a la siguiente API Key disponible en el pool
   * @param {Object} [options={}]
   * @param {string} [options.reason='HTTP 429 Quota Exceeded']
   * @returns {{ previousIndex: number, newIndex: number, newKey: string }}
   */
  rotateKey({ reason = 'HTTP 429 Quota Exceeded' } = {}) {
    if (this.apiKeys.length <= 1) {
      console.warn(`[GeminiPool] Advertencia: intento de rotación ignorado. Solo hay ${this.apiKeys.length} llave(s) en el pool.`);
      return {
        previousIndex: this.currentIndex,
        newIndex: this.currentIndex,
        newKey: this.getActiveKey(),
      };
    }

    const previousIndex = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
    this.rotationCount++;
    this.lastRotatedAt = new Date();

    console.warn(
      `🔄 [GeminiPool] Rotación de API Key ejecutada (${reason}). ` +
      `De índice [${previousIndex}] a [${this.currentIndex}] (Total rotaciones: ${this.rotationCount})`
    );

    return {
      previousIndex,
      newIndex: this.currentIndex,
      newKey: this.getActiveKey(),
    };
  }

  /**
   * Determina si un error corresponde a agotamiento de cuota, saturación o 429
   * @param {Error|any} err
   * @returns {boolean}
   */
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

  /**
   * Ejecuta una operación contra Gemini aplicando rotación y backoff exponencial ante 429
   * @param {Function} operationFn - Callback asíncrono que recibe (client, currentKey)
   * @param {Object} [options={}]
   * @param {number} [options.maxRetries] - Intentos máximos permitidos
   * @param {number} [options.backoffBaseMs=150] - Tiempo base de retardo exponencial
   * @returns {Promise<any>}
   */
  async executeWithFailover(operationFn, { maxRetries = null, backoffBaseMs = 150 } = {}) {
    const attemptsLimit = maxRetries !== null ? maxRetries : Math.max(this.apiKeys.length, 1);
    let lastError = null;

    for (let attempt = 0; attempt < attemptsLimit; attempt++) {
      const client = this.getClient();
      const currentKey = this.getActiveKey();

      try {
        return await operationFn(client, currentKey);
      } catch (err) {
        lastError = err;

        if (this.isRateLimitError(err) && attempt < attemptsLimit - 1 && this.apiKeys.length > 1) {
          this.rotateKey({ reason: `Fallo transitorio (${err.message}) en intento ${attempt + 1}` });

          const delay = backoffBaseMs * Math.pow(2, attempt);
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          continue;
        }

        // Si el error no es de tasa o se agotaron los intentos, propagar
        throw err;
      }
    }

    throw lastError || new Error('[GeminiPool] Fallaron todos los intentos del pool de Gemini.');
  }

  /**
   * Retorna telemetría estructurada del estado del pool
   * @returns {Object}
   */
  getStats() {
    return {
      totalKeys: this.apiKeys.length,
      currentIndex: this.currentIndex,
      rotationCount: this.rotationCount,
      lastRotatedAt: this.lastRotatedAt,
      hasAvailableClient: Boolean(this.getActiveKey()),
    };
  }

  /**
   * Reinicia la caché y el contador de rotaciones para pruebas limpias
   */
  reset() {
    this.currentIndex = 0;
    this.clientsCache.clear();
    this.rotationCount = 0;
    this.lastRotatedAt = null;
  }
}

export const defaultGeminiPool = new GeminiPoolService();
export default defaultGeminiPool;

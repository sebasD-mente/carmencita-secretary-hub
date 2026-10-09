import { spawn } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { PresentationFormatter } from '../presentation/formatter.js';
import { geminiPool } from './gemini-pool.service.js';

/**
 * 🎙️ VoiceService - Síntesis Neuronal y Manejo Resiliente de Cuota (TTS)
 * Conectado a GeminiPoolService para rotación en caliente ante HTTP 429.
 * Estándar Deko Labs Enterprise: Robusto, Profesional y Escalable.
 * Ticket: [DEKO-CARMEN-M6]
 */
export class VoiceService {
  constructor(deps = {}) {
    const isExplicitlyDisabled = deps.apiKey === '' || (deps.ai === null && deps.apiKey === '');
    this.poolService = deps.poolService !== undefined ? deps.poolService : (isExplicitlyDisabled ? null : (deps.geminiPool || geminiPool));
    this.apiKey = deps.apiKey !== undefined ? deps.apiKey : (this.poolService?.getActiveKey?.() || config.ai.geminiApiKey);
    this.modelName = deps.modelName || 'gemini-3.8-flash-tts';
    this.voiceName = deps.voiceName || 'Aoede'; // Aoede: Cálida, sofisticada, madura y expresiva
    this.ai = deps.ai !== undefined ? deps.ai : null;
  }

  _getAiClient() {
    if (this.ai) return this.ai;
    if (this.poolService && typeof this.poolService.getClient === 'function') {
      const poolClient = this.poolService.getClient();
      if (poolClient) return poolClient;
    }
    if (this.apiKey) {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
      return this.ai;
    }
    return null;
  }

  /**
   * Limpia el texto de markdown, enlaces, bloques de código y emojis para que la dicción sea 100% fluida
   */
  _cleanTextForSpeech(rawText) {
    return PresentationFormatter.formatForVoice(rawText);
  }

  /**
   * Transcodifica un buffer WAV a OGG Opus mediante ffmpeg (formato nativo de voz en Telegram)
   */
  async _transcodeWavToOgg(wavBuffer) {
    return new Promise((resolve) => {
      let settled = false;
      const safeResolve = (res) => {
        if (!settled) {
          settled = true;
          resolve(res);
        }
      };

      try {
        const ffmpeg = spawn('ffmpeg', [
          '-i', 'pipe:0',
          '-af', 'apad=pad_dur=0.6',
          '-c:a', 'libopus',
          '-b:a', '48k',
          '-vbr', 'on',
          '-f', 'ogg',
          'pipe:1',
        ]);

        const chunks = [];
        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => {}); // Silenciar stderr informativo

        ffmpeg.on('close', (code) => {
          if (code === 0 && chunks.length > 0) {
            safeResolve({
              buffer: Buffer.concat(chunks),
              mimeType: 'audio/ogg',
              fileName: 'carmencita_voice.ogg',
            });
          } else {
            // Fallback seguro: si ffmpeg falla o no está disponible, devolver WAV
            safeResolve({
              buffer: wavBuffer,
              mimeType: 'audio/wav',
              fileName: 'carmencita_voice.wav',
            });
          }
        });

        ffmpeg.on('error', () => {
          safeResolve({
            buffer: wavBuffer,
            mimeType: 'audio/wav',
            fileName: 'carmencita_voice.wav',
          });
        });

        if (ffmpeg.stdin) {
          ffmpeg.stdin.on('error', () => {});
          ffmpeg.stdin.write(wavBuffer);
          ffmpeg.stdin.end();
        }
      } catch {
        safeResolve({
          buffer: wavBuffer,
          mimeType: 'audio/wav',
          fileName: 'carmencita_voice.wav',
        });
      }
    });
  }

  /**
   * Trunca texto respetando fronteras de oraciones (. ? !) para no cortar palabras
   */
  _truncateAtSentenceBoundary(text, maxChars = 700) {
    if (!text || text.length <= maxChars) return text;

    const sub = text.slice(0, maxChars);
    const lastBoundary = Math.max(
      sub.lastIndexOf('. '),
      sub.lastIndexOf('.\n'),
      sub.lastIndexOf('?'),
      sub.lastIndexOf('!')
    );

    if (lastBoundary > 100) {
      return sub.slice(0, lastBoundary + 1).trim();
    }

    const lastSpace = sub.lastIndexOf(' ');
    if (lastSpace > 100) {
      return sub.slice(0, lastSpace).trim() + '.';
    }

    return sub.trim() + '.';
  }

  /**
   * Genera una nota de voz natural a partir del texto con tolerancia a HTTP 429 y rotación de pool.
   */
  async synthesizeSpeech(text, { voiceName = this.voiceName } = {}) {
    const clean = this._cleanTextForSpeech(text);
    if (!clean || clean.length < 2) return null;

    // Truncar para síntesis respetando fronteras de oraciones (máximo 700 caracteres ejecutivos)
    const voiceText = this._truncateAtSentenceBoundary(clean, 700);

    const executeTTS = async (client) => {
      return await client.models.generateContent({
        model: this.modelName,
        contents: voiceText,
        config: {
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
          },
        },
      });
    };

    try {
      let response = null;

      if (!this.ai && this.poolService && typeof this.poolService.executeWithRetry === 'function') {
        try {
          response = await this.poolService.executeWithRetry(
            async (client) => {
              if (!client) throw new Error('Cliente Gemini no disponible en pool');
              return await executeTTS(client);
            },
            { maxRetries: Math.max(this.poolService.size || 1, 2) }
          );
        } catch (poolErr) {
          console.warn('[VoiceService] Cuota de Gemini TTS agotada (HTTP 429) o error en pool:', poolErr.message);
          return null;
        }
      } else {
        const client = this._getAiClient();
        if (!client) {
          console.warn('[VoiceService] GoogleGenAI no inicializado.');
          return null;
        }
        response = await executeTTS(client);
      }

      const candidate = response?.candidates?.[0];
      const part = candidate?.content?.parts?.find((p) => p.inlineData?.data);

      if (!part || !part.inlineData?.data) {
        console.warn('[VoiceService] No se recibió inlineData de audio.');
        return null;
      }

      const wavBuffer = Buffer.from(part.inlineData.data, 'base64');
      return await this._transcodeWavToOgg(wavBuffer);
    } catch (err) {
      console.error('[VoiceService] Error sintetizando voz:', err.message);
      return null;
    }
  }
}

export const defaultVoiceService = new VoiceService();

import { spawn } from 'node:child_process';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

export class VoiceService {
  constructor(deps = {}) {
    this.apiKey = deps.apiKey !== undefined ? deps.apiKey : config.ai.geminiApiKey;
    this.modelName = deps.modelName || 'gemini-3.8-flash-tts';
    this.voiceName = deps.voiceName || 'Aoede'; // Aoede: Cálida, sofisticada, madura y expresiva
    this.ai = deps.ai !== undefined ? deps.ai : (this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null);
  }

  /**
   * Limpia el texto de markdown, enlaces, bloques de código y emojis para que la dicción sea 100% fluida
   */
  _cleanTextForSpeech(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    return rawText
      // Eliminar bloques JSON de acciones
      .replace(/```(?:json)?[\s\S]*?```/gi, '')
      .replace(/\{"action"[\s\S]*?\}/gi, '')
      // Eliminar etiquetas HTML
      .replace(/<[^>]+>/g, '')
      // Eliminar sintaxis markdown (negritas, cursivas, encabezados, viñetas)
      .replace(/[*_~`#]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Enlaces: conservar solo el texto visible
      // Normalizar guiones
      .replace(/[•–—]/g, '-')
      // Colapsar espacios múltiples y saltos
      .replace(/\s+/g, ' ')
      .trim();
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
   * Genera una nota de voz natural a partir del texto
   */
  async synthesizeSpeech(text, { voiceName = this.voiceName } = {}) {
    if (!this.ai) {
      console.warn('[VoiceService] GoogleGenAI no inicializado.');
      return null;
    }

    const clean = this._cleanTextForSpeech(text);
    if (!clean || clean.length < 2) return null;

    // Truncar para síntesis si es excesivamente largo (máximo 600 caracteres ejecutivos)
    const voiceText = clean.length > 600 ? clean.slice(0, 600) + '...' : clean;

    try {
      const response = await this.ai.models.generateContent({
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

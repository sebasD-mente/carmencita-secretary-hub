import { GoogleGenAI } from '@google/genai';
import { defaultStorageProvider } from './storage.provider.js';
import { geminiPool as defaultGeminiPool } from './gemini-pool.service.js';
import { config } from '../config.js';

export const PRO_MODELS = ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];
export const FLASH_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-nano-banana-2.1'];

export class QuotaExceededError extends Error {
  constructor(message = 'Cuota de generación visual de Gemini agotada en todos los modelos y llaves del pool.') {
    super(message);
    this.name = 'QuotaExceededError';
    this.code = 'QUOTA_EXCEEDED';
  }
}

export class SafetyFilterError extends Error {
  constructor(message = 'La generación visual fue bloqueada por los filtros de seguridad de Gemini.', details = {}) {
    super(message);
    this.name = 'SafetyFilterError';
    this.code = 'SAFETY_FILTER_TRIGGERED';
    this.details = details;
  }
}

export class TimeoutError extends Error {
  constructor(message = 'La generación visual excedió el tiempo límite (20s).') {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
  }
}

const BRAND_SANITIZATION_RULES = [
  { pattern: /\b(super\s*mario(\s*bros)?|mario\s*bros)\b/gi, replacement: 'classic nostalgic 80s videogame plumber character with red cap, mustache and blue overalls' },
  { pattern: /\b(pokemon|pikachu)\b/gi, replacement: 'cute electric yellow fantasy creature with lightning bolt tail' },
  { pattern: /\b(mickey(\s*mouse)?|disney)\b/gi, replacement: 'classic vintage animated cartoon mouse with round ears' },
  { pattern: /\b(iron\s*man|marvel)\b/gi, replacement: 'futuristic metallic high-tech armored superhero in red and gold' },
  { pattern: /\b(batman|dc\s*comics)\b/gi, replacement: 'dark vigilante hero in armored suit with bat-wing silhouette cape' },
  { pattern: /\b(star\s*wars|darth\s*vader)\b/gi, replacement: 'dark sci-fi armored lord with mechanical breathing helmet' },
  { pattern: /\b(coca\s*cola|pepsi)\b/gi, replacement: 'vintage chilled soda beverage in retro contour glass bottle' },
  { pattern: /\b(lego)\b/gi, replacement: 'interlocking colorful modular building brick construction set' },
  { pattern: /\b(nike|adidas)\b/gi, replacement: 'aerodynamic contemporary athletic performance sports sneakers' },
  { pattern: /\b(mcdonald'?s)\b/gi, replacement: 'retro commercial diner burger meal with golden fries' },
];

const ASPECT_RATIO_DIRECTIVES = {
  '1:1': 'Composition: Aspect ratio 1:1 square format, balanced centered framing, symmetrical focus.',
  '16:9': 'Composition: Aspect ratio 16:9 widescreen, cinematic panoramic perspective, expansive field of view.',
  '9:16': 'Composition: Aspect ratio 9:16 vertical portrait, full-length mobile orientation, high-impact verticality.',
  '4:3': 'Composition: Aspect ratio 4:3 standard photography perspective, detailed scene depth, classic staging.',
  '3:4': 'Composition: Aspect ratio 3:4 vertical editorial portrait framing, elegant vertical proportion.',
};

/**
 * ImageGenerationService - Motor de Generación Visual Nano Banana Pro
 * Integra dirección de arte agéntica, sanitización anti-bloqueo, pool failover y resguardo soberano en GCS.
 */
export class ImageGenerationService {
  constructor(deps = {}) {
    this.ai = deps.ai || null;
    this.geminiPool = deps.geminiPool || defaultGeminiPool;
    this.storageProvider = deps.storageProvider || defaultStorageProvider;
    this.timeoutMs = deps.timeoutMs || 20000;
  }

  _getClient() {
    if (this.ai) return this.ai;
    if (this.geminiPool && typeof this.geminiPool.getClient === 'function') {
      const client = this.geminiPool.getClient();
      if (client) return client;
    }
    const singleKey = config?.ai?.geminiApiKey || process.env.GEMINI_API_KEY;
    if (singleKey) return new GoogleGenAI({ apiKey: singleKey });
    return null;
  }

  expandPrompt(rawPrompt, { aspectRatio = '1:1', mode = 'arte_final', style } = {}) {
    let sanitized = String(rawPrompt || '').trim();
    for (const rule of BRAND_SANITIZATION_RULES) {
      sanitized = sanitized.replace(rule.pattern, rule.replacement);
    }

    const ratioDirective = ASPECT_RATIO_DIRECTIVES[aspectRatio] || ASPECT_RATIO_DIRECTIVES['1:1'];
    const isSketch = mode === 'boceto';

    const baseArtDirection = isSketch
      ? 'Style: Architectural concept sketch, technical wireframe render, clean studio draft, detailed pencil and ink line-work, high contrast, clean white background, ideation drawing.'
      : 'Style: Ultra-high-resolution photorealistic commercial render, professional architectural photography, cinematic warm atmospheric lighting, meticulous attention to physical materials (weathered wood, wrought iron, brass, textured fabrics), 8k resolution masterpiece.';

    const customStyle = style ? `Additional Aesthetic: ${style}.` : '';
    const decoContext = /(stand|feria|exposici[oó]n|r[oó]tulo|tienda|mueble)/i.test(sanitized)
      ? 'Context: Deco Vintage trade show exhibition or commercial artisan production, boutique craftsmanship, warm ambient glow.'
      : '';

    return [sanitized, baseArtDirection, customStyle, decoContext, ratioDirective].filter(Boolean).join('\n\n');
  }

  _extractImageBytes(response) {
    if (!response) return null;
    const candidate = response.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      return { isSafetyBlock: true, reason: 'SAFETY_FILTER_TRIGGERED' };
    }

    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          buffer: Buffer.from(part.inlineData.data, 'base64'),
          mimeType: part.inlineData.mimeType || 'image/png',
        };
      }
    }

    const genImages = response.generatedImages || [];
    if (genImages.length > 0 && genImages[0]?.image?.imageBytes) {
      const bytes = genImages[0].image.imageBytes;
      return {
        buffer: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'base64'),
        mimeType: genImages[0].image.mimeType || 'image/png',
      };
    }

    return null;
  }

  async generateImage({ prompt, aspectRatio = '1:1', mode = 'arte_final', style, throwOnError = false } = {}) {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('El prompt visual debe tener al menos 5 caracteres.');
    }

    const expandedPrompt = this.expandPrompt(prompt, { aspectRatio, mode, style });
    const modelsHierarchy = mode === 'boceto' ? FLASH_MODELS : PRO_MODELS;
    let lastError = null;
    let quotaFailures = 0;

    for (const modelName of modelsHierarchy) {
      const attempts = this.geminiPool?.size ? Math.max(this.geminiPool.size, 1) : 1;

      for (let attempt = 0; attempt < attempts; attempt++) {
        const client = this._getClient();
        if (!client) throw new Error('Cliente de Gemini no configurado o sin API Key disponible.');

        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new TimeoutError()), this.timeoutMs);
          });

          const generatePromise = (async () => {
            if (client.models?.generateContent) {
              return await client.models.generateContent({
                model: modelName,
                contents: [{ role: 'user', parts: [{ text: expandedPrompt }] }],
                config: { responseMimeType: 'image/png' },
              });
            }
            if (client.models?.generateImages) {
              return await client.models.generateImages({
                model: modelName,
                prompt: expandedPrompt,
                config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio },
              });
            }
            throw new Error('El cliente de Gemini no soporta métodos de generación de imagen.');
          })();

          const response = await Promise.race([generatePromise, timeoutPromise]);
          const extraction = this._extractImageBytes(response);

          if (extraction?.isSafetyBlock) {
            if (throwOnError) throw new SafetyFilterError('Generación bloqueada por filtros de seguridad.', { model: modelName });
            return {
              success: false,
              isSafetyBlock: true,
              reason: 'SAFETY_FILTER_TRIGGERED',
              model: modelName,
              prompt,
              expandedPrompt,
            };
          }

          if (extraction?.buffer) {
            const ext = extraction.mimeType.includes('jpeg') || extraction.mimeType.includes('jpg') ? 'jpg' : 'png';
            const originalName = `nano_${Date.now()}.${ext}`;

            const uploadResult = await this.storageProvider.saveFile({
              buffer: extraction.buffer,
              originalName,
              mimeType: extraction.mimeType,
              subDir: 'generated-images',
            });

            return {
              success: true,
              buffer: extraction.buffer,
              mimeType: extraction.mimeType,
              fileName: uploadResult.fileName,
              filePath: uploadResult.filePath,
              cloudUrl: uploadResult.cloudUrl || uploadResult.publicUrl,
              publicUrl: uploadResult.publicUrl || uploadResult.cloudUrl,
              fileSize: extraction.buffer.length,
              model: modelName,
              prompt,
              expandedPrompt,
              aspectRatio,
              mode,
            };
          }
        } catch (err) {
          lastError = err;
          if (err instanceof TimeoutError) throw err;
          if (err instanceof SafetyFilterError && throwOnError) throw err;

          const isRateLimit = this.geminiPool?.isRateLimitError?.(err) ||
            /429|resource_exhausted|quota/i.test(err?.message || '');

          if (isRateLimit) {
            quotaFailures++;
            if (this.geminiPool && typeof this.geminiPool.rotateKey === 'function') {
              this.geminiPool.rotateKey(`HTTP 429 en ${modelName}`);
            }
            continue;
          }
          break; // Error de modelo no compatible, avanzar al siguiente modelo de respaldo
        }
      }
    }

    if (quotaFailures > 0) throw new QuotaExceededError(lastError?.message);
    throw lastError || new Error('No se pudo generar la imagen tras agotar la jerarquía de modelos.');
  }
}

export const defaultImageGenerationService = new ImageGenerationService();

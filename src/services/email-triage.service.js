import { z } from 'zod';
import { defaultGeminiPool } from './gemini-pool.service.js';

/**
 * 🏛️ EmailTriageService - Triaje Cognitivo de Gmail y Radar VIP [DEKO-CARMEN-047]
 */
export const EmailUrgency = Object.freeze({
  CRITICO: 'CRITICO',
  ALTA: 'ALTA',
  MEDIA: 'MEDIA',
  RUIDO: 'RUIDO',
});

export const EmailCategory = Object.freeze({
  INFRAESTRUCTURA: 'INFRAESTRUCTURA',
  FINANCIERO: 'FINANCIERO',
  CLIENTE_NEGOCIO: 'CLIENTE_NEGOCIO',
  SUSCRIPCION: 'SUSCRIPCION',
  EMERGENCIA_SEBASTIAN: 'EMERGENCIA_SEBASTIAN',
  RUIDO: 'RUIDO',
});

export const EmailTriageOutputSchema = z.object({
  category: z.enum([
    'INFRAESTRUCTURA',
    'FINANCIERO',
    'CLIENTE_NEGOCIO',
    'SUSCRIPCION',
    'EMERGENCIA_SEBASTIAN',
    'RUIDO',
  ]),
  urgency: z.enum(['CRITICO', 'ALTA', 'MEDIA', 'RUIDO']),
  isActionable: z.boolean().default(false),
  executiveReason: z.string().default(''),
  oneLineSummary: z.string().default(''),
});

const SEBASTIAN_EMAIL_PATTERN = /sebasjimenez0330(?:[+]carmencita)?@gmail\.com/i;
const EMERGENCY_SUBJECT_PATTERN = /^(?:carmencita:|para carmencita:)/i;
const INFRA_KEYWORDS = /(?:google|google cloud|ai studio|gcp|passkey|2fa|reseteo|seguridad de la cuenta|verificaci[oó]n|spend cap|presupuesto|facturaci[oó]n|cuota|l[ií]mite|hostinger|dokploy|cloudflare|github|aws)/i;
const FINANCIAL_KEYWORDS = /(?:banco industrial|bi\.com\.gt|banrural|bac credomatic|bac|g&t continental|gyt|promerica|inbursa|declaraguate|sat\.gob|sat|transferencia|comprobante|dep[oó]sito|pago recibido|stripe|paypal)/i;
const BUSINESS_KEYWORDS = /(?:stand|stands|feria|cotizaci[oó]n|presupuesto|deco vintage|midas|carpinter[ií]a|r[oó]tulo|mueble)/i;
const SUBSCRIPTION_KEYWORDS = /(?:openai|anthropic|elevenlabs|vercel|supabase|renovaci[oó]n|suscripci[oó]n)/i;
const NOISE_KEYWORDS = /(?:uber eats|pedidosya|spotify|descuento exclusivo|cup[oó]n|promo@|ofertas@|deals@|newsletter|bolet[ií]n)/i;

export class EmailTriageService {
  constructor({ geminiPool = defaultGeminiPool, ai = null, modelName = 'gemini-2.5-flash-lite' } = {}) {
    this.geminiPool = geminiPool;
    this.ai = ai;
    this.modelName = modelName;
  }

  async classifyEmail({ from = '', to = '', subject = '', snippet = '', bodyText = '' } = {}) {
    const cleanFrom = String(from || '').trim();
    const cleanTo = String(to || '').trim();
    const cleanSubject = String(subject || '').trim();
    const cleanSnippet = String(snippet || '').trim();
    const cleanBody = String(bodyText || '').trim();

    // 1. Canal Asíncrono de Emergencia de Sebastián (Prioridad Cero Latencia)
    const isFromSebas = SEBASTIAN_EMAIL_PATTERN.test(cleanFrom);
    const isToEmergency = /sebasjimenez0330[+]carmencita@gmail\.com/i.test(cleanTo);
    const hasEmergencySub = EMERGENCY_SUBJECT_PATTERN.test(cleanSubject);

    if ((isFromSebas && hasEmergencySub) || isToEmergency) {
      const strippedSub = cleanSubject.replace(EMERGENCY_SUBJECT_PATTERN, '').trim() || cleanSubject;
      return {
        category: EmailCategory.EMERGENCIA_SEBASTIAN,
        urgency: EmailUrgency.CRITICO,
        isActionable: true,
        executiveReason: 'Directiva agéntica directa de emergencia de Sebastián Jiménez',
        oneLineSummary: `Directiva de Sebastián: ${strippedSub}`,
      };
    }

    // 2. Clasificación Cognitiva vía LLM (si hay cliente de IA configurado)
    let llmRes = null;
    try {
      llmRes = await this._classifyWithLLM({ from: cleanFrom, subject: cleanSubject, snippet: cleanSnippet, bodyText: cleanBody });
    } catch {
      // Degradar silenciosamente a heurísticas soberanas
    }

    if (llmRes) {
      return this._enforceVipGuardrails(llmRes, { from: cleanFrom, subject: cleanSubject, snippet: cleanSnippet });
    }

    // 3. Fallback Heurístico Robusto Determinístico
    return this._classifyHeuristically({ from: cleanFrom, subject: cleanSubject, snippet: cleanSnippet, bodyText: cleanBody });
  }

  async _classifyWithLLM({ from, subject, snippet, bodyText }) {
    const aiClient = this.ai || this.geminiPool?.getClient();
    if (!aiClient?.models?.generateContent) return null;

    const truncated = (bodyText || snippet).slice(0, 1500);
    const prompt = `Eres el clasificador cognitivo de correos de Carmencita para Sebastián Jiménez (CEO de DeKo Labs).
Clasifica este correo entrante con precisión en JSON.

REGLAS COERCITIVAS:
1. INFRAESTRUCTURA (CRITICO): Google (claves, seguridad, 2FA, reseteos, límites spend caps, facturación GCP), Hostinger, Dokploy, Cloudflare, GitHub, AWS.
2. FINANCIERO (CRITICO): Bancos de Guatemala (BI, Banrural, BAC, G&T, Promerica), SAT, Declaraguate, Stripe, PayPal, transferencias.
3. CLIENTE_NEGOCIO (ALTA): Clientes o presupuestos de stands feriales Deco Vintage o proyectos Midas.
4. SUSCRIPCION (ALTA): Renovación real de herramientas (OpenAI, Anthropic, ElevenLabs, Vercel, Supabase).
5. RUIDO (RUIDO): Uber Eats, Spotify promociones, cupones masivos, publicidad, spam.

DATOS: De: ${from} | Asunto: ${subject} | Snippet: ${snippet} | Contenido: ${truncated}
Devuelve EXCLUSIVAMENTE este JSON:
{"category":"INFRAESTRUCTURA"|"FINANCIERO"|"CLIENTE_NEGOCIO"|"SUSCRIPCION"|"RUIDO","urgency":"CRITICO"|"ALTA"|"MEDIA"|"RUIDO","isActionable":true|false,"executiveReason":"...","oneLineSummary":"..."}`;

    const res = await aiClient.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: { temperature: 0.1, responseMimeType: 'application/json' },
    });

    const raw = typeof res?.text === 'function' ? res.text() : (res?.text || '');
    if (!raw) return null;

    const parsed = JSON.parse(raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim());
    const validation = EmailTriageOutputSchema.safeParse(parsed);
    return validation.success ? validation.data : null;
  }

  _enforceVipGuardrails(classified, { from, subject, snippet }) {
    const text = `${from} ${subject} ${snippet}`.toLowerCase();
    if (NOISE_KEYWORDS.test(text) && !/alerta|seguridad|cuenta suspendida/i.test(subject)) {
      return {
        category: EmailCategory.RUIDO,
        urgency: EmailUrgency.RUIDO,
        isActionable: false,
        executiveReason: 'Publicidad o promociones masivas descartadas',
        oneLineSummary: subject || 'Publicidad descartada',
      };
    }
    if (/google/i.test(from) && INFRA_KEYWORDS.test(text)) {
      return { ...classified, category: EmailCategory.INFRAESTRUCTURA, urgency: EmailUrgency.CRITICO, isActionable: true };
    }
    if (FINANCIAL_KEYWORDS.test(text)) {
      return { ...classified, category: EmailCategory.FINANCIERO, urgency: EmailUrgency.CRITICO, isActionable: true };
    }
    return classified;
  }

  _classifyHeuristically({ from, subject, snippet, bodyText }) {
    const textAll = `${from} ${subject} ${snippet} ${bodyText}`.toLowerCase();
    if (NOISE_KEYWORDS.test(textAll) && !/alerta|seguridad|cuenta suspendida/i.test(subject)) {
      return {
        category: EmailCategory.RUIDO,
        urgency: EmailUrgency.RUIDO,
        isActionable: false,
        executiveReason: 'Filtro de ruido: publicidad o boletín masivo',
        oneLineSummary: subject || 'Publicidad descartada',
      };
    }
    if (/google/i.test(from) && INFRA_KEYWORDS.test(textAll)) {
      return {
        category: EmailCategory.INFRAESTRUCTURA,
        urgency: EmailUrgency.CRITICO,
        isActionable: true,
        executiveReason: 'Alerta crítica de infraestructura Google / Spend Caps',
        oneLineSummary: subject || 'Alerta de Infraestructura Google',
      };
    }
    if (FINANCIAL_KEYWORDS.test(textAll)) {
      return {
        category: EmailCategory.FINANCIERO,
        urgency: EmailUrgency.CRITICO,
        isActionable: true,
        executiveReason: 'Movimiento bancario guatemalteco o aviso fiscal SAT',
        oneLineSummary: subject || 'Notificación Financiera',
      };
    }
    if (BUSINESS_KEYWORDS.test(textAll)) {
      return {
        category: EmailCategory.CLIENTE_NEGOCIO,
        urgency: EmailUrgency.ALTA,
        isActionable: true,
        executiveReason: 'Consulta o requerimiento de stand / cliente comercial',
        oneLineSummary: subject || 'Contacto de Negocio',
      };
    }
    if (SUBSCRIPTION_KEYWORDS.test(textAll)) {
      return {
        category: EmailCategory.SUSCRIPCION,
        urgency: EmailUrgency.ALTA,
        isActionable: true,
        executiveReason: 'Aviso de suscripción de plataforma de desarrollo',
        oneLineSummary: subject || 'Renovación de Suscripción',
      };
    }
    return {
      category: EmailCategory.RUIDO,
      urgency: EmailUrgency.RUIDO,
      isActionable: false,
      executiveReason: 'Correo informativo general sin requerimiento de acción',
      oneLineSummary: subject || 'Correo general',
    };
  }
}

export const defaultEmailTriageService = new EmailTriageService();

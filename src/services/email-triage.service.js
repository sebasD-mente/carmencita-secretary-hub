import { z } from 'zod';
import { defaultGeminiPool } from './gemini-pool.service.js';
import { config } from '../config.js';

/**
 * 🏛️ EmailTriageService - Triaje Cognitivo de Gmail y Radar VIP [DEKO-CARMEN-047]
 */
export const EmailUrgency = Object.freeze({ CRITICO: 'CRITICO', ALTA: 'ALTA', MEDIA: 'MEDIA', RUIDO: 'RUIDO' });

export const EmailCategory = Object.freeze({
  INFRAESTRUCTURA: 'INFRAESTRUCTURA',
  FINANCIERO: 'FINANCIERO',
  CLIENTE_NEGOCIO: 'CLIENTE_NEGOCIO',
  SUSCRIPCION: 'SUSCRIPCION',
  EMERGENCIA_SEBASTIAN: 'EMERGENCIA_SEBASTIAN',
  RUIDO: 'RUIDO',
});

export const EmailTriageOutputSchema = z.object({
  category: z.enum(['INFRAESTRUCTURA', 'FINANCIERO', 'CLIENTE_NEGOCIO', 'SUSCRIPCION', 'EMERGENCIA_SEBASTIAN', 'RUIDO']),
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
  constructor({ geminiPool = defaultGeminiPool, ai = null, modelName = null } = {}) {
    this.geminiPool = geminiPool;
    this.ai = ai;
    // Prioridad: parámetro explícito -> gemini-3.5-flash-lite del pool -> modelo global -> gemini-3.8-flash
    const defaultFastModel = config?.ai?.modelPool?.find((m) => m.includes('3.5-flash-lite')) || config?.ai?.modelName || 'gemini-3.8-flash';
    this.modelName = modelName || defaultFastModel;
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

  _getClient() {
    if (this.ai) return this.ai;
    const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some((a) => a.includes('test'));
    if (this.geminiPool && !isTest) {
      return this.geminiPool.getClient?.() || null;
    }
    return null;
  }

  async _classifyWithLLM({ from, subject, snippet, bodyText }) {
    const aiClient = this._getClient();
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
      return { category: EmailCategory.RUIDO, urgency: EmailUrgency.RUIDO, isActionable: false, executiveReason: 'Filtro de ruido: publicidad o boletín masivo', oneLineSummary: subject || 'Publicidad descartada' };
    }
    if (/google/i.test(from) && INFRA_KEYWORDS.test(textAll)) {
      return { category: EmailCategory.INFRAESTRUCTURA, urgency: EmailUrgency.CRITICO, isActionable: true, executiveReason: 'Alerta crítica de infraestructura Google / Spend Caps', oneLineSummary: subject || 'Alerta de Infraestructura Google' };
    }
    if (FINANCIAL_KEYWORDS.test(textAll)) {
      return { category: EmailCategory.FINANCIERO, urgency: EmailUrgency.CRITICO, isActionable: true, executiveReason: 'Movimiento bancario guatemalteco o aviso fiscal SAT', oneLineSummary: subject || 'Notificación Financiera' };
    }
    if (BUSINESS_KEYWORDS.test(textAll)) {
      return { category: EmailCategory.CLIENTE_NEGOCIO, urgency: EmailUrgency.ALTA, isActionable: true, executiveReason: 'Consulta o requerimiento de stand / cliente comercial', oneLineSummary: subject || 'Contacto de Negocio' };
    }
    if (SUBSCRIPTION_KEYWORDS.test(textAll)) {
      return { category: EmailCategory.SUSCRIPCION, urgency: EmailUrgency.ALTA, isActionable: true, executiveReason: 'Aviso de suscripción de plataforma de desarrollo', oneLineSummary: subject || 'Renovación de Suscripción' };
    }
    return { category: EmailCategory.RUIDO, urgency: EmailUrgency.RUIDO, isActionable: false, executiveReason: 'Correo informativo general sin requerimiento de acción', oneLineSummary: subject || 'Correo general' };
  }

  /**
   * Genera una síntesis ejecutiva natural, cálida y sin plantillas quemadas para Telegram [DEKO-CARMEN-048]
   * @param {Array<{email: Object, classification: Object}>} priorityItems
   * @returns {Promise<string>}
   */
  async generateExecutiveEmailBriefing(priorityItems = []) {
    if (!priorityItems || priorityItems.length === 0) return '';

    const aiClient = this._getClient();
    if (!aiClient?.models?.generateContent) {
      return this._fallbackDynamicBriefing(priorityItems);
    }

    const itemsData = priorityItems.map((item) => ({
      remitente: item.email?.from,
      asunto: item.email?.subject,
      categoria: item.classification?.category,
      urgencia: item.classification?.urgency,
      esNoReply: /no[-_]?reply|noreply|donotreply/i.test(item.email?.from || ''),
      resumen: item.classification?.oneLineSummary || item.email?.snippet,
    }));

    const prompt = `Eres Carmencita, la Chief of Staff ejecutiva de Sebastián Jiménez en DeKo Labs.
Redacta una notificación breve, natural, humana y ejecutiva para Telegram sobre estas novedades de correo.

REGLAS INQUEBRANTABLES:
1. CERO PLANTILLAS QUEMADAS: Prohibido terminar con "¿Deseas que prepare una respuesta?" o frases repetitivas de chatbot.
2. DISCERNIMIENTO REAL: Si son correos automáticos o no-reply (recibos de pago, Google Cloud, Apple), dile con naturalidad que el cobro/alerta pasó con éxito y que NO requiere ninguna acción de su parte.
3. Si hay un cliente o asunto de acción real, proponle la acción concreta de forma ejecutiva.
4. Tono: Respetuoso, ágil, cálido y profesional ("Sebas", "Jefe").
5. Formato: Telegram HTML limpio.

DATOS DE CORREOS:
${JSON.stringify(itemsData, null, 2)}`;

    try {
      const activeModel = this.modelName || config?.ai?.modelName || 'gemini-3.8-flash';
      const res = await aiClient.models.generateContent({
        model: activeModel,
        contents: prompt,
        config: { temperature: 0.3 },
      });
      const text = typeof res?.text === 'function' ? res.text() : (res?.text || '');
      return text.trim() || this._fallbackDynamicBriefing(priorityItems);
    } catch {
      return this._fallbackDynamicBriefing(priorityItems);
    }
  }

  async synthesizeTriageBriefing(priorityItems = []) {
    return await this.generateExecutiveEmailBriefing(priorityItems);
  }

  _fallbackDynamicBriefing(priorityItems = []) {
    if (!priorityItems || priorityItems.length === 0) return '';
    const lines = priorityItems.map((item) => {
      const fromClean = (item.email?.from || 'Remitente').replace(/<[^>]+>/, '').trim();
      const subject = item.email?.subject || '(Sin Asunto)';
      const summary = item.classification?.oneLineSummary || item.email?.snippet || subject;
      const isNoReply = /no[-_]?reply|noreply|donotreply/i.test(item.email?.from || '');
      const cat = item.classification?.category;
      const icon = (cat === 'INFRAESTRUCTURA' || cat === EmailCategory.INFRAESTRUCTURA) ? '🔴'
        : (cat === 'FINANCIERO' || cat === EmailCategory.FINANCIERO) ? '🟢'
        : (cat === 'CLIENTE_NEGOCIO' || cat === EmailCategory.CLIENTE_NEGOCIO) ? '💼'
        : (cat === 'SUSCRIPCION' || cat === EmailCategory.SUSCRIPCION) ? '💳' : '📌';
      return { fromClean, subject, summary, isNoReply, icon, cat };
    });

    if (lines.length === 1) {
      const it = lines[0];
      const isAuto = it.isNoReply || it.cat === 'INFRAESTRUCTURA' || it.cat === 'FINANCIERO' || it.cat === 'SUSCRIPCION';
      const footer = isAuto
        ? 'ℹ️ Es una confirmación o alerta del sistema en orden; no requiere acción de tu parte.'
        : 'Quedo atenta si decides que avancemos con alguna gestión.';
      return `✉️ <b>Sebas, novedad en tu bandeja:</b>\n\n${it.icon} <b>De:</b> ${it.fromClean}\n📌 <i>${it.subject}</i>\n${it.summary}\n\n${footer}`;
    }

    const allAuto = lines.every((l) => l.isNoReply || l.cat === 'INFRAESTRUCTURA' || l.cat === 'FINANCIERO');
    const header = allAuto
      ? '✉️ <b>Sebas, entraron estas actualizaciones automáticas:</b>'
      : '✉️ <b>Sebas, novedades importantes en tu bandeja:</b>';
    const footer = allAuto
      ? 'ℹ️ Son avisos de servicio en orden; todo operando normalmente y sin acción requerida.'
      : 'Quedo atenta a tus instrucciones si deseas priorizar alguna.';
    const items = lines.map((l) => `${l.icon} <b>${l.fromClean}:</b> <i>${l.summary}</i>`).join('\n');
    return `${header}\n\n${items}\n\n${footer}`;
  }
}

export const defaultEmailTriageService = new EmailTriageService();


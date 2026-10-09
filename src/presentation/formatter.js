/**
 * PresentationFormatter - Middleware desacoplado de presentación para Carmencita 2.0 (Deko Labs).
 * Transforma texto generado por el LLM a HTML válido para Telegram y optimiza texto para voz (TTS).
 */

/**
 * Balancea y cierra etiquetas HTML huérfanas soportadas por Telegram.
 * @param {string} html
 * @returns {string}
 */
function balanceHtmlTags(html) {
  const allowedTags = ['b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'a'];
  const openStack = [];
  const tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*?)?>/g;
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = fullTag.startsWith('</');

    result += html.slice(lastIndex, match.index);
    lastIndex = tagRegex.lastIndex;

    if (!allowedTags.includes(tagName)) {
      result += fullTag.replace('<', '&lt;').replace('>', '&gt;');
      continue;
    }

    if (isClosing) {
      const idx = openStack.lastIndexOf(tagName);
      if (idx !== -1) {
        while (openStack.length > idx) {
          const t = openStack.pop();
          result += `</${t}>`;
        }
      }
    } else {
      openStack.push(tagName);
      result += fullTag;
    }
  }

  result += html.slice(lastIndex);

  while (openStack.length > 0) {
    const t = openStack.pop();
    result += `</${t}>`;
  }

  return result;
}

export class PresentationFormatter {
  /**
   * Formatea texto para Telegram:
   * - Markdown a HTML (negrita, cursiva, código)
   * - Erradica asteriscos de markdown
   * - Garantiza aire visual (doble salto \n\n)
   * - Normaliza viñetas a •
   * - Sanitiza ampersands y balancea etiquetas HTML
   * @param {string} rawText
   * @returns {string}
   */
  static formatForTelegram(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';

    // 1. Eliminar bloques JSON residuales de acciones si existiesen
    let text = rawText
      .replace(/```(?:json)?\s*[\s\S]*?\{[\s\S]*?"action"[\s\S]*?\}[\s\S]*?```/gi, '')
      .replace(/\{"action"[\s\S]*?\}/gi, '')
      .trim();

    // 2. Proteger bloques preformateados <pre> y ```
    const codeBlocks = [];
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
      const token = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(`<pre>${code.trim()}</pre>`);
      return token;
    });

    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      const token = `__INLINE_CODE_${inlineCodes.length}__`;
      inlineCodes.push(`<code>${code}</code>`);
      return token;
    });

    // 3. Sanitizar ampersands sueltos (& -> &amp;) que no sean entidades válidas
    text = text.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-fA-F0-9]+);)/g, '&amp;');

    // 4. Encabezados Markdown (# Título, ## Título, ### Título)
    text = text.replace(/(^|\n)[ \t]*#{1,6}[ \t]+([^\r\n]+)/g, '$1<b>$2</b>\n\n');

    // 5. Negritas y Cursivas Markdown a HTML
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    text = text.replace(/\*([^*\n]+)\*/g, '<i>$1</i>');
    text = text.replace(/(?<=^|[\s.,!?;:()\[\]])_([^_]+)_(?=[\s.,!?;:()\[\]]|$)/g, '<i>$1</i>');

    // 6. Normalización de Listas y Viñetas (- o * al inicio de línea -> • )
    text = text.replace(/(^|\n)[ \t]*[-*][ \t]+/g, '$1• ');

    // 7. Erradicación total de cualquier asterisco residual
    text = text.replace(/\*/g, '');

    // 8. Ley de Aire Visual: asegurar doble salto (\n\n) entre párrafos/elementos
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    text = lines.join('\n\n');

    // 9. Restaurar bloques de código protegidos
    inlineCodes.forEach((codeHtml, idx) => {
      text = text.replace(`__INLINE_CODE_${idx}__`, codeHtml);
    });
    codeBlocks.forEach((codeHtml, idx) => {
      text = text.replace(`__CODE_BLOCK_${idx}__`, codeHtml);
    });

    // 10. Balanceo y cierre de tags HTML huérfanos
    return balanceHtmlTags(text);
  }

  /**
   * Limpia texto para síntesis de voz (TTS):
   * - Elimina emojis, HTML, código, URLs y caracteres especiales
   * - Dicción fluida para el motor Google GenAI
   * @param {string} rawText
   * @returns {string}
   */
  static formatForVoice(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';

    return rawText
      // Eliminar bloques de código o JSON
      .replace(/```(?:json)?[\s\S]*?```/gi, '')
      .replace(/\{"action"[\s\S]*?\}/gi, '')
      // Eliminar etiquetas HTML
      .replace(/<[^>]+>/g, '')
      // Enlaces Markdown: conservar solo el texto visible
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // URLs directas
      .replace(/https?:\/\/\S+/gi, '')
      // Eliminar emojis (Unicode Extended Pictographic y variantes)
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[\uFE0E\uFE0F]/g, '')
      // Eliminar sintaxis markdown y caracteres especiales
      .replace(/[*_~`#]/g, '')
      // Normalizar viñetas y guiones largos a silencio o pausa natural
      .replace(/[•–—]/g, '-')
      // Colapsar espacios y ajustar puntuación
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim();
  }
}

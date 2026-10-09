/**
 * MarkdownSerializer - Parseo, Serialización y Normalización de Notas Obsidian
 * Estándar Deko Labs Enterprise: Robusto, Profesional y Escalable
 * Ticket: [DEKO-CARMEN-M5]
 */

export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesSearchTerm(target, term) {
  if (!target || !term) return false;
  const targetLower = target.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const termLower = term.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (termLower.length <= 2) {
    const rx = new RegExp(`(^|[^a-z0-9])${escapeRegExp(termLower)}([^a-z0-9]|$)`, 'i');
    return rx.test(targetLower);
  }
  return targetLower.includes(termLower);
}

export function normalizeNoteTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .replace(/\.md$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Elimina acentos/diacríticos
    .toLowerCase()
    .replace(/[—–]/g, '-') // Sustituye em-dash y en-dash por guion simple
    .replace(/[\s_-]+/g, '-') // Normaliza espacios, guiones bajos y múltiples guiones
    .replace(/^-+|-+$/g, '') // Elimina guiones al inicio o final
    .trim();
}

/**
 * Divide el contenido markdown en fragmentos de texto respetando párrafos y encabezados (~500 a 800 caracteres).
 */
export function _chunkMarkdown(content, maxChunkLength = 800) {
  if (!content || typeof content !== 'string') return [];
  const paragraphs = content.split(/\n{2,}/);
  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if ((currentChunk.length + trimmed.length) > maxChunkLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

export function sanitizeFileName(title) {
  const safe = (title || 'Nota').replace(/[\/\\?%*:|"<>]/g, '-').trim();
  return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`;
}

export function serializeMarkdownNote({ title, content, folder = '01_Inbox', tags = [], wikilinks = [] } = {}) {
  const trimmed = typeof content === 'string' ? content : String(content || '');
  if (trimmed.trim().startsWith('---')) {
    return trimmed;
  }

  const ahora = new Date();
  const ahoraGuatemala = new Date(ahora.getTime() - 6 * 3600 * 1000).toISOString().replace('Z', '-06:00');

  const tagList = Array.isArray(tags) ? tags : [];
  const yamlTags = tagList.length > 0 ? `tags:\n${tagList.map(t => `  - ${t.replace(/^#/, '')}`).join('\n')}\n` : '';

  const linksBlock = Array.isArray(wikilinks) && wikilinks.length > 0
    ? `\n\n### 🔗 Enlaces Relacionados (Graph View)\n${wikilinks.map(l => `- [[${l.replace(/^\[\[|\]\]$/g, '')}]]`).join('\n')}`
    : '';

  const safeTitle = title || 'Nota';
  return `---
title: "${safeTitle.replace(/"/g, '\\"')}"
date: ${ahoraGuatemala}
author: Carmencita
folder: "${folder}"
${yamlTags}---

# ${safeTitle}

${trimmed}${linksBlock}
`;
}

export class MarkdownSerializer {
  normalizeTitle(title) {
    return normalizeNoteTitle(title);
  }

  matchesSearch(target, term) {
    return matchesSearchTerm(target, term);
  }

  chunkMarkdown(content, maxChunkLength = 800) {
    return _chunkMarkdown(content, maxChunkLength);
  }

  sanitizeFileName(title) {
    return sanitizeFileName(title);
  }

  serializeNote(options) {
    return serializeMarkdownNote(options);
  }
}

export const defaultMarkdownSerializer = new MarkdownSerializer();

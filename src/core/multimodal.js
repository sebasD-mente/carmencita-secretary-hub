import { makeActionResult } from '../tools/index.js';
import { IMAGE_PROMPT_TEMPLATE, DOCUMENT_PROMPT } from './carmencita.prompt.js';

/**
 * Procesador multimodal (Imágenes, OCR y Notas de Voz) para CarmencitaBrain.
 * Aísla la manipulación de buffers binarios y contratos visuales/auditivos.
 */

export async function handleBrainImage(brain, { channel, senderId, senderName, buffer, mimeType, caption = '' }) {
  if (!brain.ai) {
    const doc = await brain.documentService.saveDocument({
      buffer, originalName: 'foto_recibida.jpg', mimeType: mimeType || 'image/jpeg',
      category: 'GENERAL', summary: caption || 'Foto guardada',
    });
    return makeActionResult({ reply: `📎 ¡Recibí la foto! La he resguardado en tu bóveda (${doc.fileName}).`, hasDocument: true, documentFile: doc });
  }

  try {
    const { recentMessages } = await brain._getRecentContext(channel, senderId);
    const recentContextText = recentMessages.map((m) => `[${m.role}]: ${m.content}`).join('\n');
    const ragQuery = caption?.trim() || (recentMessages.length ? recentMessages.slice(-2).map((m) => m.content).join(' ') : 'documentos');
    const { directivesBlock, memoriesBlock } = await brain._resolveRAGContext(ragQuery);

    const res = await brain._generateContentWithFailover({
      contents: [IMAGE_PROMPT_TEMPLATE(recentContextText, directivesBlock, memoriesBlock), { inlineData: { mimeType: mimeType || 'image/jpeg', data: buffer.toString('base64') } }],
      config: { systemInstruction: brain.getSystemPrompt() },
    });

    let p = {};
    const m = (res.text || '').match(/\{[\s\S]*\}/);
    if (m) { try { p = JSON.parse(m[0]); } catch {} }

    if (p.isFactura === true && p.type === 'FACTURA_RECIBO') {
      const inv = p.invoiceData || {};
      const doc = await brain.documentService.saveDocument({
        buffer, originalName: `${p.title || inv.item || 'factura'}.jpg`, mimeType: mimeType || 'image/jpeg',
        category: 'FACTURA', summary: p.executiveReply || caption,
        invoiceData: {
          vendor: inv.vendor || 'Proveedor', item: inv.item || caption || 'Artículo',
          totalAmount: Number(inv.totalAmount ?? inv.total ?? 0), currency: inv.currency || 'GTQ',
          purchaseDate: inv.purchaseDate || new Date(), warrantyMonths: inv.warrantyMonths || 0, notes: p.extractedText || caption,
        },
      });
      const rep = `✅ **¡Factura clasificada y resguardada en PostgreSQL!**\n\n📦 **Artículo:** ${doc.invoice?.item} | 🏢 **Proveedor:** ${doc.invoice?.vendor}\n💰 **Total:** ${doc.invoice?.currency} ${doc.invoice?.totalAmount} | 🛡️ **Garantía:** ${doc.invoice?.warrantyMonths} meses\n📁 **Bóveda ID:** \`${doc.id}\`\n\n${p.executiveReply || doc.summary}`;
      await brain._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: rep });
      return makeActionResult({ reply: rep, hasDocument: true, documentFile: doc, fullHistoryText: rep });
    }

    const cat = p.type === 'DIAGRAMA_ARQUITECTURA' ? 'PROYECTO_BRIEF' : 'GENERAL';
    const doc = await brain.documentService.saveDocument({
      buffer, originalName: `${p.title || 'captura'}.jpg`, mimeType: mimeType || 'image/jpeg',
      category: cat, summary: p.extractedText || p.executiveReply || caption, invoiceData: null,
    });
    const rep = p.executiveReply || `Sebastián querido, ya revisé la imagen (${p.title || 'archivo'}). Quedó resguardada en tu bóveda.`;
    let voiceFile = null;
    if (Boolean(caption?.match(/audio|voz|escuchar/i) || recentMessages.slice(-3).some((msg) => msg.content?.match(/audio|voz|escuchar/i))) && brain.voiceService?.synthesizeSpeech) {
      try { voiceFile = await brain.voiceService.synthesizeSpeech(rep); } catch {}
    }
    await brain._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: rep });
    return makeActionResult({ reply: rep, hasVoice: Boolean(voiceFile), voiceFile, hasDocument: true, documentFile: doc, fullHistoryText: `${rep}\n[Imagen analizada: ${p.type || 'GENERAL'}]` });
  } catch (err) {
    const errMsg = `Recibí la foto, pero ocurrió un problema al procesarla: ${err.message}`;
    await brain._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: errMsg });
    return makeActionResult({ reply: errMsg });
  }
}

export async function handleBrainDocument(brain, { channel, senderId, senderName, buffer, mimeType, originalName, caption = '' }) {
  let category = 'GENERAL', summary = caption || `Documento ${originalName} recibido.`, metadata = {}, invoiceData = null;
  if (brain.ai) {
    try {
      const contents = [DOCUMENT_PROMPT];
      if (mimeType.includes('pdf') || mimeType.includes('image')) contents.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
      const response = await brain._generateContentWithFailover({ contents, config: { systemInstruction: brain.getSystemPrompt() } });
      const match = (response.text || '').match(/\{[\s\S]*\}/);
      if (match) {
        const p = JSON.parse(match[0]);
        category = p.category || 'GENERAL'; summary = p.summary || summary; metadata = p;
        if (category === 'FACTURA' || category === 'COTIZACION') {
          invoiceData = { vendor: p.vendor || 'Proveedor', item: p.item || originalName, totalAmount: p.totalAmount || 0, currency: p.currency || 'GTQ' };
        }
      }
    } catch (e) { console.warn('[Brain] OCR fallback:', e.message); }
  }

  const doc = await brain.documentService.saveDocument({ buffer, originalName, mimeType, category, summary, metadata, invoiceData });
  const reply = `📑 **¡Documento clasificado y archivado en Bóveda!**\n\n📁 **Archivo:** \`${doc.originalName}\` | 🏷️ **Categoría:** **${doc.category}**\n💾 **Tamaño:** ${(doc.fileSize / 1024).toFixed(1)} KB | 🆔 **ID:** \`${doc.id}\`\n\n📌 **Resumen Ejecutivo:**\n${doc.summary || 'Documento resguardado exitosamente.'}`;
  await brain._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: reply });
  return reply;
}

export async function handleBrainAudio(brain, { channel, senderId, senderName, buffer, mimeType, text = '', onProgress = null }) {
  if (!brain.ai) return `🎙️ Recibí tu nota de voz, Sebastián. En context conectemos la API de Gemini podré transcribirla y ejecutar las órdenes de inmediato.`;
  try {
    const { ahoraGuatemala, ahoraIso } = brain._getGuatemalaTimestamps();
    const { recentMessages, pendingTasks } = await brain._getRecentContext(channel, senderId);
    const ragQuery = text?.trim() || (recentMessages.length ? recentMessages.slice(-2).map((m) => m.content).join(' ') : 'directivas y preferencias');
    const { directivesBlock, memoriesBlock } = await brain._resolveRAGContext(ragQuery);
    const historyBlock = recentMessages.length ? `\n📜 HISTORIAL DE CONVERSACIÓN RECIENTE (MEMORIA DE CONTEXTO):\n${recentMessages.map((m) => `[${m.channel}] ${m.role === 'user' ? senderName : 'Carmencita'}: ${m.content}`).join('\n')}\n` : '';
    const prompt = `\nCONTEXTO TEMPORAL DEL SISTEMA:\n• Fecha y hora actual en Guatemala: ${ahoraGuatemala} (America/Guatemala / UTC-6)\n• Timestamp ISO 8601: ${ahoraIso}\n• Canal: ${channel} | Usuario: ${senderName} (ID: ${senderId})\n• Tareas pendientes activas: ${JSON.stringify(pendingTasks.map((t) => t.description))}${historyBlock}${directivesBlock}${memoriesBlock}\n\nEscucha atentamente este audio de Sebastián. Ten muy presente el HISTORIAL DE CONVERSACIÓN RECIENTE y las directivas recuperadas. Responde con un mensaje hablado, cálido, zalamero y natural de 2 a 3 oraciones. Si requiere acciones técnicas, agrega el bloque JSON al final.`;

    const response = await brain._generateContentWithFailover({
      contents: [prompt, { inlineData: { mimeType: mimeType || 'audio/ogg', data: buffer.toString('base64') } }],
      config: { systemInstruction: brain.getSystemPrompt() },
    });
    const replyText = response.text || 'He escuchado tu nota de voz, Sebastián.';
    const actionResult = await brain._executeExtractedActions(replyText, onProgress, { userText: text || 'nota de voz recibida', isAudio: true, channel, senderId, senderName });
    if (!actionResult.hasVoice && brain.voiceService) {
      try {
        const voiceFile = await brain.voiceService.synthesizeSpeech(actionResult.reply);
        if (voiceFile) { actionResult.hasVoice = true; actionResult.voiceFile = voiceFile; }
      } catch {}
    }
    const historyContent = actionResult.fullHistoryText || actionResult.reply || replyText;
    await brain._logMessage({ channel, senderId, senderName: 'Carmencita', role: 'assistant', content: historyContent });
    if (brain.embeddingService && !actionResult.hasMemory) {
      brain._lastMemoryTask = brain._extractAndSaveMemoryBackground({ userText: text?.trim() || actionResult.reply, historyContent }).catch(() => {});
    }
    return actionResult;
  } catch (err) {
    return `Escuché la nota de voz pero ocurrió un error al analizarla: ${err.message}`;
  }
}

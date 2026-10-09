import { makeActionResult, synthesizeToolResults } from './index.js';

/**
 * Módulo de Herramientas de Obsidian Vault (Google Drive, Segundo Cerebro, RAG y Sincronización).
 */
export async function handleObsidianAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

  if (!deps.obsidianService) {
    const errorReply = action === 'SAVE_OBSIDIAN_NOTE'
      ? `${cleanText}\n\n⚠️ Servicio de Obsidian en Google Drive no configurado.`
      : (action === 'SYNC_OBSIDIAN_VAULT'
        ? '⚠️ Sebastián querido, el servicio de Obsidian Vault no está configurado en este momento.'
        : '⚠️ Sebastián querido, el servicio de Obsidian en Google Drive aún no está configurado en mis variables de entorno.');
    return makeActionResult({ reply: errorReply, actionData: parsedAction });
  }

  // ------------------- GUARDAR NOTA -------------------
  if (action === 'SAVE_OBSIDIAN_NOTE') {
    try {
      const noteResult = await deps.obsidianService.createNote({
        title: parsedAction.title, content: parsedAction.content, folder: parsedAction.folder || 'Inbox',
        tags: parsedAction.tags || [], wikilinks: parsedAction.wikilinks || [],
      });
      const reply = `${cleanText}\n\n📓 *Nota guardada en tu Obsidian Vault:*\n📂 Carpeta: \`/${noteResult.folder}/${noteResult.fileName}\`\n🕸️ Nodos vinculados al Grafo: ${parsedAction.wikilinks?.map((w) => `\`[[${w}]]\``).join(', ') || 'General'}\nSe sincronizará automáticamente con tu aplicación en Windows.`;
      return makeActionResult({
        reply, hasObsidianNote: true, obsidianNote: noteResult, actionData: parsedAction,
        fullHistoryText: `${cleanText}\n[Nota guardada en Obsidian: /${noteResult.folder}/${noteResult.fileName}]`,
      });
    } catch (err) {
      console.error('[Brain Obsidian] Error creando nota en Drive:', err);
      return makeActionResult({ reply: `${cleanText}\n\n⚠️ No pude sincronizar la nota en Google Drive para Obsidian: ${err.message}`, actionData: parsedAction });
    }
  }

  // ------------------- ACTUALIZAR NOTA (IN-SITU) -------------------
  if (action === 'UPDATE_OBSIDIAN_NOTE') {
    let updateResult = null, updateErr = null;
    try {
      updateResult = await deps.obsidianService.updateNote({
        title: parsedAction.title, content: parsedAction.content, folder: parsedAction.folder || null,
        tags: parsedAction.tags || [], wikilinks: parsedAction.wikilinks || [], overwrite: true,
      });
    } catch (err) { console.error('[Brain Obsidian] Error actualizando nota en Drive:', err.message); updateErr = err.message; }

    if (updateErr || !updateResult) {
      return makeActionResult({ reply: `⚠️ Sebastián querido, no pude actualizar la nota "${parsedAction.title}" en Google Drive: ${updateErr || 'Error desconocido'}.`, actionData: parsedAction });
    }

    const noteTitle = updateResult.fileName || parsedAction.title;
    const noteFolder = updateResult.folder || parsedAction.folder || '01_Inbox';
    const noteConfirmation = `\n\n📓 *Nota actualizada in-situ en Obsidian Vault:*\n📂 Carpeta: \`/${noteFolder}/${noteTitle}\`\nQuedó sincronizada y re-indexada sin duplicados en tu bóveda.`;
    const reply = cleanText ? `${cleanText}${noteConfirmation}` : `¡Listo mi Sebastián querido! He actualizado exitosamente la nota **${noteTitle}** en Obsidian.${noteConfirmation}`;
    return makeActionResult({
      reply, hasObsidianNote: true, obsidianNote: updateResult, actionData: parsedAction,
      fullHistoryText: `${reply}\n[Nota actualizada en Obsidian Vault: /${noteFolder}/${noteTitle}]`,
    });
  }

  // ------------------- ANEXAR A NOTA -------------------
  if (action === 'APPEND_OBSIDIAN_NOTE') {
    let appendResult = null, appendErr = null;
    try {
      appendResult = await deps.obsidianService.appendToNote({
        name: parsedAction.title, folder: parsedAction.folder || null, contentToAppend: parsedAction.content,
      });
    } catch (err) { console.error('[Brain Obsidian] Error anexando a nota en Drive:', err.message); appendErr = err.message; }

    if (appendErr || !appendResult) {
      return makeActionResult({ reply: `⚠️ Sebastián querido, no pude anexar el contenido a la nota "${parsedAction.title}" en Google Drive: ${appendErr || 'Error desconocido'}.`, actionData: parsedAction });
    }

    const noteTitle = appendResult.fileName || parsedAction.title;
    const noteConfirmation = `\n\n📓 *Nota actualizada en Obsidian Vault:*\n📂 Carpeta: \`/${parsedAction.folder || '01_Inbox'}/${noteTitle}\`\nQuedó sincronizada de inmediato en tu bóveda.`;
    const reply = cleanText ? `${cleanText}${noteConfirmation}` : `¡Listo mi Sebastián querido! He anexado la nueva información a tu nota **${noteTitle}** en Obsidian.${noteConfirmation}`;
    return makeActionResult({
      reply, hasObsidianNote: true, obsidianNote: appendResult, actionData: parsedAction,
      fullHistoryText: `${reply}\n[Contenido anexado a nota de Obsidian: ${appendResult.fileName || parsedAction.title}]`,
    });
  }

  // ------------------- LEER NOTA -------------------
  if (action === 'READ_OBSIDIAN_NOTE') {
    let note = null, readErr = null;
    try {
      note = await deps.obsidianService.readNote({ name: parsedAction.title, folder: parsedAction.folder || null });
    } catch (err) { console.error('[Brain Obsidian] Error leyendo nota en Drive:', err.message); readErr = err.message; }

    if (readErr || !note) {
      const reply = `Mira Sebastián querido, no pude encontrar ni leer la nota "${parsedAction.title}" en tu Obsidian Vault: ${readErr || 'Nota no encontrada'}.`;
      return makeActionResult({ reply, actionData: parsedAction, fullHistoryText: `${reply}\n[Lectura fallida en Obsidian: "${parsedAction.title}"]` });
    }

    const synthesis = await synthesizeToolResults(deps, {
      userText: context.userText || `Léeme la nota ${parsedAction.title}`, toolName: 'Obsidian Vault',
      dataSummary: `Título de la nota: ${note.fileName || parsedAction.title}\nContenido Markdown:\n${note.content}`, context,
    });

    let voiceFile = null;
    const wantsVoice = Boolean(context?.isAudio || (context?.userText && /audio|voz|escuchar|nota de voz|resumen en audio/i.test(context.userText)));
    if (wantsVoice && deps.voiceService?.synthesizeSpeech) {
      try { voiceFile = await deps.voiceService.synthesizeSpeech(synthesis); }
      catch (vErr) { console.warn('[Brain Obsidian Voice] Error sintetizando audio:', vErr.message); }
    }

    return makeActionResult({
      reply: synthesis, hasObsidianNote: true, obsidianNote: note, actionData: parsedAction,
      hasVoice: Boolean(voiceFile), voiceFile, fullHistoryText: `${synthesis}\n[Nota leída de Obsidian Vault: ${note.fileName || parsedAction.title}]`,
    });
  }

  // ------------------- BÚSQUEDA CONCEPTUAL Y PANORÁMICA -------------------
  if (action === 'SEARCH_OBSIDIAN_NOTES') {
    const rawQ = (parsedAction.query || '').trim();
    const normQ = rawQ.toLowerCase();
    const GENERIC_KEYWORDS = ['reporte', 'resumen', 'notas', 'todas', 'todo', 'general', 'lista', 'listado', 'boveda', 'bóveda', 'segundo cerebro', 'obsidian'];
    const isPanoramic = !rawQ || GENERIC_KEYWORDS.includes(normQ);
    const isConceptual = !isPanoramic && (
      /(\b(?:qué|que|cómo|como|cuál|cual|cuáles|cuales|dónde|donde|por qué|porque|quién|quien|cuánto|cuanto)\b|\?)/i.test(normQ) ||
      normQ.split(/\s+/).filter(Boolean).length >= 3
    );

    if (isConceptual && typeof deps.obsidianService.searchNotesSemantic === 'function') {
      let semanticChunks = [];
      try {
        semanticChunks = await deps.obsidianService.searchNotesSemantic({
          query: parsedAction.query, embeddingService: deps.embeddingService, limit: parsedAction.maxResults || 5,
        });
      } catch (err) { console.warn('[Brain Obsidian] Error en búsqueda semántica:', err.message); }

      const isSemanticResult = Array.isArray(semanticChunks) && semanticChunks.length > 0 &&
        (semanticChunks[0].category === 'OBSIDIAN' || semanticChunks[0].similarity !== undefined);

      if (isSemanticResult) {
        const dataSummary = semanticChunks.map((chunk, i) => {
          const meta = typeof chunk.metadata === 'string' ? JSON.parse(chunk.metadata) : (chunk.metadata || {});
          const title = meta.cleanTitle || meta.fileName || 'Nota';
          const folder = meta.folderPath ? ` (${meta.folderPath})` : '';
          const sim = chunk.similarity !== undefined ? ` [Similitud: ${(chunk.similarity * 100).toFixed(0)}%]` : '';
          return `[Fragmento ${i + 1} de Nota: "${title}"${folder}${sim}]\n${chunk.content}`;
        }).join('\n\n');

        const userText = context?.userText || parsedAction.query;
        const reply = await synthesizeToolResults(deps, {
          userText,
          toolName: 'Obsidian Vault (Búsqueda Conceptual Semántica)',
          dataSummary: `Sebastián preguntó sobre el contenido de su Obsidian Vault: "${userText}".\nSe recuperaron los siguientes fragmentos conceptuales reales de sus notas:\n\n${dataSummary}\n\nInstrucción: Responde directamente a lo que Sebastián preguntó explicando la respuesta conceptual y citando con claridad el nombre de la nota fuente.`,
          context,
        });

        return makeActionResult({
          reply, actionData: parsedAction, hasObsidianNotes: true, obsidianNotes: semanticChunks,
          fullHistoryText: `${reply}\n[Búsqueda conceptual en Obsidian: "${parsedAction.query}" -> ${semanticChunks.length} fragmentos recuperados]`,
        });
      }
    }

    let notes = [], searchErr = null;
    try {
      notes = await deps.obsidianService.searchNotes({
        query: parsedAction.query, folder: parsedAction.folder, maxResults: parsedAction.maxResults || 20,
      });
    } catch (err) {
      console.error('[Brain Obsidian] Error buscando notas en Drive:', err.message);
      searchErr = err.message;
    }

    let reply = '';
    if (searchErr) {
      reply = `Mira Sebastián querido, no pude consultar tus notas de Obsidian en este momento debido a un detalle de conexión con Google Drive: ${searchErr}.`;
    } else if (notes.length === 0) {
      reply = `Sebastián querido, ya revisé directamente en tu Obsidian Vault y no encontré notas${parsedAction.query ? ` con el término "${parsedAction.query}"` : ''}. Si deseas, indícame en qué carpeta buscar o te la creo de inmediato.`;
    } else if (isPanoramic) {
      const groups = {};
      for (const note of notes) {
        let cat = 'General';
        const fp = (note.folderPath || note.relativePath || '').toLowerCase();
        if (fp.includes('project') || fp.includes('proyecto') || fp.includes('02_')) cat = 'Proyectos';
        else if (fp.includes('inbox') || fp.includes('01_')) cat = 'Inbox';
        else if (fp.includes('area') || fp.includes('área') || fp.includes('03_')) cat = 'Áreas';
        else if (fp.includes('meta') || fp.includes('00_')) cat = 'Meta';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(note.cleanTitle || note.name.replace(/\.md$/i, ''));
      }

      const formatList = (arr) => {
        if (!arr || arr.length === 0) return '';
        if (arr.length === 1) return arr[0];
        if (arr.length === 2) return `${arr[0]} y ${arr[1]}`;
        return `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}`;
      };

      const parts = ['Proyectos', 'Inbox', 'Áreas', 'Meta']
        .filter((cat) => groups[cat]?.length)
        .map((cat) => `en ${cat} tienes ${formatList(groups[cat].slice(0, 3))}`);
      if (groups['General']?.length && parts.length === 0) {
        parts.push(`tienes ${formatList(groups['General'].slice(0, 5))}`);
      }

      const breakdown = parts.length > 0 ? parts.join('; ') + '.' : `${notes.slice(0, 5).map((n) => n.cleanTitle || n.name.replace(/\.md$/i, '')).join(', ')}.`;
      reply = `Sebastián querido, ya revisé a fondo tu Obsidian Vault y tienes activas ${notes.length} notas. ${breakdown.charAt(0).toUpperCase() + breakdown.slice(1)} ¿Deseas que profundice en alguna en particular?`;
    } else {
      const titulos = notes.slice(0, 5).map((f) => {
        const base = f.cleanTitle || f.name.replace(/\.md$/i, '');
        return f.folderPath ? `${base} (${f.folderPath})` : base;
      }).join(', ');
      reply = `Sebastián querido, ya te encontré ${notes.length} nota(s) en tu Obsidian: ${titulos}. ¿Deseas que te lea alguna de ellas o te prepare un resumen ejecutivo?`;
    }

    return makeActionResult({
      reply, actionData: parsedAction, hasObsidianNotes: notes.length > 0, obsidianNotes: notes,
      fullHistoryText: `${reply}\n[Búsqueda en Obsidian Vault: "${parsedAction.query || ''}" -> ${notes.length} notas encontradas]`,
    });
  }

  // ------------------- SINCRONIZACIÓN RAG -------------------
  if (action === 'SYNC_OBSIDIAN_VAULT') {
    try {
      const syncResult = await deps.obsidianService.syncVaultToVector({
        embeddingService: deps.embeddingService,
        force: parsedAction.force,
      });

      const reply = `Sebastián querido, he completado la sincronización de tu bóveda de Obsidian con mi memoria semántica. Procesé con éxito ${syncResult.totalIndexed} notas y generé ${syncResult.totalChunks} fragmentos conceptuales. Ahora tengo presente todo tu conocimiento sobre tus proyectos, modelos y directivas.`;

      return makeActionResult({
        reply, actionData: parsedAction, syncResult,
        fullHistoryText: `${reply}\n[Sincronización Obsidian RAG: ${syncResult.totalIndexed} notas, ${syncResult.totalChunks} chunks]`,
      });
    } catch (err) {
      console.error('[Brain Obsidian] Error en sincronización masiva:', err.message);
      return makeActionResult({
        reply: `⚠️ Sebastián querido, ocurrió un inconveniente durante la sincronización de tu bóveda: ${err.message}`,
        actionData: parsedAction,
      });
    }
  }

  return makeActionResult({ reply: cleanText });
}

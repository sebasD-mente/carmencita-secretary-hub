import { makeActionResult, synthesizeToolResults } from './index.js';

/**
 * Módulo de Herramientas de Documentos, Ideas y Memoria Semántica.
 */
export async function handleDocumentsAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

  if (action === 'SAVE_IDEA') {
    if (deps.ideaService && typeof deps.ideaService.createIdea === 'function') {
      await deps.ideaService.createIdea({
        title: parsedAction.title,
        summary: parsedAction.summary,
        priority: parsedAction.priority,
        tags: parsedAction.tags,
        rawText: cleanText,
      });
    }
    return makeActionResult({ reply: cleanText, actionData: parsedAction });
  }

  if (action === 'SAVE_MEMORY') {
    if (deps.embeddingService && typeof deps.embeddingService.saveMemory === 'function') {
      await deps.embeddingService.saveMemory({
        content: parsedAction.content,
        category: parsedAction.category,
      });
    }
    return makeActionResult({
      reply: cleanText,
      actionData: parsedAction,
      hasMemory: true,
      fullHistoryText: `${cleanText}\n[Memoria guardada en bóveda semántica: "${parsedAction.content}"]`,
    });
  }

  if (action === 'SEARCH_DOCUMENTS') {
    if (!deps.documentService) {
      return makeActionResult({
        reply: '⚠️ Sebastián querido, el servicio de documentos no está disponible en este momento.',
        actionData: parsedAction,
      });
    }

    let results = [];
    let docErr = null;
    try {
      if (typeof deps.documentService.searchDocumentsSemantic === 'function') {
        results = await deps.documentService.searchDocumentsSemantic({
          query: parsedAction.query,
          category: parsedAction.category,
          limit: parsedAction.limit || 5,
        });
      }
    } catch (err) {
      console.error('[Brain Document] Error buscando documentos:', err.message);
      docErr = err.message;
    }

    let reply = '';
    if (docErr) {
      reply = `⚠️ Sebastián querido, ocurrió un inconveniente al consultar tu bóveda de documentos: ${docErr}`;
    } else if (!results || results.length === 0) {
      reply = `Sebastián querido, busqué en tu bóveda de documentos y facturas sobre "${parsedAction.query}" pero no encontré registros coincidentes.`;
    } else {
      const resumen = results.map((r, i) => {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        const docName = meta.originalName || meta.fileName || r.fileName || r.originalName || 'Documento';
        const vendor = meta.vendor ? ` | Proveedor: ${meta.vendor}` : (r.invoice?.vendor ? ` | Proveedor: ${r.invoice.vendor}` : '');
        const total = meta.totalAmount ? ` | Monto: GTQ ${meta.totalAmount}` : (r.invoice?.totalAmount ? ` | Monto: ${r.invoice.currency || 'GTQ'} ${r.invoice.totalAmount}` : '');
        const sim = r.similarity !== undefined ? ` (Relevancia: ${(r.similarity * 100).toFixed(0)}%)` : '';
        const body = r.content || r.summary || '';
        return `[Documento ${i + 1}] ${docName}${vendor}${total}${sim}\nDetalle: ${body}`;
      }).join('\n\n');

      const contextUserText = context?.userText || parsedAction.query;
      reply = await synthesizeToolResults(deps, {
        userText: contextUserText,
        toolName: 'Bóveda Documental y Facturas',
        dataSummary: `Sebastián te pidió: "${contextUserText}". Buscaste en su bóveda de documentos y facturas y encontraste lo siguiente:\n\n${resumen}\n\nInstrucción: Explica con claridad ejecutiva qué documentos o facturas corresponden a su consulta...`,
        context,
      });
    }

    return makeActionResult({
      reply,
      hasDocument: Boolean(results && results.length > 0),
      hasDocuments: Boolean(results && results.length > 0),
      documents: results,
      actionData: parsedAction,
      fullHistoryText: `${reply}\n[Búsqueda en Bóveda Documental: "${parsedAction.query}" -> ${results?.length || 0} coincidencias]`,
    });
  }

  return makeActionResult({ reply: cleanText });
}

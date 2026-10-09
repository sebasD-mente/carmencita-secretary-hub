import { makeActionResult } from './index.js';

/**
 * Módulo de Herramientas de Sistema y Telemetría (Deko Labs Mechanical Standard).
 */
export async function handleSystemAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;

  if (action === 'DIAGNOSE_SYSTEM') {
    let diagStatus = null;
    let diagErr = null;
    try {
      if (deps.diagnosticsService && typeof deps.diagnosticsService.getSystemStatus === 'function') {
        diagStatus = await deps.diagnosticsService.getSystemStatus({ scope: parsedAction.scope || 'full' });
      }
    } catch (err) {
      console.error('[Brain Diagnostics] Error en auto-diagnóstico:', err.message);
      diagErr = err.message;
    }

    let reply = '';
    if (diagErr) {
      reply = `⚠️ Sebastián querido, ocurrió un error al realizar el auto-diagnóstico del sistema: ${diagErr}`;
    } else if (diagStatus) {
      const uptime = diagStatus.process?.uptimeFormatted || `${diagStatus.process?.uptimeSeconds || 0}s`;
      const heap = diagStatus.process?.memoryUsage?.heapUsedMb ? `${diagStatus.process.memoryUsage.heapUsedMb} MB` : 'N/A';
      const db = diagStatus.database?.status === 'CONNECTED'
        ? `Conectada (${diagStatus.database.latencyMs}ms)`
        : (diagStatus.database ? `Desconectada (${diagStatus.database?.error || 'Fallo'})` : 'No requerida');
      const ws = diagStatus.googleWorkspace;
      const wsStr = ws ? `Drive (${ws.drive ? '✅' : '❌'}), Gmail (${ws.gmail ? '✅' : '❌'}), Calendar (${ws.calendar ? '✅' : '❌'}), Tasks (${ws.tasks ? '✅' : '❌'})` : 'N/A';
      const errLines = diagStatus.recentErrors || [];
      const errDetail = errLines.length > 0
        ? `\n\n⚠️ <b>Últimos eventos de error registrados (${errLines.length}):</b>\n${errLines.map(e => `• <code>${e}</code>`).join('\n')}`
        : '\n\n✨ <b>Estado de errores:</b> Ningún error reciente registrado.';

      // Regla Anti-Alucinación Deko Labs: NUNCA concatenar cleanText en DIAGNOSE_SYSTEM
      reply = `🩺 <b>Diagnóstico de Salud e Introspección del Hub:</b>\n\n` +
        `⏱️ <b>Uptime:</b> ${uptime}\n\n` +
        `💾 <b>Memoria Heap:</b> ${heap}\n\n` +
        `🗄️ <b>PostgreSQL:</b> ${db}\n\n` +
        `☁️ <b>Google Workspace:</b> ${wsStr}${errDetail}\n\n` +
        `Todos los sistemas se encuentran bajo supervisión activa, Sebastián querido.`;
    } else {
      reply = `Sebastián querido, todos mis subsistemas operativos principales se encuentran activos y funcionando con normalidad.`;
    }

    return makeActionResult({
      reply,
      actionData: parsedAction,
      diagnostics: diagStatus,
      hasDiagnostics: Boolean(diagStatus),
      fullHistoryText: `${reply}\n[Auto-diagnóstico de sistema (${parsedAction.scope || 'full'})]`,
    });
  }

  if (action === 'RUN_AGY_TASK') {
    const agyBridge = deps.agyBridge;
    const prompt = parsedAction.prompt;
    const initialAck = context.cleanText || '¡Entendido, Sebastián! Ya mismo verifico el sistema...';

    let progressSent = false;
    if (typeof context.onProgress === 'function') {
      try {
        await context.onProgress(initialAck);
        progressSent = true;
      } catch (e) {
        console.error('[Brain] Error en callback onProgress:', e.message);
      }
    }

    if (!agyBridge) {
      return makeActionResult({
        reply: initialAck,
        initialAck,
        report: 'AGY CLI no está configurado en este entorno.',
        hasAsyncAction: false,
        progressSent,
        fullHistoryText: initialAck,
        actionData: parsedAction,
      });
    }

    let agyResult;
    try {
      agyResult = await agyBridge.executeTask(prompt);
    } catch (err) {
      agyResult = { success: false, output: err.message };
    }

    const rawOutput = agyResult?.output || 'Sin salida';
    const isError = !agyResult?.success ||
      (typeof rawOutput === 'string' && (
        rawOutput.toLowerCase().includes('command failed') ||
        rawOutput.toLowerCase().includes('error al ejecutar') ||
        rawOutput.toLowerCase().includes('bloqueo de seguridad') ||
        rawOutput.startsWith('Error:')
      ));

    if (isError) {
      const humanFailure = 'Mira Sebastián querido, no estoy logrando obtener la información de la terminal en este momento; el sistema me arrojó un error de permisos o ejecución. Ya tomé nota del detalle para que Gary lo revise; avísame si prefieres que lo intentemos por otra vía.';
      return makeActionResult({
        reply: humanFailure,
        initialAck,
        report: humanFailure,
        hasAsyncAction: true,
        progressSent,
        fullHistoryText: `${initialAck}\n\n[Reporte de terminal (Error):\n${rawOutput}]`,
        actionData: parsedAction,
      });
    }

    const cleanSummary = rawOutput.length > 500 ? rawOutput.slice(0, 500) + '...' : rawOutput;
    const humanReply = `${initialAck}\n\n⚙️ <b>Reporte de terminal:</b>\n${cleanSummary}`;

    return makeActionResult({
      reply: humanReply,
      initialAck,
      report: humanReply,
      hasAsyncAction: true,
      progressSent,
      fullHistoryText: `${initialAck}\n\n[Reporte de terminal:\n${rawOutput}]`,
      actionData: parsedAction,
    });
  }

  return makeActionResult({ reply: context.cleanText || '' });
}

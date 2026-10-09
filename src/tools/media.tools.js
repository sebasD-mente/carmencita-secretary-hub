import { makeActionResult } from './index.js';

/**
 * Módulo de Herramientas Multimedia y Archivos (QR, Audio, Fotos, Hojas de Cálculo).
 */
export async function handleMediaAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

  if (action === 'GENERATE_QR') {
    let qrResult = null;
    try {
      if (deps.mediaService && typeof deps.mediaService.generateQrCode === 'function') {
        qrResult = await deps.mediaService.generateQrCode({
          text: parsedAction.text,
          title: parsedAction.title || 'Código QR',
        });
      }
    } catch (err) {
      console.error('[Brain Media] Error generando QR:', err.message);
    }

    const replyText = cleanText || `Aquí tienes listo tu código QR para **${parsedAction.title || 'el enlace'}**, Sebastián.`;
    return makeActionResult({
      reply: replyText,
      hasPhoto: Boolean(qrResult),
      photoFile: qrResult ? { path: qrResult.filePath, buffer: qrResult.buffer, caption: parsedAction.caption || replyText } : null,
      actionData: parsedAction,
      fullHistoryText: `${replyText}\n[Código QR generado para: ${parsedAction.text}]`,
    });
  }

  if (action === 'SEND_MEDIA') {
    let media = null;
    if (parsedAction.mediaType === 'PROFILE' || parsedAction.mediaType === 'AVATAR') {
      if (deps.mediaService && typeof deps.mediaService.resolveProfilePicture === 'function') {
        media = deps.mediaService.resolveProfilePicture();
      }
    }

    const replyText = cleanText || 'Aquí tienes mi fotografía oficial de perfil, Sebastián. Siempre a tu completa disposición.';
    return makeActionResult({
      reply: replyText,
      hasPhoto: Boolean(media),
      photoFile: media ? { path: media.filePath, caption: parsedAction.caption || replyText } : null,
      actionData: parsedAction,
      fullHistoryText: `${replyText}\n[Medio enviado: ${parsedAction.mediaType}]`,
    });
  }

  if (action === 'SEND_VOICE') {
    let voiceResult = null;
    try {
      if (deps.voiceService && typeof deps.voiceService.synthesizeSpeech === 'function') {
        voiceResult = await deps.voiceService.synthesizeSpeech(parsedAction.message || cleanText);
      }
    } catch (err) {
      console.error('[Brain Media] Error sintetizando voz on-demand:', err.message);
    }

    return makeActionResult({
      reply: cleanText,
      hasVoice: Boolean(voiceResult),
      voiceFile: voiceResult,
      actionData: parsedAction,
      fullHistoryText: `${cleanText}\n[Nota de voz enviada]`,
    });
  }

  if (action === 'GENERATE_EXCEL') {
    let excelFile = null;
    if (deps.excelService && typeof deps.excelService.generateExcelFile === 'function') {
      excelFile = await deps.excelService.generateExcelFile({
        title: parsedAction.title,
        sheetName: parsedAction.sheetName,
        columns: parsedAction.columns,
        rows: parsedAction.rows,
        summary: parsedAction.summary,
      });
    }

    const reply = cleanText || `📊 He generado la hoja de cálculo: **${excelFile?.fileName || 'documento.xlsx'}**`;
    return makeActionResult({
      reply,
      hasExcel: Boolean(excelFile),
      excelFile,
      fullHistoryText: `${cleanText}\n[Archivo Excel generado: ${excelFile?.fileName || 'documento.xlsx'}]`,
      actionData: parsedAction,
    });
  }

  return makeActionResult({ reply: cleanText });
}

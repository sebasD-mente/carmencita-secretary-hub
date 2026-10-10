import { makeActionResult } from '../index.js';

export async function handleGmailAction(parsedAction, deps, context = {}) {
  const cleanText = context.cleanText || '';
  const maxResults = parsedAction.maxResults || 5;
  const isSpecificQuery = Boolean(parsedAction.query && parsedAction.query.trim());
  const onlyImportant = isSpecificQuery ? (parsedAction.onlyImportant === true) : true;
  let emails = [], emailError = null, emailDetail = null;

  const userText = context.userText || '';
  const isExplicitSingle = Boolean(
    parsedAction.readSingle === true || parsedAction.maxResults === 1 ||
    /(?:leer|escuchar|abrir|detalle(?:\s+del)?|resumen(?:\s+en\s+audio)?\s+del?)\s+(?:el|este|un|ese)\s+(?:correo|email|mensaje)/i.test(userText) ||
    /del\s+correo\s+de\b/i.test(userText) || /\b(?:el|este)\s+correo\s+(?:de|con|sobre)\b/i.test(userText)
  );

  const eventTermsRegex = /\b(?:evento|fechas?|entradas?|tickets?|confirmaci[oó]n|cu[aá]ndo|devfest|agendas?|citas?|calendarios?)\b/i;
  const isEventQuery = eventTermsRegex.test(`${userText} ${parsedAction.query || ''}`);

  if (deps.gmailService) {
    try {
      emails = typeof deps.gmailService.searchEmails === 'function'
        ? await deps.gmailService.searchEmails({ query: parsedAction.query || '', maxResults, onlyImportant, includeRead: isSpecificQuery })
        : (typeof deps.gmailService.getUnreadInboxMessages === 'function' ? await deps.gmailService.getUnreadInboxMessages({ maxResults, query: parsedAction.query, onlyImportant }) : []);

      if (emails.length > 0 && (isExplicitSingle || isEventQuery) && typeof deps.gmailService.getEmailDetails === 'function') {
        try {
          emailDetail = await deps.gmailService.getEmailDetails({ messageId: emails[0].id });
        } catch (detErr) {
          console.warn('[Brain Gmail] No se pudo obtener detalle del correo:', detErr.message);
        }
      }
    } catch (err) {
      console.error('[Brain] Error consultando Gmail:', err.message);
      emailError = err.message;
    }
  }

  let emailReply = '';
  if (!deps.gmailService) {
    emailReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ Servicio de Gmail no configurado.`;
  } else if (emailError) {
    emailReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude consultar tu bandeja de Gmail: ${emailError}`;
  } else if (emails.length === 0) {
    emailReply = `${cleanText ? cleanText + '\n\n' : ''}✉️ <b>Bandeja de Gmail:</b>\n\n• ¡Bandeja limpia! No tienes correos pendientes sin leer.`;
  } else if (emailDetail && isExplicitSingle && !isEventQuery) {
    const fromClean = emailDetail.from ? emailDetail.from.replace(/<[^>]+>/, '').trim() : 'Remitente';
    const bodySnippet = emailDetail.bodyText ? emailDetail.bodyText.slice(0, 500).replace(/\s+/g, ' ') : (emailDetail.snippet || '');
    emailReply = `Sebastián querido, aquí tengo el correo de ${fromClean} con asunto "${emailDetail.subject}":\n\n📌 <b>Resumen Ejecutivo:</b>\n${bodySnippet}${emailDetail.bodyText && emailDetail.bodyText.length > 500 ? '...' : ''}\n\n¿Deseas que prepare una respuesta o realice alguna acción con este correo?`;
  } else {
    const list = emails.map((em, i) => `${i + 1}. ✉️ <b>${em.from || 'Remitente'}</b>: "${em.subject || 'Sin asunto'}"\n   <i>${em.snippet || ''}</i>`).join('\n\n');
    emailReply = `${cleanText ? cleanText + '\n\n' : ''}✉️ <b>Bandeja de Gmail (${emails.length} correos):</b>\n\n${list}`;
  }

  let voiceFile = null;
  const wantsVoice = Boolean(context?.isAudio || (context?.userText && /audio|voz|escuchar|nota de voz|resumen en audio/i.test(context.userText)));
  if (wantsVoice && deps.voiceService && typeof deps.voiceService.synthesizeSpeech === 'function') {
    try { voiceFile = await deps.voiceService.synthesizeSpeech(emailReply); }
    catch (vErr) { console.warn('[Brain Gmail Voice] Error sintetizando audio:', vErr.message); }
  }

  return Object.assign(makeActionResult({
    reply: emailReply, actionData: parsedAction, gmailEmails: emails,
    hasGmailEmails: emails.length > 0, hasVoice: Boolean(voiceFile), voiceFile,
    fullHistoryText: `${emailReply}\n[Bandeja de Gmail consultada: ${emails.length} correos pendientes]`,
  }), { data: { emails, query: parsedAction.query || '', count: emails.length } });
}

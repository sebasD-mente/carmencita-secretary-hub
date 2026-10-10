import { makeActionResult } from '../index.js';

export function formatEventDates(ev) {
  const isAllDay = ev.isAllDay || (typeof ev.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.start));
  if (isAllDay) {
    const [y, m, d] = (ev.start || '').split('T')[0].split('-').map(Number);
    const dObj = new Date(y, m - 1, d);
    const day = dObj.toLocaleDateString('es-GT', { weekday: 'short' }), month = dObj.toLocaleDateString('es-GT', { month: 'short' });
    return { summary: `${day}, ${d} ${month} (Todo el día)`, fallback: `📅 <b>${day}, ${d} ${month}</b> | ⏰ <i>Todo el día</i>` };
  }

  const dStart = new Date(ev.start);
  const dEnd = ev.end ? new Date(ev.end) : null;
  if (!isNaN(dStart.getTime())) {
    const tz = 'America/Guatemala';
    const dayStart = dStart.toLocaleDateString('es-GT', { weekday: 'short', timeZone: tz });
    const numStart = dStart.toLocaleDateString('es-GT', { day: 'numeric', timeZone: tz });
    const monthStart = dStart.toLocaleDateString('es-GT', { month: 'short', timeZone: tz });
    const timeStart = dStart.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz });

    if (dEnd && !isNaN(dEnd.getTime())) {
      const dayEnd = dEnd.toLocaleDateString('es-GT', { weekday: 'short', timeZone: tz });
      const numEnd = dEnd.toLocaleDateString('es-GT', { day: 'numeric', timeZone: tz });
      const monthEnd = dEnd.toLocaleDateString('es-GT', { month: 'short', timeZone: tz });
      const timeEnd = dEnd.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz });

      if (numStart === numEnd && monthStart === monthEnd) {
        return {
          summary: `${dayStart}, ${numStart} ${monthStart} de ${timeStart} a ${timeEnd}`,
          fallback: `📅 <b>${dayStart}, ${numStart} ${monthStart}</b> | ⏰ <b>${timeStart} - ${timeEnd}</b>`
        };
      }
      return {
        summary: `del ${dayStart}, ${numStart} ${monthStart} (${timeStart}) al ${dayEnd}, ${numEnd} ${monthEnd} (${timeEnd})`,
        fallback: `📅 <b>${dayStart} ${numStart} ${monthStart} (${timeStart}) ➔ ${dayEnd} ${numEnd} ${monthEnd} (${timeEnd})</b>`
      };
    }
    return { summary: `${dayStart}, ${numStart} ${monthStart} a las ${timeStart}`, fallback: `📅 <b>${dayStart}, ${numStart} ${monthStart}</b> | ⏰ <b>${timeStart}</b>` };
  }
  return { summary: String(ev.start), fallback: `⏰ <b>${ev.start}</b>` };
}

export async function handleCalendarAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

  if (action === 'CREATE_CALENDAR_EVENT') {
    let eventResult = null, errorMsg = null;
    try {
      if (deps.calendarService?.createEvent) {
        eventResult = await deps.calendarService.createEvent({
          summary: parsedAction.summary, description: parsedAction.description,
          startDateTime: parsedAction.startDateTime, endDateTime: parsedAction.endDateTime,
          location: parsedAction.location, checkExisting: true,
        });
      }
    } catch (calErr) {
      console.error('[Brain Calendar] Error agendando en Google Calendar:', calErr.message);
      errorMsg = calErr.message;
    }

    const link = eventResult?.htmlLink || 'https://calendar.google.com';
    const calendarReply = eventResult?.alreadyExisted
      ? `${cleanText ? cleanText + '\n\n' : ''}📅 <b>¡El espacio ya se encuentra reservado en tu Google Calendar!</b>\n\n📌 <b>Evento:</b> ${eventResult.summary}\n⏰ <b>Fecha/Hora:</b> ${eventResult.start}\n${eventResult.location ? `📍 <b>Ubicación:</b> ${eventResult.location}\n` : ''}🔗 <a href="${link}">Ver evento en Google Calendar</a>`
      : (eventResult
        ? `${cleanText ? cleanText + '\n\n' : ''}📅 <b>¡Cita agendada en tu Google Calendar!</b>\n\n📌 <b>Evento:</b> ${eventResult.summary}\n⏰ <b>Inicio:</b> ${eventResult.start}\n${eventResult.end ? `🏁 <b>Fin:</b> ${eventResult.end}\n` : ''}${parsedAction.location ? `📍 <b>Ubicación:</b> ${parsedAction.location}\n` : ''}🔗 <a href="${link}">Ver evento en Google Calendar</a>`
        : `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude sincronizar con Google Calendar (${errorMsg || 'Servicio no disponible'}).`);

    return Object.assign(makeActionResult({
      reply: calendarReply,
      hasCalendarEvent: Boolean(eventResult),
      calendarEvent: eventResult,
      actionData: parsedAction,
      fullHistoryText: `${cleanText}\n[Evento ${eventResult?.alreadyExisted ? 'ya existente' : 'agendado'} en Google Calendar: ${parsedAction.summary} (${link})]`,
    }), { data: { event: eventResult, link } });
  }

  if (action === 'LIST_CALENDAR_EVENTS') {
    const range = parsedAction.range || 'TODAY';
    let events = [], rangeLabel = 'de Hoy';
    if (deps.calendarService) {
      try {
        if (range === 'THIS_MONTH' || parsedAction.month) {
          rangeLabel = 'del Mes';
          let targetMonth = null;
          if (parsedAction.month) {
            const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
            const mStr = String(parsedAction.month).toLowerCase().trim();
            const foundIdx = months.findIndex((m) => mStr.includes(m));
            targetMonth = foundIdx !== -1 ? foundIdx : (!isNaN(parseInt(mStr, 10)) ? parseInt(mStr, 10) - 1 : null);
          }
          if (typeof deps.calendarService.getMonthEvents === 'function') {
            events = await deps.calendarService.getMonthEvents({ month: targetMonth, excludeBirthdays: !parsedAction.includeBirthdays });
          }
        } else if (range === 'TOMORROW' && typeof deps.calendarService.getTomorrowEvents === 'function') {
          rangeLabel = 'de Mañana';
          events = await deps.calendarService.getTomorrowEvents({ excludeBirthdays: !parsedAction.includeBirthdays });
        } else if (range === 'UPCOMING' && typeof deps.calendarService.listUpcomingEvents === 'function') {
          rangeLabel = 'Próximas Citas';
          events = await deps.calendarService.listUpcomingEvents({ maxResults: 10, excludeBirthdays: !parsedAction.includeBirthdays });
        } else if (typeof deps.calendarService.getTodayEvents === 'function') {
          events = await deps.calendarService.getTodayEvents({ excludeBirthdays: !parsedAction.includeBirthdays });
        }
      } catch (err) { console.error('[Brain Calendar] Error listando eventos del calendario:', err.message); }
    }

    const fallbackList = events.map((ev, i) =>
      `${i + 1}. ${formatEventDates(ev).fallback} - <b>${ev.summary}</b>${ev.location ? ` | 📍 <i>${ev.location}</i>` : ''}${ev.htmlLink ? ` (<a href="${ev.htmlLink}">Ver</a>)` : ''}`
    ).join('\n');

    const reply = events.length === 0
      ? `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel}):</b>\n\n• No tienes citas agendadas. ¡Tiempo despejado para enfocarte!`
      : `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel} - ${events.length} citas):</b>\n\n${fallbackList}`;

    return Object.assign(makeActionResult({
      reply, actionData: parsedAction, calendarEvents: events,
      fullHistoryText: `${cleanText}\n[Agenda consultada (${rangeLabel}): ${events.length} citas]`,
    }), { data: { events, rangeLabel } });
  }

  if (action === 'RESCHEDULE_CALENDAR_EVENT' || action === 'CANCEL_CALENDAR_EVENT') {
    if (!deps.calendarService) {
      return makeActionResult({ reply: '⚠️ Sebastián querido, el servicio de Google Calendar no está configurado en este entorno.', actionData: parsedAction });
    }
    const isReschedule = action === 'RESCHEDULE_CALENDAR_EVENT';
    let eventResult = null, errorMsg = null;
    try {
      eventResult = isReschedule
        ? await deps.calendarService.rescheduleEvent?.({ eventId: parsedAction.eventId, query: parsedAction.query, newStartDateTime: parsedAction.newStartDateTime, newEndDateTime: parsedAction.newEndDateTime })
        : await deps.calendarService.cancelEvent?.({ eventId: parsedAction.eventId, query: parsedAction.query });
    } catch (calErr) {
      console.error(`[Brain Calendar] Error ${isReschedule ? 'reprogramando' : 'cancelando'} en Google Calendar:`, calErr.message);
      errorMsg = calErr.message;
    }

    const calendarReply = eventResult
      ? (isReschedule
        ? (cleanText || `📅 <b>¡Cita reprogramada en tu Google Calendar!</b>\n\n📌 <b>Evento:</b> ${eventResult.summary}\n⏰ <b>Nueva Hora:</b> ${eventResult.start}\n${eventResult.end ? `🏁 <b>Fin:</b> ${eventResult.end}\n` : ''}🔗 <a href="${eventResult.htmlLink || 'https://calendar.google.com'}">Ver evento en Google Calendar</a>`)
        : (cleanText || `¡Listo mi Sebastián querido! He cancelado la cita "${parsedAction.query || parsedAction.eventId}" en tu Google Calendar.`))
      : `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude ${isReschedule ? 'reprogramar la' : 'cancelar la'} cita en Google Calendar (${errorMsg || 'Servicio no disponible'}).`;

    return Object.assign(makeActionResult({
      reply: calendarReply,
      hasCalendarEvent: Boolean(eventResult),
      calendarEvent: isReschedule ? eventResult : null,
      actionData: parsedAction,
      fullHistoryText: `${calendarReply}\n[Evento ${isReschedule ? 'reprogramado' : 'cancelado'} en Google Calendar: ${eventResult?.summary || parsedAction.query || parsedAction.eventId}]`,
    }), { data: { result: eventResult, isReschedule } });
  }

  return makeActionResult({ reply: cleanText });
}

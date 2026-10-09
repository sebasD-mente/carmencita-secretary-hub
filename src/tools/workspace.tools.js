import { makeActionResult, synthesizeToolResults } from './index.js';

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

      // Si inicia y termina el mismo día
      if (numStart === numEnd && monthStart === monthEnd) {
        return {
          summary: `${dayStart}, ${numStart} ${monthStart} de ${timeStart} a ${timeEnd}`,
          fallback: `📅 <b>${dayStart}, ${numStart} ${monthStart}</b> | ⏰ <b>${timeStart} - ${timeEnd}</b>`
        };
      }
      // Multi-día (ej: sábado 17 a domingo 18)
      return {
        summary: `del ${dayStart}, ${numStart} ${monthStart} (${timeStart}) al ${dayEnd}, ${numEnd} ${monthEnd} (${timeEnd})`,
        fallback: `📅 <b>${dayStart} ${numStart} ${monthStart} (${timeStart}) ➔ ${dayEnd} ${numEnd} ${monthEnd} (${timeEnd})</b>`
      };
    }
    return { summary: `${dayStart}, ${numStart} ${monthStart} a las ${timeStart}`, fallback: `📅 <b>${dayStart}, ${numStart} ${monthStart}</b> | ⏰ <b>${timeStart}</b>` };
  }
  return { summary: String(ev.start), fallback: `⏰ <b>${ev.start}</b>` };
}

/**
 * Módulo de Herramientas de Espacio de Trabajo (Gmail, Google Calendar, Tareas y Contactos).
 */
export async function handleWorkspaceAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

  // ------------------- TAREAS -------------------
  if (action === 'SAVE_TASK') {
    if (deps.taskService?.createTask) {
      await deps.taskService.createTask({
        description: parsedAction.description, due: parsedAction.due,
        dueDate: parsedAction.dueDate, priority: parsedAction.priority,
      });
    }
    return makeActionResult({ reply: cleanText, actionData: parsedAction });
  }

  if (action === 'COMPLETE_TASK' || action === 'CANCEL_TASK') {
    const isComplete = action === 'COMPLETE_TASK';
    let task = null, taskErr = null;
    try {
      task = isComplete
        ? await deps.taskService?.completeTaskByNameOrId?.({ id: parsedAction.id || null, query: parsedAction.query || null })
        : await deps.taskService?.cancelTaskByNameOrId?.({ id: parsedAction.id || null, query: parsedAction.query || null });
    } catch (err) {
      console.error(`[Brain Task] Error ${isComplete ? 'completando' : 'cancelando'} tarea:`, err.message);
      taskErr = err.message;
    }

    const verb = isComplete ? 'completar' : 'cancelar', past = isComplete ? 'completada' : 'cancelada';
    const reply = taskErr ? `⚠️ Sebastián querido, ocurrió un error al intentar ${verb} la tarea: ${taskErr}`
      : (!task ? (cleanText || `Sebastián querido, no encontré ninguna tarea pendiente para ${verb} con "${parsedAction.query || parsedAction.id || 'la búsqueda'}".`)
      : (cleanText || (isComplete ? `¡Listo mi Sebastián querido! Di por concluida la tarea "${task.description}" en tu lista.` : `¡Listo, mi jefe querido! Cancelé la tarea "${task.description}" de tu lista.`)));

    return makeActionResult({
      reply, hasTask: Boolean(task), task, actionData: parsedAction,
      fullHistoryText: `${reply}\n[Tarea ${past}: ${task?.description || parsedAction.query || parsedAction.id || 'N/A'}]`,
    });
  }

  if (action === 'LIST_TASKS') {
    const statusFilter = parsedAction.status === 'TODAS' ? null : (parsedAction.status || 'PENDIENTE');
    const onlyPending = statusFilter === 'PENDIENTE';
    let tasks = [], listErr = null;
    try {
      if (deps.taskService && typeof deps.taskService.listTasks === 'function') {
        tasks = await deps.taskService.listTasks({ status: statusFilter, onlyPending, limit: parsedAction.limit || 20 });
      }
    } catch (err) {
      console.error('[Brain Task] Error listando tareas:', err.message);
      listErr = err.message;
    }

    let reply = '';
    if (listErr) {
      reply = `⚠️ Sebastián querido, ocurrió un detalle al consultar tus tareas: ${listErr}`;
    } else if (tasks.length === 0) {
      reply = cleanText || `Sebastián querido, no tienes tareas registradas${statusFilter ? ` con estado ${statusFilter.toLowerCase()}` : ''}. ¡Todo al día y en orden!`;
    } else {
      const dataSummary = tasks.map((t, i) =>
        `[Tarea ${i + 1}] ID: ${t.id} | Estado: ${t.status} | Descripción: ${t.description} | Prioridad: ${t.priority || 'MEDIA'}${t.dueDate ? ` | Vencimiento: ${t.dueDate}` : ''}`
      ).join('\n');

      if (deps.ai || deps.synthesizeToolResults || deps.brain?._synthesizeToolResults) {
        reply = await synthesizeToolResults(deps, {
          userText: context.userText || 'Consultar tareas',
          toolName: 'Gestor de Tareas',
          dataSummary,
          context,
        });
      } else {
        const list = tasks.map((t, i) => `${i + 1}. 📌 [${t.status}] **${t.description}** (Prioridad: ${t.priority || 'MEDIA'})`).join('\n');
        reply = `${cleanText ? cleanText + '\n\n' : ''}📋 **Tus tareas (${statusFilter || 'PENDIENTE'} - ${tasks.length}):**\n\n${list}`;
      }
    }

    return makeActionResult({
      reply,
      hasTask: tasks.length > 0,
      tasks,
      actionData: parsedAction,
      fullHistoryText: `${reply}\n[Tareas consultadas (${statusFilter || 'TODAS'}): ${tasks.length} encontradas]`,
    });
  }

  // ------------------- GMAIL -------------------
  if (action === 'CHECK_GMAIL') {
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
      let dataSummary = '';
      if (isEventQuery && emailDetail?.bodyText) {
        const bodyExcerpt = emailDetail.bodyText.slice(0, 1500).replace(/\s+/g, ' ');
        const first = emails[0];
        const detailedFirst = `[Correo Detallado] Asunto: ${emailDetail.subject || first.subject} | De: ${emailDetail.from || first.from} | Fecha Recibido: ${emailDetail.date || first.date} | Contenido del Correo: ${bodyExcerpt}`;
        const rest = emails.slice(1).map((em, i) => `[Correo ${i + 2}] Fecha: ${em.date} | De: ${em.from} | Asunto: ${em.subject} | Fragmento: ${em.snippet}`).join('\n');
        dataSummary = rest ? `${detailedFirst}\n${rest}` : detailedFirst;
      } else {
        dataSummary = emails.map((em, i) => `[Correo ${i + 1}] Fecha: ${em.date} | De: ${em.from} | Asunto: ${em.subject} | Fragmento: ${em.snippet}`).join('\n');
      }

      emailReply = await synthesizeToolResults(deps, {
        userText: context.userText || parsedAction.query || 'consulta de correos',
        toolName: 'Gmail',
        dataSummary,
        context,
      });
    }

    let voiceFile = null;
    const wantsVoice = Boolean(context?.isAudio || (context?.userText && /audio|voz|escuchar|nota de voz|resumen en audio/i.test(context.userText)));
    if (wantsVoice && deps.voiceService && typeof deps.voiceService.synthesizeSpeech === 'function') {
      try { voiceFile = await deps.voiceService.synthesizeSpeech(emailReply); }
      catch (vErr) { console.warn('[Brain Gmail Voice] Error sintetizando audio:', vErr.message); }
    }

    return makeActionResult({
      reply: emailReply, actionData: parsedAction, gmailEmails: emails,
      hasGmailEmails: emails.length > 0, hasVoice: Boolean(voiceFile), voiceFile,
      fullHistoryText: `${emailReply}\n[Bandeja de Gmail consultada: ${emails.length} correos pendientes]`,
    });
  }

  // ------------------- CALENDARIO -------------------
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

    return makeActionResult({
      reply: calendarReply,
      hasCalendarEvent: Boolean(eventResult),
      calendarEvent: eventResult,
      actionData: parsedAction,
      fullHistoryText: `${cleanText}\n[Evento ${eventResult?.alreadyExisted ? 'ya existente' : 'agendado'} en Google Calendar: ${parsedAction.summary} (${link})]`,
    });
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

    const hasAi = Boolean(deps.ai || deps.brain?.ai || (deps.synthesizeToolResults && !deps.brain));
    let reply = '';

    if (hasAi) {
      const dataSummary = events.length === 0
        ? `Google Calendar (${rangeLabel}): No hay citas agendadas en este periodo.`
        : events.map((ev, i) => {
            const d = formatEventDates(ev);
            return `[Cita ${i + 1}] Resumen: "${ev.summary}" | Fecha/Hora: ${d.summary}${ev.location ? ` | Ubicación: ${ev.location}` : ''}${ev.htmlLink ? ` | Enlace: ${ev.htmlLink}` : ''}`;
          }).join('\n');

      reply = await synthesizeToolResults(deps, {
        userText: context.userText || `Consulta de agenda (${rangeLabel})`,
        toolName: 'Google Calendar',
        dataSummary,
        context,
      });
    } else {
      const fallbackList = events.map((ev, i) =>
        `${i + 1}. ${formatEventDates(ev).fallback} - <b>${ev.summary}</b>${ev.location ? ` | 📍 <i>${ev.location}</i>` : ''}${ev.htmlLink ? ` (<a href="${ev.htmlLink}">Ver</a>)` : ''}`
      ).join('\n');

      reply = events.length === 0
        ? `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel}):</b>\n\n• No tienes citas agendadas. ¡Tiempo despejado para enfocarte!`
        : `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel} - ${events.length} citas):</b>\n\n${fallbackList}`;
    }

    return makeActionResult({
      reply, actionData: parsedAction, calendarEvents: events,
      fullHistoryText: `${cleanText}\n[Agenda consultada (${rangeLabel}): ${events.length} citas]`,
    });
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

    return makeActionResult({
      reply: calendarReply,
      hasCalendarEvent: Boolean(eventResult),
      calendarEvent: isReschedule ? eventResult : null,
      actionData: parsedAction,
      fullHistoryText: `${calendarReply}\n[Evento ${isReschedule ? 'reprogramado' : 'cancelado'} en Google Calendar: ${eventResult?.summary || parsedAction.query || parsedAction.eventId}]`,
    });
  }

  // ------------------- CONTACTOS -------------------
  if (action === 'SAVE_CONTACT') {
    let contact = null;
    try {
      if (deps.contactService?.createOrUpdateContact) {
        contact = await deps.contactService.createOrUpdateContact({
          name: parsedAction.name, role: parsedAction.role, phone: parsedAction.phone,
          email: parsedAction.email, company: parsedAction.company, notes: parsedAction.notes,
        });
      }
    } catch (err) { console.error('[Brain Contact] Error guardando contacto:', err.message); }

    const reply = contact
      ? `${cleanText ? cleanText + '\n\n' : ''}👤 <b>¡Contacto registrado en tu directorio!</b>\n\n🏷️ <b>Nombre:</b> ${contact.name}\n💼 <b>Cargo:</b> ${contact.role || 'No especificado'}\n🏢 <b>Empresa:</b> ${contact.company || 'Deko Labs / Particular'}\n📞 <b>Teléfono:</b> ${contact.phone ? `<code>${contact.phone}</code>` : 'No registrado'}\n✉️ <b>Email:</b> ${contact.email || 'No registrado'}\n${contact.notes ? `📝 <b>Notas:</b> ${contact.notes}\n` : ''}`
      : `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude registrar el contacto en la base de datos.`;

    return makeActionResult({ reply, actionData: parsedAction, contact, fullHistoryText: `${cleanText}\n[Contacto guardado: ${contact?.name || parsedAction.name}]` });
  }

  if (action === 'SEARCH_CONTACT') {
    let contacts = [];
    try {
      if (deps.contactService?.searchContacts) {
        contacts = await deps.contactService.searchContacts({ query: parsedAction.query });
      }
    } catch (err) { console.error('[Brain Contact] Error buscando contactos:', err.message); }

    let reply = '';
    if (contacts.length === 0) {
      reply = `${cleanText ? cleanText + '\n\n' : ''}🔍 No encontré contactos en el directorio con el término "<b>${parsedAction.query}</b>".`;
    } else {
      const hasAi = Boolean(deps.ai || deps.brain?.ai || (deps.synthesizeToolResults && !deps.brain));
      if (hasAi) {
        const dataSummary = contacts.map((c, i) => {
          const cleanPhone = c.phone ? c.phone.replace(/\D/g, '') : '';
          const links = c.phone ? ` | Teléfono: "${c.phone}" (WhatsApp: https://wa.me/${cleanPhone}, Llamar: tel:${c.phone})` : ' | Sin teléfono';
          return `[Contacto ${i + 1}] Nombre: "${c.name}"${c.role ? ` | Cargo: "${c.role}"` : ''}${c.company ? ` | Empresa: "${c.company}"` : ''}${links}${c.email ? ` | Email: "${c.email}"` : ''}${c.notes ? ` | Notas: "${c.notes}"` : ''}`;
        }).join('\n');
        reply = await synthesizeToolResults(deps, {
          userText: context.userText || `Buscar contacto "${parsedAction.query}"`,
          toolName: 'Directorio de Contactos',
          dataSummary,
          context,
        });
      } else {
        const list = contacts.map((c, i) => {
          const role = c.role ? `(${c.role})` : '', comp = c.company ? `🏢 ${c.company}` : '';
          const phoneLinks = c.phone ? `📞 <a href="tel:${c.phone}">${c.phone}</a> | 💬 <a href="https://wa.me/${c.phone.replace(/\D/g, '')}">WhatsApp</a>` : '📞 Sin teléfono';
          return `${i + 1}. 👤 <b>${c.name}</b> ${role}\n   ${comp ? comp + '\n   ' : ''}${phoneLinks}${c.email ? ` | ✉️ <a href="mailto:${c.email}">${c.email}</a>` : ''}`;
        }).join('\n\n');
        reply = `${cleanText ? cleanText + '\n\n' : ''}🔍 <b>Contactos encontrados para "${parsedAction.query}" (${contacts.length}):</b>\n\n${list}`;
      }
    }

    return makeActionResult({ reply, actionData: parsedAction, contacts, fullHistoryText: `${cleanText}\n[Búsqueda de contactos: "${parsedAction.query}" -> ${contacts.length} resultados]` });
  }

  return makeActionResult({ reply: cleanText });
}

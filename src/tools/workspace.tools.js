import { makeActionResult, synthesizeToolResults } from './index.js';

/**
 * Módulo de Herramientas de Espacio de Trabajo (Gmail, Google Calendar, Tareas y Contactos).
 */
export async function handleWorkspaceAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

  // ------------------- TAREAS -------------------
  if (action === 'SAVE_TASK') {
    if (deps.taskService && typeof deps.taskService.createTask === 'function') {
      await deps.taskService.createTask({
        description: parsedAction.description,
        due: parsedAction.due,
        dueDate: parsedAction.dueDate,
        priority: parsedAction.priority,
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

    const verb = isComplete ? 'completar' : 'cancelar';
    const past = isComplete ? 'completada' : 'cancelada';
    let reply = '';
    if (taskErr) {
      reply = `⚠️ Sebastián querido, ocurrió un error al intentar ${verb} la tarea: ${taskErr}`;
    } else if (!task) {
      reply = cleanText || `Sebastián querido, no encontré ninguna tarea pendiente para ${verb} con "${parsedAction.query || parsedAction.id || 'la búsqueda'}".`;
    } else {
      reply = cleanText || (isComplete
        ? `¡Listo mi Sebastián querido! Di por concluida la tarea "${task.description}" en tu lista.`
        : `¡Listo, mi jefe querido! Cancelé la tarea "${task.description}" de tu lista.`);
    }

    return makeActionResult({
      reply,
      hasTask: Boolean(task),
      task,
      actionData: parsedAction,
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

    if (deps.gmailService) {
      try {
        emails = typeof deps.gmailService.searchEmails === 'function'
          ? await deps.gmailService.searchEmails({ query: parsedAction.query || '', maxResults, onlyImportant, includeRead: isSpecificQuery })
          : (typeof deps.gmailService.getUnreadInboxMessages === 'function' ? await deps.gmailService.getUnreadInboxMessages({ maxResults, query: parsedAction.query, onlyImportant }) : []);

        const userText = context.userText || '';
        const isExplicitSingle = Boolean(
          parsedAction.readSingle === true || parsedAction.maxResults === 1 ||
          /(?:leer|escuchar|abrir|detalle(?:\s+del)?|resumen(?:\s+en\s+audio)?\s+del?)\s+(?:el|este|un|ese)\s+(?:correo|email|mensaje)/i.test(userText) ||
          /del\s+correo\s+de\b/i.test(userText) || /\b(?:el|este)\s+correo\s+(?:de|con|sobre)\b/i.test(userText)
        );

        if (emails.length > 0 && isExplicitSingle && typeof deps.gmailService.getEmailDetails === 'function') {
          try { emailDetail = await deps.gmailService.getEmailDetails({ messageId: emails[0].id }); }
          catch (detErr) { console.warn('[Brain Gmail] No se pudo obtener detalle del correo:', detErr.message); }
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
    } else if (emailDetail) {
      const fromClean = emailDetail.from ? emailDetail.from.replace(/<[^>]+>/, '').trim() : 'Remitente';
      const bodySnippet = emailDetail.bodyText ? emailDetail.bodyText.slice(0, 500).replace(/\s+/g, ' ') : (emailDetail.snippet || '');
      emailReply = `Sebastián querido, aquí tengo el correo de ${fromClean} con asunto "${emailDetail.subject}":\n\n📌 <b>Resumen Ejecutivo:</b>\n${bodySnippet}${emailDetail.bodyText && emailDetail.bodyText.length > 500 ? '...' : ''}\n\n¿Deseas que prepare una respuesta o realice alguna acción con este correo?`;
    } else {
      const dataSummary = emails.map((em, i) => `[Correo ${i + 1}] Fecha: ${em.date} | De: ${em.from} | Asunto: ${em.subject} | Fragmento: ${em.snippet}`).join('\n');
      emailReply = await synthesizeToolResults(deps, {
        userText: context.userText || parsedAction.query || 'consulta de correos',
        toolName: 'Gmail', dataSummary, context,
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
      if (deps.calendarService && typeof deps.calendarService.createEvent === 'function') {
        eventResult = await deps.calendarService.createEvent({
          summary: parsedAction.summary, description: parsedAction.description,
          startDateTime: parsedAction.startDateTime, endDateTime: parsedAction.endDateTime, location: parsedAction.location,
        });
      }
    } catch (calErr) {
      console.error('[Brain Calendar] Error agendando en Google Calendar:', calErr.message);
      errorMsg = calErr.message;
    }

    const link = eventResult?.htmlLink || 'https://calendar.google.com';
    const calendarReply = eventResult
      ? `${cleanText ? cleanText + '\n\n' : ''}📅 <b>¡Cita agendada en tu Google Calendar!</b>\n\n📌 <b>Evento:</b> ${eventResult.summary}\n⏰ <b>Inicio:</b> ${eventResult.start}\n${eventResult.end ? `🏁 <b>Fin:</b> ${eventResult.end}\n` : ''}${parsedAction.location ? `📍 <b>Ubicación:</b> ${parsedAction.location}\n` : ''}🔗 <a href="${link}">Ver evento en Google Calendar</a>`
      : `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude sincronizar con Google Calendar (${errorMsg || 'Servicio no disponible'}).`;

    return makeActionResult({
      reply: calendarReply, hasCalendarEvent: Boolean(eventResult), calendarEvent: eventResult,
      actionData: parsedAction, fullHistoryText: `${cleanText}\n[Evento agendado en Google Calendar: ${parsedAction.summary} (${link})]`,
    });
  }

  if (action === 'LIST_CALENDAR_EVENTS') {
    const range = parsedAction.range || 'TODAY';
    let events = [], rangeLabel = 'de Hoy';
    if (deps.calendarService) {
      try {
        if (range === 'TOMORROW' && typeof deps.calendarService.getTomorrowEvents === 'function') {
          rangeLabel = 'de Mañana';
          events = await deps.calendarService.getTomorrowEvents();
        } else if (range === 'UPCOMING' && typeof deps.calendarService.listUpcomingEvents === 'function') {
          rangeLabel = 'Próximas Citas';
          events = await deps.calendarService.listUpcomingEvents({ maxResults: 10 });
        } else if (typeof deps.calendarService.getTodayEvents === 'function') {
          events = await deps.calendarService.getTodayEvents();
        }
      } catch (err) { console.error('[Brain Calendar] Error listando eventos del calendario:', err.message); }
    }

    const itinerary = events.length === 0
      ? `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel}):</b>\n\n• No tienes citas agendadas. ¡Tiempo despejado para enfocarte!`
      : `${cleanText ? cleanText + '\n\n' : ''}📅 <b>Agenda de Google Calendar (${rangeLabel} - ${events.length} cita${events.length === 1 ? '' : 's'}):</b>\n\n` +
        events.map((ev, i) => {
          let time = ev.start;
          if (ev.start) {
            const d = new Date(ev.start);
            time = !isNaN(d.getTime()) ? d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Guatemala' }) : ev.start;
          }
          return `${i + 1}. ⏰ <b>${time}</b> - <b>${ev.summary}</b>${ev.location ? ` | 📍 <i>${ev.location}</i>` : ''}${ev.htmlLink ? ` (<a href="${ev.htmlLink}">Ver</a>)` : ''}`;
        }).join('\n');

    return makeActionResult({
      reply: itinerary, actionData: parsedAction, calendarEvents: events,
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

    let calendarReply = '';
    if (eventResult) {
      if (isReschedule) {
        const link = eventResult.htmlLink || 'https://calendar.google.com';
        calendarReply = cleanText || `📅 <b>¡Cita reprogramada en tu Google Calendar!</b>\n\n📌 <b>Evento:</b> ${eventResult.summary}\n⏰ <b>Nueva Hora:</b> ${eventResult.start}\n${eventResult.end ? `🏁 <b>Fin:</b> ${eventResult.end}\n` : ''}🔗 <a href="${link}">Ver evento en Google Calendar</a>`;
      } else {
        calendarReply = cleanText || `¡Listo mi Sebastián querido! He cancelado la cita "${parsedAction.query || parsedAction.eventId}" en tu Google Calendar.`;
      }
    } else {
      calendarReply = `${cleanText ? cleanText + '\n\n' : ''}⚠️ No pude ${isReschedule ? 'reprogramar la' : 'cancelar la'} cita en Google Calendar (${errorMsg || 'Servicio no disponible'}).`;
    }

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
      if (deps.contactService && typeof deps.contactService.createOrUpdateContact === 'function') {
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
      if (deps.contactService && typeof deps.contactService.searchContacts === 'function') {
        contacts = await deps.contactService.searchContacts({ query: parsedAction.query });
      }
    } catch (err) { console.error('[Brain Contact] Error buscando contactos:', err.message); }

    let reply = '';
    if (contacts.length === 0) {
      reply = `${cleanText ? cleanText + '\n\n' : ''}🔍 No encontré contactos en el directorio con el término "<b>${parsedAction.query}</b>".`;
    } else {
      const list = contacts.map((c, i) => {
        const role = c.role ? `(${c.role})` : '';
        const comp = c.company ? `🏢 ${c.company}` : '';
        let phoneLinks = '📞 Sin teléfono';
        if (c.phone) {
          const cleanDigits = c.phone.replace(/\D/g, '');
          phoneLinks = `📞 <a href="tel:${c.phone}">${c.phone}</a> | 💬 <a href="https://wa.me/${cleanDigits}">WhatsApp</a>`;
        }
        return `${i + 1}. 👤 <b>${c.name}</b> ${role}\n   ${comp ? comp + '\n   ' : ''}${phoneLinks}${c.email ? ` | ✉️ <a href="mailto:${c.email}">${c.email}</a>` : ''}`;
      }).join('\n\n');
      reply = `${cleanText ? cleanText + '\n\n' : ''}🔍 <b>Contactos encontrados para "${parsedAction.query}" (${contacts.length}):</b>\n\n${list}`;
    }

    return makeActionResult({ reply, actionData: parsedAction, contacts, fullHistoryText: `${cleanText}\n[Búsqueda de contactos: "${parsedAction.query}" -> ${contacts.length} resultados]` });
  }

  return makeActionResult({ reply: cleanText });
}

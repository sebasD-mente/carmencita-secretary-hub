import { makeActionResult } from '../index.js';

export async function handleContactsAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

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

    return Object.assign(makeActionResult({
      reply, actionData: parsedAction, contact,
      fullHistoryText: `${cleanText}\n[Contacto guardado: ${contact?.name || parsedAction.name}]`,
    }), { data: { contact, success: Boolean(contact) } });
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
      const list = contacts.map((c, i) => {
        const role = c.role ? `(${c.role})` : '', comp = c.company ? `🏢 ${c.company}` : '';
        const phoneLinks = c.phone ? `📞 <a href="tel:${c.phone}">${c.phone}</a> | 💬 <a href="https://wa.me/${c.phone.replace(/\D/g, '')}">WhatsApp</a>` : '📞 Sin teléfono';
        return `${i + 1}. 👤 <b>${c.name}</b> ${role}\n   ${comp ? comp + '\n   ' : ''}${phoneLinks}${c.email ? ` | ✉️ <a href="mailto:${c.email}">${c.email}</a>` : ''}`;
      }).join('\n\n');
      reply = `${cleanText ? cleanText + '\n\n' : ''}🔍 <b>Contactos encontrados para "${parsedAction.query}" (${contacts.length}):</b>\n\n${list}`;
    }

    return Object.assign(makeActionResult({
      reply, actionData: parsedAction, contacts,
      fullHistoryText: `${cleanText}\n[Búsqueda de contactos: "${parsedAction.query}" -> ${contacts.length} resultados]`,
    }), { data: { contacts, query: parsedAction.query, count: contacts.length } });
  }

  return makeActionResult({ reply: cleanText });
}

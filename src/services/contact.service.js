import { prisma as defaultPrisma } from '../core/prisma.js';

export class ContactService {
  constructor(prismaClient = defaultPrisma) {
    this.prisma = prismaClient;
  }

  _sanitizePhone(phone) {
    if (!phone) return null;
    const clean = String(phone).trim().replace(/[^\d+]/g, '');
    return clean || null;
  }

  async createOrUpdateContact({ name, role = null, phone = null, email = null, company = null, notes = null }) {
    if (!name || !name.trim()) {
      throw new Error('El nombre del contacto es obligatorio.');
    }

    const trimmedName = name.trim();
    const sanitizedPhone = this._sanitizePhone(phone);
    const sanitizedEmail = email ? email.trim().toLowerCase() : null;

    // Buscar si existe un contacto con el mismo teléfono, email o nombre
    let existing = null;
    if (sanitizedPhone) {
      existing = await this.prisma.contact.findFirst({
        where: { phone: sanitizedPhone },
      });
    }
    if (!existing && sanitizedEmail) {
      existing = await this.prisma.contact.findFirst({
        where: { email: sanitizedEmail },
      });
    }
    if (!existing) {
      existing = await this.prisma.contact.findFirst({
        where: {
          name: { equals: trimmedName, mode: 'insensitive' },
        },
      });
    }

    if (existing) {
      return await this.prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: trimmedName,
          role: role ?? existing.role,
          phone: sanitizedPhone ?? existing.phone,
          email: sanitizedEmail ?? existing.email,
          company: company ?? existing.company,
          notes: notes ? (existing.notes ? `${existing.notes}\n${notes}` : notes) : existing.notes,
        },
      });
    }

    return await this.prisma.contact.create({
      data: {
        name: trimmedName,
        role: role?.trim() || null,
        phone: sanitizedPhone,
        email: sanitizedEmail,
        company: company?.trim() || null,
        notes: notes?.trim() || null,
      },
    });
  }

  async searchContacts({ query, limit = 10 } = {}) {
    if (!query || !query.trim()) return [];
    const q = query.trim();

    return await this.prisma.contact.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { role: { contains: q, mode: 'insensitive' } },
          { company: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { notes: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { name: 'asc' },
    });
  }

  async listContacts({ limit = 20 } = {}) {
    return await this.prisma.contact.findMany({
      take: limit,
      orderBy: { name: 'asc' },
    });
  }

  async getContactById(id) {
    return await this.prisma.contact.findUnique({
      where: { id },
    });
  }

  async deleteContact(id) {
    try {
      await this.prisma.contact.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const contactService = new ContactService();

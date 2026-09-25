import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma as defaultPrisma } from '../src/core/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../data');

async function readJsonSafe(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[Migration Warning] No se pudo leer ${filePath}:`, err.message);
    }
    return fallback;
  }
}

export async function runMigration(client = null) {
  const db = client || defaultPrisma;
  console.log('🔄 Iniciando migración de datos legacy JSON a PostgreSQL / Prisma...');

  // 1. Migración de Mensajes de Historial
  const historyFile = path.join(dataDir, 'history.json');
  const historyData = await readJsonSafe(historyFile, { messages: [] });
  let migratedMessages = 0;

  if (historyData.messages && Array.isArray(historyData.messages)) {
    for (const msg of historyData.messages) {
      await db.messageLog.create({
        data: {
          channel: msg.channel || 'telegram',
          senderId: String(msg.senderId || '8880568848'),
          senderName: msg.senderName || 'Sebastián',
          role: msg.role || 'user',
          content: msg.text || '',
          createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date(),
        },
      });
      migratedMessages++;
    }
  }
  console.log(`✅ Mensajes de historial migrados: ${migratedMessages}`);

  // 2. Migración de Facturas (incluyendo factura McDonald's)
  const facturasFile = path.join(dataDir, 'facturas', 'index.json');
  const facturasData = await readJsonSafe(facturasFile, { facturas: [] });
  let migratedFacturas = 0;

  if (facturasData.facturas && Array.isArray(facturasData.facturas)) {
    for (const fac of facturasData.facturas) {
      const meta = fac.metadata || {};
      const rawTotal = String(meta.total || '0').replace(/[^0-9.-]+/g, '');
      const parsedTotal = parseFloat(rawTotal) || 0;

      let purchaseDate = null;
      if (meta.purchaseDate) {
        const parsed = new Date(meta.purchaseDate);
        if (!isNaN(parsed.getTime())) purchaseDate = parsed;
      }

      let warrantyUntil = null;
      const warrantyMonths = parseInt(meta.warrantyMonths, 10) || 0;
      if (purchaseDate && warrantyMonths > 0) {
        const until = new Date(purchaseDate);
        until.setMonth(until.getMonth() + warrantyMonths);
        warrantyUntil = until;
      }

      let fileSize = 0;
      try {
        const diskPath = path.isAbsolute(fac.filePath)
          ? fac.filePath
          : path.join(dataDir, fac.filePath);
        const stat = await fs.stat(diskPath);
        fileSize = stat.size;
      } catch {
        fileSize = 1024;
      }

      await db.$transaction(async (tx) => {
        const doc = await tx.document.create({
          data: {
            fileName: fac.fileName || path.basename(fac.filePath),
            originalName: fac.fileName || 'factura_legacy.jpg',
            mimeType: fac.fileName?.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
            category: 'FACTURA',
            filePath: fac.filePath,
            fileSize,
            summary: meta.notes || null,
            tags: ['migracion', 'legacy', 'factura'],
            metadata: meta,
            createdAt: fac.savedAt ? new Date(fac.savedAt) : new Date(),
          },
        });

        await tx.invoice.create({
          data: {
            documentId: doc.id,
            vendor: meta.vendor || 'Proveedor Desconocido',
            item: meta.item || 'Consumo / Compra',
            totalAmount: parsedTotal,
            currency: 'GTQ',
            purchaseDate,
            warrantyMonths,
            warrantyUntil,
            isExpense: true,
            notes: meta.notes || null,
          },
        });
      });
      migratedFacturas++;
    }
  }
  console.log(`✅ Facturas y documentos migrados: ${migratedFacturas}`);

  // 3. Migración de Ideas
  const ideasFile = path.join(dataDir, 'ideas', 'index.json');
  const ideasData = await readJsonSafe(ideasFile, { ideas: [] });
  let migratedIdeas = 0;

  if (ideasData.ideas && Array.isArray(ideasData.ideas)) {
    for (const idea of ideasData.ideas) {
      await db.idea.create({
        data: {
          title: idea.title || 'Idea Sin Título',
          summary: idea.summary || '',
          rawText: idea.rawContent || idea.summary || '',
          priority: (idea.priority || 'MEDIA').toUpperCase(),
          tags: Array.isArray(idea.tags) ? idea.tags : [],
          createdAt: idea.savedAt ? new Date(idea.savedAt) : new Date(),
        },
      });
      migratedIdeas++;
    }
  }
  console.log(`✅ Ideas migradas: ${migratedIdeas}`);

  // 4. Migración de Tareas
  const tasksFile = path.join(dataDir, 'tasks', 'tasks.json');
  const tasksData = await readJsonSafe(tasksFile, { tasks: [] });
  let migratedTasks = 0;

  if (tasksData.tasks && Array.isArray(tasksData.tasks)) {
    for (const task of tasksData.tasks) {
      let dueDate = null;
      if (task.due) {
        const parsed = new Date(task.due);
        if (!isNaN(parsed.getTime())) dueDate = parsed;
      }
      await db.task.create({
        data: {
          description: task.description || 'Tarea pendiente',
          dueDate,
          priority: (task.priority || 'MEDIA').toUpperCase(),
          status: task.status === 'completed' ? 'COMPLETADA' : 'PENDIENTE',
          createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
        },
      });
      migratedTasks++;
    }
  }
  console.log(`✅ Tareas migradas: ${migratedTasks}`);

  // 5. Migración de Contactos
  const contactsFile = path.join(dataDir, 'contacts.json');
  const contactsData = await readJsonSafe(contactsFile, { contacts: [] });
  let migratedContacts = 0;

  if (contactsData.contacts && Array.isArray(contactsData.contacts)) {
    for (const contact of contactsData.contacts) {
      const phone = contact.phone?.trim() ? contact.phone.trim() : null;
      const email = contact.email?.trim() ? contact.email.trim() : null;
      await db.contact.create({
        data: {
          name: contact.name || 'Contacto',
          role: contact.role || null,
          phone,
          email,
          company: contact.company || null,
          notes: contact.relationship ? `Relación: ${contact.relationship}` : null,
        },
      });
      migratedContacts++;
    }
  }
  console.log(`✅ Contactos migrados: ${migratedContacts}`);

  console.log('🎉 Migración completada con éxito.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration()
    .catch((err) => {
      console.error('❌ Error fatal en migración:', err);
      process.exit(1);
    })
    .finally(async () => {
      await defaultPrisma.$disconnect();
    });
}

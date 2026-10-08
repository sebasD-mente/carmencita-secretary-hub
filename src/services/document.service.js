import { prisma as defaultPrisma } from '../core/prisma.js';
import { defaultStorageProvider } from './storage.provider.js';
import { defaultEmbeddingService } from './embedding.service.js';
import { DocumentCategorySchema, InvoiceMetadataSchema } from '../validators/actions.schema.js';

export class DocumentService {
  constructor(prismaClient = defaultPrisma, storageProvider = defaultStorageProvider, embeddingService = undefined) {
    this.prisma = prismaClient;
    this.storage = storageProvider;
    this.embeddingService = embeddingService !== undefined
      ? embeddingService
      : (prismaClient === defaultPrisma ? defaultEmbeddingService : null);
  }

  /**
   * Guarda un documento físico y crea su registro atómico en PostgreSQL.
   */
  async saveDocument({
    buffer,
    originalName,
    mimeType = 'application/octet-stream',
    category = 'GENERAL',
    summary = null,
    tags = [],
    metadata = null,
    invoiceData = null,
  }) {
    const validatedCategory = DocumentCategorySchema.parse(category);

    // 1. Guardar archivo físico en disco/volumen
    const subDir = validatedCategory === 'FACTURA' ? 'facturas' : 'documents';
    const fileInfo = await this.storage.saveFile({
      buffer,
      originalName,
      mimeType,
      subDir,
    });

    // 2. Persistir registro en Prisma (dentro de transacción ACID si incluye factura)
    const result = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          fileName: fileInfo.fileName,
          originalName: fileInfo.originalName,
          mimeType: fileInfo.mimeType,
          category: validatedCategory,
          filePath: fileInfo.filePath,
          fileSize: fileInfo.fileSize,
          summary,
          tags: Array.isArray(tags) ? tags : [],
          metadata: metadata || undefined,
        },
      });

      let invoice = null;
      if (invoiceData || validatedCategory === 'FACTURA') {
        const rawInvoice = invoiceData || {};
        const validatedInvoice = InvoiceMetadataSchema.parse({
          vendor: rawInvoice.vendor || metadata?.vendor || 'Proveedor General',
          item: rawInvoice.item || metadata?.item || originalName,
          totalAmount: rawInvoice.totalAmount ?? rawInvoice.total ?? metadata?.total ?? 0,
          currency: rawInvoice.currency || 'GTQ',
          purchaseDate: rawInvoice.purchaseDate || metadata?.purchaseDate || new Date(),
          warrantyMonths: rawInvoice.warrantyMonths ?? metadata?.warrantyMonths ?? 0,
          warrantyUntil: rawInvoice.warrantyUntil || null,
          isExpense: rawInvoice.isExpense ?? true,
          notes: rawInvoice.notes || summary || null,
        });

        // Calcular fecha de vencimiento de garantía si no viene explícita
        let warrantyUntil = null;
        if (validatedInvoice.warrantyUntil) {
          warrantyUntil = new Date(validatedInvoice.warrantyUntil);
        } else if (validatedInvoice.purchaseDate && validatedInvoice.warrantyMonths > 0) {
          const pDate = new Date(validatedInvoice.purchaseDate);
          if (!isNaN(pDate.getTime())) {
            const until = new Date(pDate);
            until.setMonth(until.getMonth() + validatedInvoice.warrantyMonths);
            warrantyUntil = until;
          }
        }

        invoice = await tx.invoice.create({
          data: {
            documentId: document.id,
            vendor: validatedInvoice.vendor,
            item: validatedInvoice.item,
            totalAmount: validatedInvoice.totalAmount,
            currency: validatedInvoice.currency,
            purchaseDate: validatedInvoice.purchaseDate ? new Date(validatedInvoice.purchaseDate) : null,
            warrantyMonths: validatedInvoice.warrantyMonths,
            warrantyUntil,
            isExpense: validatedInvoice.isExpense,
            notes: validatedInvoice.notes,
          },
        });
      }

      return {
        ...document,
        invoice,
      };
    });

    // 3. Vectorización Automática RAG hacia SemanticMemory
    if (this.embeddingService && typeof this.embeddingService.saveMemory === 'function' && (summary || invoiceData || metadata)) {
      const isInvoice = validatedCategory === 'FACTURA' || Boolean(invoiceData);
      const categoryTag = isInvoice ? 'FACTURA' : 'DOCUMENTO';
      const rawInv = result.invoice || invoiceData;
      const vendorInfo = rawInv?.vendor ? `Proveedor: ${rawInv.vendor}. ` : '';
      const amountInfo = rawInv?.totalAmount ? `Monto: ${rawInv.currency || 'GTQ'} ${rawInv.totalAmount}. ` : '';
      const textToEmbed = `[${categoryTag}: ${originalName}] ${vendorInfo}${amountInfo}${summary || ''}`.trim();

      await this.embeddingService.saveMemory({
        content: textToEmbed,
        category: categoryTag,
        metadata: {
          documentId: result.id,
          originalName,
          category: validatedCategory,
          vendor: rawInv?.vendor || null,
          totalAmount: rawInv?.totalAmount || null,
        },
      }).catch((err) => console.warn('[DocumentService RAG] Error vectorizando documento:', err.message));
    }

    return result;
  }

  /**
   * Búsqueda semántica documental en SemanticMemory
   */
  async searchDocumentsSemantic({ query, category = null, limit = 5 } = {}) {
    if (!this.embeddingService || typeof this.embeddingService.searchSimilarMemories !== 'function') {
      return await this.listDocuments({ limit });
    }
    const catFilter = category === 'FACTURA' ? 'FACTURA' : (category && category !== 'TODOS' ? 'DOCUMENTO' : null);
    return await this.embeddingService.searchSimilarMemories(query, {
      category: catFilter,
      limit,
      minSimilarity: 0.45,
    });
  }

  /**
   * Lista facturas con detalles de documento asociado.
   */
  async listInvoices({ limit = 10, vendor = null } = {}) {
    const where = {};
    if (vendor) {
      where.vendor = { contains: vendor, mode: 'insensitive' };
    }

    return await this.prisma.invoice.findMany({
      where,
      include: {
        document: true,
      },
      orderBy: { document: { createdAt: 'desc' } },
      take: limit,
    });
  }

  /**
   * Lista documentos por categoría.
   */
  async listDocuments({ category = null, limit = 20 } = {}) {
    const where = {};
    if (category) {
      where.category = DocumentCategorySchema.parse(category);
    }

    return await this.prisma.document.findMany({
      where,
      include: {
        invoice: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Obtiene un documento por su ID.
   */
  async getDocumentById(id) {
    return await this.prisma.document.findUnique({
      where: { id },
      include: {
        invoice: true,
      },
    });
  }

  /**
   * Elimina un documento y su archivo físico en disco.
   */
  async deleteDocument(id) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) return false;

    if (doc.filePath) {
      await this.storage.deleteFile(doc.filePath);
    }

    await this.prisma.document.delete({ where: { id } });
    return true;
  }
}

export const documentService = new DocumentService();

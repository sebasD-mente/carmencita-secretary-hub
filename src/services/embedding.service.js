import { GoogleGenAI } from '@google/genai';
import { Prisma } from '@prisma/client';
import { config } from '../config.js';
import { prisma as defaultPrisma } from '../core/prisma.js';

export class EmbeddingService {
  constructor(depsOrPrisma = {}, maybeAi = null) {
    if (depsOrPrisma && (depsOrPrisma.$queryRaw || depsOrPrisma.$queryRawUnsafe || depsOrPrisma.$executeRawUnsafe || depsOrPrisma.$transaction || depsOrPrisma.document)) {
      this.prisma = depsOrPrisma;
      this.ai = maybeAi;
    } else {
      this.prisma = depsOrPrisma?.prisma || defaultPrisma;
      this.ai = depsOrPrisma?.ai || maybeAi || null;
    }

    if (!this.ai && config.ai.geminiApiKey) {
      try {
        this.ai = new GoogleGenAI({ apiKey: config.ai.geminiApiKey });
      } catch (err) {
        console.warn('[EmbeddingService] Could not initialize Gemini SDK:', err.message);
      }
    }
  }

  /**
   * Genera el vector de embedding utilizando el modelo text-embedding-004 de Google GenAI
   * @param {string} text - Texto a vectorizar
   * @returns {Promise<number[]>} Array de 768 números flotantes
   */
  async generateEmbedding(text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      return null;
    }

    if (!this.ai) {
      throw new Error('Gemini AI client no está configurado para generar embeddings.');
    }

    let res;
    try {
      res = await this.ai.models.embedContent({
        model: 'text-embedding-004',
        contents: text.trim(),
      });
    } catch (err) {
      if (err.message?.includes('not found') || err.message?.includes('404')) {
        res = await this.ai.models.embedContent({
          model: 'gemini-embedding-001',
          contents: text.trim(),
          config: { outputDimensionality: 768 },
        });
      } else {
        throw err;
      }
    }

    const values = res?.embedding?.values || res?.embeddings?.[0]?.values;
    if (!values || !Array.isArray(values)) {
      throw new Error('Respuesta inválida del modelo de embeddings.');
    }

    return values;
  }

  /**
   * Almacena un nuevo recuerdo semántico en PostgreSQL utilizando pgvector
   * @param {Object} params
   * @param {string} params.content - Contenido textual del recuerdo
   * @param {string} [params.category='GENERAL'] - Categoría (PREFERENCIA, ACUERDO, PROVEEDOR, DIRECTIVA, GENERAL)
   * @param {Object|null} [params.metadata=null] - Metadatos adicionales opcionales
   * @returns {Promise<Object>}
   */
  async saveMemory({ content, category = 'GENERAL', metadata = null }) {
    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new Error('El contenido del recuerdo es obligatorio.');
    }

    const trimmedContent = content.trim();
    const embedding = await this.generateEmbedding(trimmedContent);
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('No se pudo generar el vector de embedding para el recuerdo.');
    }

    const vectorStr = `[${embedding.join(',')}]`;
    const jsonMetadata = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

    if (this.prisma.$executeRaw && !this.prisma._data) {
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "SemanticMemory" (id, category, content, embedding, metadata, "createdAt")
        VALUES (gen_random_uuid(), ${category}, ${trimmedContent}, ${vectorStr}::vector, ${jsonMetadata}::jsonb, NOW())
      `);
    } else {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "SemanticMemory" (id, category, content, embedding, metadata, "createdAt")
         VALUES (gen_random_uuid(), $1, $2, $3::vector, $4::jsonb, NOW())`,
        category,
        trimmedContent,
        vectorStr,
        jsonMetadata
      );
    }

    return {
      success: true,
      category,
      content: trimmedContent,
      metadata,
    };
  }

  /**
   * Busca recuerdos semánticamente similares utilizando distancia coseno (<=>) en pgvector
   * @param {string} queryText - Consulta o mensaje a comparar
   * @param {Object} [options]
   * @param {number} [options.limit=3] - Máximo número de resultados
   * @param {number} [options.minSimilarity=0.55] - Umbral mínimo de similitud coseno (0.0 a 1.0)
   * @param {string|null} [options.category=null] - Filtro opcional por categoría
   * @param {string|null} [options.excludeCategory=null] - Exclusión opcional de categoría
   * @returns {Promise<Array>} Lista de recuerdos con id, category, content, metadata, createdAt y similarity
   */
  async searchSimilarMemories(queryText, { limit = 3, minSimilarity = 0.55, category = null, excludeCategory = null } = {}) {
    if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
      return [];
    }

    const queryVector = await this.generateEmbedding(queryText.trim());
    if (!queryVector || !Array.isArray(queryVector)) {
      return [];
    }

    const vectorStr = `[${queryVector.join(',')}]`;

    let memories;
    if (this.prisma.$queryRaw && !this.prisma._data) {
      // Prisma real con pgvector: parámetros vinculados de forma segura con Prisma.sql
      const categoryClause = category ? Prisma.sql`AND category = ${category}` : Prisma.empty;
      const excludeCategoryClause = excludeCategory ? Prisma.sql`AND category != ${excludeCategory}` : Prisma.empty;

      memories = await this.prisma.$queryRaw(Prisma.sql`
        SELECT id, category, content, metadata, "createdAt",
                1 - (embedding <=> ${vectorStr}::vector) as similarity
        FROM "SemanticMemory"
        WHERE embedding IS NOT NULL
        ${categoryClause}
        ${excludeCategoryClause}
        AND (1 - (embedding <=> ${vectorStr}::vector)) >= ${minSimilarity}
        ORDER BY embedding <=> ${vectorStr}::vector ASC
        LIMIT ${limit}
      `);
    } else {
      // Compatibilidad y blindaje con parámetros posicionales ($1, $2, $3, $4, $5) sin interpolación
      const queryParams = [vectorStr, minSimilarity, limit];
      let catFilterSql = '';
      let exFilterSql = '';

      if (category) {
        queryParams.push(category);
        catFilterSql = ` AND category = $${queryParams.length}`;
      }

      if (excludeCategory) {
        queryParams.push(excludeCategory);
        exFilterSql = ` AND category != $${queryParams.length}`;
      }

      const sql = `SELECT id, category, content, metadata, "createdAt",
                1 - (embedding <=> $1::vector) as similarity
         FROM "SemanticMemory"
         WHERE embedding IS NOT NULL
         ${catFilterSql}
         ${exFilterSql}
         AND (1 - (embedding <=> $1::vector)) >= $2
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $3`;

      memories = await this.prisma.$queryRawUnsafe(sql, ...queryParams);
    }

    return (memories || []).map((m) => ({
      ...m,
      similarity: typeof m.similarity === 'number' ? m.similarity : parseFloat(m.similarity || 0),
    }));
  }

  /**
   * Consulta las directivas cardinales activas de Sebastián
   * @param {Object} [options]
   * @param {number} [options.limit=10]
   * @returns {Promise<Array>}
   */
  async getActiveDirectives({ limit = 10 } = {}) {
    if (!this.prisma?.semanticMemory?.findMany) {
      return [];
    }
    return this.prisma.semanticMemory.findMany({
      where: { category: 'DIRECTIVA' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, content: true, createdAt: true },
    });
  }
}

export const embeddingService = new EmbeddingService();
export const defaultEmbeddingService = embeddingService;

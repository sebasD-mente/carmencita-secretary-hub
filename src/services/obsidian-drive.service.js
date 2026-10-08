import { config } from '../config.js';

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesSearchTerm(target, term) {
  if (!target || !term) return false;
  const targetLower = target.toLowerCase();
  const termLower = term.toLowerCase();
  if (term.length <= 2) {
    const rx = new RegExp(`(^|[^a-záéíóúüñ0-9])${escapeRegExp(termLower)}([^a-záéíóúüñ0-9]|$)`, 'i');
    return rx.test(targetLower);
  }
  return targetLower.includes(termLower);
}

export class ObsidianDriveService {
  constructor({
    clientId = config.google?.clientId,
    clientSecret = config.google?.clientSecret,
    refreshToken = config.google?.refreshToken,
    vaultFolderName = config.obsidian?.vaultFolderName || 'vault',
    vaultFolderId = config.obsidian?.vaultFolderId || '',
    driveClient = null,
    cacheTtlMs = 5 * 60 * 1000,
    embeddingService = null,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.vaultFolderName = vaultFolderName;
    this.vaultFolderId = vaultFolderId || null;
    this.driveClient = driveClient;
    this.embeddingService = embeddingService;
    this.cachedSubfolderIds = new Map();

    // Caché en memoria para el árbol del Vault (TTL de 5 minutos)
    this._vaultCache = {
      timestamp: 0,
      files: [],          // Array de objetos { id, name, cleanTitle, relativePath, folderPath, modifiedTime, webViewLink }
      folders: new Map(), // Map<folderPath, folderId>
    };
    this._cacheTtlMs = cacheTtlMs;
  }

  async _getDriveClient() {
    if (this.driveClient) return this.driveClient;
    if (!this.refreshToken) return null;

    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
      oauth2Client.setCredentials({ refresh_token: this.refreshToken });
      this.driveClient = google.drive({ version: 'v3', auth: oauth2Client });
      return this.driveClient;
    } catch (err) {
      console.warn('[ObsidianDriveService] Google Drive API no disponible:', err.message);
      return null;
    }
  }

  async getOrCreateVaultFolder() {
    if (this.vaultFolderId) return this.vaultFolderId;
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado');

    const search = await drive.files.list({
      q: `name = '${this.vaultFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
    });

    if (search?.data?.files && search.data.files.length > 0) {
      this.vaultFolderId = search.data.files[0].id;
      return this.vaultFolderId;
    }

    const created = await drive.files.create({
      requestBody: {
        name: this.vaultFolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
      },
      fields: 'id, name',
    });

    this.vaultFolderId = created?.data?.id;
    return this.vaultFolderId;
  }

  async getOrCreateSubfolder(subfolderName) {
    const rootId = await this.getOrCreateVaultFolder();
    if (!subfolderName || subfolderName === '.' || subfolderName === '/') return rootId;

    const normalizedName = subfolderName.replace(/^\/+|\/+$/g, '');
    if (this._vaultCache?.folders?.has(normalizedName)) {
      return this._vaultCache.folders.get(normalizedName);
    }
    if (this.cachedSubfolderIds.has(normalizedName)) {
      return this.cachedSubfolderIds.get(normalizedName);
    }

    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado');

    const segments = normalizedName.split('/').filter(Boolean);
    let currentParentId = rootId;
    let accumulatedPath = '';

    for (const segment of segments) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
      if (this.cachedSubfolderIds.has(accumulatedPath)) {
        currentParentId = this.cachedSubfolderIds.get(accumulatedPath);
        continue;
      }
      if (this._vaultCache?.folders?.has(accumulatedPath)) {
        currentParentId = this._vaultCache.folders.get(accumulatedPath);
        continue;
      }

      const search = await drive.files.list({
        q: `'${currentParentId}' in parents and name = '${segment.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 1,
      });

      if (search?.data?.files && search.data.files.length > 0) {
        currentParentId = search.data.files[0].id;
      } else {
        const created = await drive.files.create({
          requestBody: {
            name: segment,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [currentParentId],
          },
          fields: 'id, name',
        });
        currentParentId = created?.data?.id;
      }

      this.cachedSubfolderIds.set(accumulatedPath, currentParentId);
      if (this._vaultCache?.folders) {
        this._vaultCache.folders.set(accumulatedPath, currentParentId);
      }
    }

    return currentParentId;
  }

  async _buildVaultTree({ forceRefresh = false } = {}) {
    const isCacheValid = !forceRefresh &&
      (Date.now() - this._vaultCache.timestamp < this._cacheTtlMs) &&
      this._vaultCache.files.length > 0;

    if (isCacheValid) {
      return this._vaultCache.files;
    }

    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');

    const rootFolderId = await this.getOrCreateVaultFolder();
    if (!rootFolderId) throw new Error('No se pudo obtener la carpeta raíz del Obsidian Vault');

    const collectedFiles = [];
    const collectedFoldersMap = new Map();
    collectedFoldersMap.set('', rootFolderId);

    const folderQueue = [{ folderId: rootFolderId, folderPath: '' }];

    while (folderQueue.length > 0) {
      const { folderId: currentFolderId, folderPath: currentFolderPath } = folderQueue.shift();
      let pageToken = null;

      do {
        const res = await drive.files.list({
          q: `'${currentFolderId}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
          pageSize: 100,
          pageToken: pageToken || undefined,
        });

        const files = res?.data?.files || [];
        for (const item of files) {
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            if (item.name === '.obsidian' || item.name?.startsWith('.obsidian')) {
              continue;
            }
            const childFolderPath = currentFolderPath ? `${currentFolderPath}/${item.name}` : item.name;
            collectedFoldersMap.set(childFolderPath, item.id);
            this.cachedSubfolderIds.set(childFolderPath, item.id);
            folderQueue.push({ folderId: item.id, folderPath: childFolderPath });
          } else {
            const isMd = (item.name && item.name.toLowerCase().endsWith('.md')) ||
                         item.mimeType === 'text/markdown' ||
                         item.mimeType === 'text/plain';
            if (isMd) {
              if (currentFolderPath.startsWith('.obsidian') || (item.name && item.name.startsWith('.obsidian'))) {
                continue;
              }
              const cleanTitle = item.name ? item.name.replace(/\.md$/i, '') : '';
              const relativePath = currentFolderPath ? `${currentFolderPath}/${item.name}` : item.name;

              collectedFiles.push({
                id: item.id,
                name: item.name,
                cleanTitle,
                relativePath,
                folderPath: currentFolderPath,
                modifiedTime: item.modifiedTime,
                webViewLink: item.webViewLink,
              });
            }
          }
        }

        pageToken = res?.data?.nextPageToken;
      } while (pageToken);
    }

    this._vaultCache = {
      timestamp: Date.now(),
      files: collectedFiles,
      folders: collectedFoldersMap,
    };

    return this._vaultCache.files;
  }

  async listAllNotes({ folder = null, maxResults = 50 } = {}) {
    const files = await this._buildVaultTree();
    let result = files.filter(f => !f.folderPath?.includes('.obsidian') && !f.relativePath?.includes('.obsidian/'));

    if (folder && folder.trim()) {
      const target = folder.trim().toLowerCase();
      result = result.filter(f =>
        (f.folderPath && f.folderPath.toLowerCase().includes(target)) ||
        (f.relativePath && f.relativePath.toLowerCase().includes(target))
      );
    }

    result.sort((a, b) => {
      if (a.modifiedTime && b.modifiedTime) {
        return new Date(b.modifiedTime) - new Date(a.modifiedTime);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    return result.slice(0, maxResults);
  }

  async searchNotes({ query = '', folder = null, maxResults = 20 } = {}) {
    const cleanQuery = (query || '').trim();
    const normalizedQuery = cleanQuery.toLowerCase();

    const GENERIC_KEYWORDS = [
      'reporte', 'resumen', 'notas', 'todas', 'todo', 'general',
      'lista', 'listado', 'boveda', 'bóveda', 'segundo cerebro', 'obsidian',
    ];

    const isGeneric = !cleanQuery || GENERIC_KEYWORDS.includes(normalizedQuery);

    if (isGeneric) {
      return this.listAllNotes({ folder, maxResults });
    }

    const files = await this._buildVaultTree();

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    let matched = files.filter(f => {
      if (f.folderPath?.includes('.obsidian') || f.relativePath?.includes('.obsidian/')) {
        return false;
      }
      if (folder && folder.trim()) {
        const target = folder.trim().toLowerCase();
        const inFolder = (f.folderPath && f.folderPath.toLowerCase().includes(target)) ||
                         (f.relativePath && f.relativePath.toLowerCase().includes(target));
        if (!inFolder) return false;
      }

      const cleanTitle = (f.cleanTitle || '').toLowerCase();
      const relativePath = (f.relativePath || '').toLowerCase();
      const name = (f.name || '').toLowerCase();

      if (cleanTitle.includes(normalizedQuery) || relativePath.includes(normalizedQuery) || name.includes(normalizedQuery)) {
        return true;
      }

      return terms.length > 0 && terms.every(t =>
        matchesSearchTerm(cleanTitle, t) || matchesSearchTerm(relativePath, t) || matchesSearchTerm(name, t)
      );
    });

    matched.sort((a, b) => {
      if (a.modifiedTime && b.modifiedTime) {
        return new Date(b.modifiedTime) - new Date(a.modifiedTime);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    if (matched.length > 0) {
      return matched.slice(0, maxResults);
    }

    // Fallback directo a Drive API si el árbol estaba vacío
    if (this._vaultCache.files.length === 0) {
      try {
        const drive = await this._getDriveClient();
        if (drive) {
          let q = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
          if (folder) {
            const folderId = await this.getOrCreateSubfolder(folder);
            q += ` and '${folderId}' in parents`;
          }
          const sanitized = cleanQuery.replace(/'/g, "\\'");
          q += ` and name contains '${sanitized}'`;
          const res = await drive.files.list({
            q,
            fields: 'files(id, name, webViewLink, modifiedTime, parents)',
            pageSize: Math.max(maxResults, 20),
          });
          return res?.data?.files || [];
        }
      } catch (err) {
        console.warn('[ObsidianDriveService] Fallback searchNotes error:', err.message);
      }
    }

    return [];
  }

  async createNote({ title, content, folder = '01_Inbox', tags = [], wikilinks = [] }) {
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');

    const targetFolderId = await this.getOrCreateSubfolder(folder);

    const sanitizedTitle = title.replace(/[\/\\?%*:|"<>]/g, '-').trim();
    const fileName = `${sanitizedTitle}.md`;

    const ahora = new Date();
    const ahoraGuatemala = new Date(ahora.getTime() - 6 * 3600 * 1000).toISOString().replace('Z', '-06:00');

    const tagList = Array.isArray(tags) ? tags : [];
    const yamlTags = tagList.length > 0 ? `tags:\n${tagList.map(t => `  - ${t.replace(/^#/, '')}`).join('\n')}\n` : '';

    const linksBlock = Array.isArray(wikilinks) && wikilinks.length > 0
      ? `\n\n### 🔗 Enlaces Relacionados (Graph View)\n${wikilinks.map(l => `- [[${l.replace(/^\[\[|\]\]$/g, '')}]]`).join('\n')}`
      : '';

    const markdownBody = `---
title: "${title.replace(/"/g, '\\"')}"
date: ${ahoraGuatemala}
author: Carmencita
folder: "${folder}"
${yamlTags}---

# ${title}

${content}${linksBlock}
`;

    const createdFile = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'text/markdown',
        parents: [targetFolderId],
      },
      media: {
        mimeType: 'text/markdown',
        body: markdownBody,
      },
      fields: 'id, name, webViewLink, parents',
    });

    // Invalidar caché en memoria del Vault tras crear nota exitosamente
    this._vaultCache.timestamp = 0;

    const result = {
      fileId: createdFile?.data?.id,
      fileName,
      folder,
      webViewLink: createdFile?.data?.webViewLink,
      rawContent: markdownBody,
    };

    const emb = this.embeddingService;
    if (emb && typeof emb.saveMemory === 'function') {
      this.indexNoteContentToVector({
        fileId: result.fileId,
        name: fileName,
        folder,
        content: markdownBody,
        embeddingService: emb,
      }).catch((err) => console.warn('[ObsidianDriveService RAG] Error indexando nota:', err.message));
    }

    return result;
  }

  async readNote({ fileId = null, name = null, folder = null } = {}) {
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');

    let targetFileId = fileId;
    let targetFileName = name;

    if (!targetFileId && name) {
      const found = await this.searchNotes({ query: name, folder, maxResults: 1 });
      if (found.length > 0) {
        targetFileId = found[0].id;
        targetFileName = found[0].name;
      }
    }

    if (!targetFileId) {
      throw new Error(`Nota no encontrada${name ? `: ${name}` : ''}`);
    }

    const res = await drive.files.get({
      fileId: targetFileId,
      alt: 'media',
    });

    return {
      fileId: targetFileId,
      fileName: targetFileName,
      content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
    };
  }

  async appendToNote({ fileId = null, name = null, folder = null, contentToAppend }) {
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');

    const existing = await this.readNote({ fileId, name, folder });
    const updatedContent = `${existing.content.trimEnd()}\n\n${contentToAppend}\n`;

    const res = await drive.files.update({
      fileId: existing.fileId,
      media: {
        mimeType: 'text/markdown',
        body: updatedContent,
      },
      fields: 'id, name, webViewLink',
    });

    this._vaultCache.timestamp = 0;
    const result = {
      fileId: res.data?.id || existing.fileId,
      fileName: res.data?.name || existing.fileName,
      content: updatedContent,
      webViewLink: res.data?.webViewLink,
    };

    const emb = this.embeddingService;
    if (emb && typeof emb.saveMemory === 'function') {
      this.indexNoteContentToVector({
        fileId: result.fileId,
        name: result.fileName,
        folder,
        content: updatedContent,
        embeddingService: emb,
      }).catch((err) => console.warn('[ObsidianDriveService RAG] Error indexando anexo en Drive:', err.message));
    }

    return result;
  }

  /**
   * Divide el contenido markdown en fragmentos de texto respetando párrafos y encabezados (~500 a 800 caracteres).
   */
  _chunkMarkdown(content, maxChunkLength = 800) {
    if (!content || typeof content !== 'string') return [];
    const paragraphs = content.split(/\n{2,}/);
    const chunks = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;
      if ((currentChunk.length + trimmed.length) > maxChunkLength && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
    }
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    return chunks;
  }

  /**
   * Vectoriza una nota específica hacia SemanticMemory con categoría 'OBSIDIAN'.
   */
  async indexNoteContentToVector({ fileId, name, folder = null, content = null, embeddingService = null, maxChunkLength = 800 } = {}) {
    const embService = embeddingService || this.embeddingService;
    if (!embService || typeof embService.saveMemory !== 'function') return;

    let body = content;
    if (!body) {
      const note = await this.readNote({ fileId, name, folder });
      body = note?.content;
    }
    if (!body) return;

    const chunks = this._chunkMarkdown(body, maxChunkLength);
    const cleanTitle = name ? name.replace(/\.md$/i, '') : 'Nota';

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = `[Nota: ${cleanTitle}] ${chunks[i]}`;
      await embService.saveMemory({
        content: chunkText,
        category: 'OBSIDIAN',
        metadata: {
          fileId,
          fileName: name,
          cleanTitle,
          folderPath: folder || '',
          chunkIndex: i,
          totalChunks: chunks.length,
        },
      });
    }
  }

  /**
   * Búsqueda Semántica de Notas en SemanticMemory
   */
  async searchNotesSemantic({ query, embeddingService = null, limit = 5 } = {}) {
    const embService = embeddingService || this.embeddingService;
    if (!embService || typeof embService.searchSimilarMemories !== 'function') {
      return this.searchNotes({ query, maxResults: limit });
    }
    return await embService.searchSimilarMemories(query, {
      category: 'OBSIDIAN',
      limit,
      minSimilarity: 0.50,
    });
  }
}

export const defaultObsidianDriveService = new ObsidianDriveService();


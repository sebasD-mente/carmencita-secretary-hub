import { DriveVaultClient } from './obsidian/drive-vault.client.js';
import { MarkdownSerializer, normalizeNoteTitle } from './obsidian/markdown-serializer.js';

export { normalizeNoteTitle };

/**
 * ObsidianDriveService - Fachada Compacta y Cohesiva para Obsidian Vault (Google Drive)
 * Estándar Deko Labs Enterprise: Arquitectura Desacoplada (Ticket [DEKO-CARMEN-M5])
 */
export class ObsidianDriveService {
  constructor({
    clientId, clientSecret, refreshToken, vaultFolderName, vaultFolderId,
    driveClient = null, cacheTtlMs, embeddingService = null, prisma = null,
    vaultClient = null, serializer = null,
  } = {}) {
    this.vaultClient = vaultClient || new DriveVaultClient({
      clientId, clientSecret, refreshToken, vaultFolderName, vaultFolderId, driveClient, cacheTtlMs,
    });
    this.serializer = serializer || new MarkdownSerializer();
    this.embeddingService = embeddingService;
    this.prisma = prisma;
  }

  // Getters/setters delegados para compatibilidad total hacia atrás
  get driveClient() { return this.vaultClient.driveClient; }
  set driveClient(val) { this.vaultClient.driveClient = val; }
  get _vaultCache() { return this.vaultClient._vaultCache; }
  set _vaultCache(val) { this.vaultClient._vaultCache = val; }
  get cachedSubfolderIds() { return this.vaultClient.cachedSubfolderIds; }
  get vaultFolderId() { return this.vaultClient.vaultFolderId; }
  set vaultFolderId(val) { this.vaultClient.vaultFolderId = val; }
  get vaultFolderName() { return this.vaultClient.vaultFolderName; }
  set vaultFolderName(val) { this.vaultClient.vaultFolderName = val; }
  get refreshToken() { return this.vaultClient.refreshToken; }
  set refreshToken(val) { this.vaultClient.refreshToken = val; }
  get clientId() { return this.vaultClient.clientId; }
  set clientId(val) { this.vaultClient.clientId = val; }
  get clientSecret() { return this.vaultClient.clientSecret; }
  set clientSecret(val) { this.vaultClient.clientSecret = val; }

  async _getDriveClient() { return this.vaultClient._getDriveClient(); }
  async getOrCreateVaultFolder() { return this.vaultClient.getOrCreateVaultFolder(); }
  async getOrCreateSubfolder(subfolderName) { return this.vaultClient.getOrCreateSubfolder(subfolderName); }
  async _buildVaultTree(opts) { return this.vaultClient._buildVaultTree(opts); }
  async listAllNotes(opts) { return this.vaultClient.listAllNotes(opts); }
  async searchNotes(opts) { return this.vaultClient.searchNotes(opts); }
  async deleteFile(fileId) { return this.vaultClient.deleteFile(fileId); }
  async readNote(opts = {}) { return this.vaultClient.readNote(opts); }

  _chunkMarkdown(content, maxChunkLength = 800) {
    return this.serializer.chunkMarkdown(content, maxChunkLength);
  }

  _formatNoteEntry(item, folder = '') {
    return {
      fileId: item.id,
      id: item.id,
      name: item.name,
      cleanTitle: item.cleanTitle || (item.name ? item.name.replace(/\.md$/i, '') : ''),
      folder: item.folderPath || item.folder || folder || '',
      folderPath: item.folderPath || item.folder || folder || '',
      relativePath: item.relativePath || item.name,
      webViewLink: item.webViewLink,
      modifiedTime: item.modifiedTime,
    };
  }

  async _clearPrismaChunks(fileId) {
    const prismaClient = this.embeddingService?.prisma || this.prisma;
    if (prismaClient && typeof prismaClient.$executeRawUnsafe === 'function') {
      try {
        await prismaClient.$executeRawUnsafe(`DELETE FROM "SemanticMemory" WHERE category = 'OBSIDIAN' AND metadata->>'fileId' = $1`, fileId);
      } catch {}
    }
  }

  async findNoteByNameOrTitle({ title, folder = null, fileId = null } = {}) {
    if (fileId && this.vaultClient._vaultCache?.files?.length > 0) {
      const found = this.vaultClient._vaultCache.files.find(f => f.id === fileId);
      if (found) return this._formatNoteEntry(found);
    }
    if (!title || typeof title !== 'string') return null;
    const normTarget = normalizeNoteTitle(title);
    if (!normTarget) return null;

    let files = [];
    try { files = await this.vaultClient._buildVaultTree(); } catch {}
    if ((!files || files.length === 0) && typeof this.searchNotes === 'function') {
      try { files = await this.searchNotes({ query: '', maxResults: 100 }); } catch {}
    }

    const normFolder = folder ? folder.toLowerCase().replace(/^\/+|\/+$/g, '') : null;
    let matched = files?.find(f => {
      if (normalizeNoteTitle(f.cleanTitle || f.name) !== normTarget) return false;
      if (!normFolder) return true;
      const fFolder = (f.folderPath || f.folder || '').toLowerCase().replace(/^\/+|\/+$/g, '');
      return fFolder === normFolder || fFolder.includes(normFolder) || (f.relativePath && f.relativePath.toLowerCase().includes(normFolder));
    });
    if (!matched && normFolder) {
      matched = files?.find(f => normalizeNoteTitle(f.cleanTitle || f.name) === normTarget);
    }
    if (matched) return this._formatNoteEntry(matched);

    const drive = await this._getDriveClient();
    if (drive) {
      try {
        let q = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
        if (folder) {
          const folderId = await this.getOrCreateSubfolder(folder);
          if (folderId) q += ` and '${folderId}' in parents`;
        }
        const res = await drive.files.list({ q, fields: 'files(id, name, webViewLink, modifiedTime, parents)', pageSize: 100 });
        const df = (res?.data?.files || []).find(f => normalizeNoteTitle(f.name) === normTarget);
        if (df) return this._formatNoteEntry(df, folder);
      } catch {}
    }
    return null;
  }

  async findNoteFuzzy(options) {
    return this.findNoteByNameOrTitle(options);
  }

  async updateNote({ fileId = null, title, content, folder = null, tags = [], wikilinks = [], overwrite = true } = {}) {
    let targetFileId = fileId, targetFolder = folder, fileName = null, webViewLink = null, canonicalTitle = null;
    if (!targetFileId) {
      const existing = await this.findNoteByNameOrTitle({ title, folder });
      if (existing) {
        targetFileId = existing.fileId || existing.id;
        fileName = existing.name;
        targetFolder = existing.folder || folder || '01_Inbox';
        webViewLink = existing.webViewLink;
        canonicalTitle = existing.cleanTitle || (existing.name ? existing.name.replace(/\.md$/i, '') : null);
      } else {
        return this.createNote({ title, content, folder: folder || '01_Inbox', tags, wikilinks, _skipDuplicateCheck: true });
      }
    } else {
      const existing = await this.findNoteByNameOrTitle({ fileId: targetFileId });
      if (existing) {
        canonicalTitle = existing.cleanTitle || (existing.name ? existing.name.replace(/\.md$/i, '') : null);
        fileName = existing.name;
        if (!targetFolder) targetFolder = existing.folder;
        if (!webViewLink) webViewLink = existing.webViewLink;
      }
    }

    const targetTitle = canonicalTitle || title || (fileName ? fileName.replace(/\.md$/i, '') : 'Nota');
    if (!fileName) fileName = this.serializer.sanitizeFileName(targetTitle);
    if (!targetFolder) targetFolder = '01_Inbox';

    const markdownBody = this.serializer.serializeNote({ title: targetTitle, content, folder: targetFolder, tags, wikilinks });
    const saved = await this.vaultClient.saveFile({ fileId: targetFileId, name: fileName, content: markdownBody });
    const result = {
      fileId: targetFileId,
      fileName: saved.name || fileName,
      folder: targetFolder,
      webViewLink: saved.webViewLink || webViewLink,
      rawContent: markdownBody,
      updated: true,
    };

    if (this.embeddingService?.saveMemory) {
      await this._clearPrismaChunks(targetFileId);
      this.indexNoteContentToVector({ fileId: result.fileId, name: result.fileName, folder: targetFolder, content: markdownBody })
        .catch(err => console.warn('[ObsidianDriveService RAG] Error re-indexando nota:', err.message));
    }
    return result;
  }

  async createNote({ title, content, folder = '01_Inbox', tags = [], wikilinks = [], _skipDuplicateCheck = false }) {
    if (!_skipDuplicateCheck) {
      const existing = await this.findNoteByNameOrTitle({ title, folder });
      if (existing) {
        return this.updateNote({ fileId: existing.fileId || existing.id, title, content, folder: existing.folder || folder, tags, wikilinks, overwrite: true });
      }
    }

    const targetFolderId = await this.getOrCreateSubfolder(folder);
    const fileName = this.serializer.sanitizeFileName(title);
    const markdownBody = this.serializer.serializeNote({ title, content, folder, tags, wikilinks });

    const saved = await this.vaultClient.saveFile({ name: fileName, folderId: targetFolderId, content: markdownBody });
    const result = {
      fileId: saved.fileId,
      fileName,
      folder,
      webViewLink: saved.webViewLink,
      rawContent: markdownBody,
    };

    if (this.embeddingService?.saveMemory) {
      this.indexNoteContentToVector({ fileId: result.fileId, name: fileName, folder, content: markdownBody })
        .catch(err => console.warn('[ObsidianDriveService RAG] Error indexando nota:', err.message));
    }
    return result;
  }

  async appendToNote({ fileId = null, name = null, folder = null, contentToAppend }) {
    const existing = await this.readNote({ fileId, name, folder });
    const updatedContent = `${existing.content.trimEnd()}\n\n${contentToAppend}\n`;

    const saved = await this.vaultClient.saveFile({ fileId: existing.fileId, content: updatedContent });
    const result = {
      fileId: saved.fileId || existing.fileId,
      fileName: saved.name || existing.fileName,
      content: updatedContent,
      webViewLink: saved.webViewLink,
    };

    if (this.embeddingService?.saveMemory) {
      this.indexNoteContentToVector({ fileId: result.fileId, name: result.fileName, folder, content: updatedContent })
        .catch(err => console.warn('[ObsidianDriveService RAG] Error indexando anexo:', err.message));
    }
    return result;
  }

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
      await embService.saveMemory({
        content: `[Nota: ${cleanTitle}] ${chunks[i]}`,
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

  async searchNotesSemantic({ query, embeddingService = null, limit = 5 } = {}) {
    const embService = embeddingService || this.embeddingService;
    if (!embService || typeof embService.searchSimilarMemories !== 'function') {
      return this.searchNotes({ query, maxResults: limit });
    }
    return await embService.searchSimilarMemories(query, { category: 'OBSIDIAN', limit, minSimilarity: 0.50 });
  }

  async syncVaultToVector({ embeddingService = null, force = false, limit = 100, onProgress = null } = {}) {
    const embService = embeddingService || this.embeddingService;
    if (!embService || typeof embService.saveMemory !== 'function') {
      throw new Error('EmbeddingService no configurado para sincronizar Obsidian Vault.');
    }

    const notes = await this.searchNotes({ query: '', maxResults: limit });
    if (!notes || notes.length === 0) {
      return { totalFound: 0, totalIndexed: 0, totalChunks: 0, errors: [] };
    }

    let totalIndexed = 0;
    let totalChunks = 0;
    const errors = [];

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      try {
        const noteData = await this.readNote({ fileId: note.id, name: note.name });
        const content = noteData?.content;
        if (!content || !content.trim()) continue;

        await this._clearPrismaChunks(note.id);

        const chunks = this._chunkMarkdown(content);
        const cleanTitle = note.name ? note.name.replace(/\.md$/i, '') : 'Nota';

        for (let c = 0; c < chunks.length; c++) {
          await embService.saveMemory({
            content: `[Nota: ${cleanTitle}] ${chunks[c]}`,
            category: 'OBSIDIAN',
            metadata: {
              fileId: note.id,
              fileName: note.name,
              cleanTitle,
              folderPath: note.folder || note.folderPath || '',
              chunkIndex: c,
              totalChunks: chunks.length,
            },
          });
          totalChunks++;
        }

        totalIndexed++;
        if (typeof onProgress === 'function') {
          onProgress({ current: i + 1, total: notes.length, noteName: note.name, chunksCount: chunks.length });
        }
      } catch (err) {
        console.warn(`[ObsidianDriveService] Error sincronizando nota "${note.name}":`, err.message);
        errors.push({ noteName: note.name, error: err.message });
      }
    }

    return { totalFound: notes.length, totalIndexed, totalChunks, errors };
  }
}

export const defaultObsidianDriveService = new ObsidianDriveService();

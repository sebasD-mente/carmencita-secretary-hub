import { config } from '../../config.js';
import { matchesSearchTerm } from './markdown-serializer.js';

/**
 * DriveVaultClient - Cliente I/O contra Google Drive API para Obsidian Vault
 * Estándar Deko Labs Enterprise: Robusto, Profesional y Escalable
 * Ticket: [DEKO-CARMEN-M5]
 */
export class DriveVaultClient {
  constructor({
    clientId = config.google?.clientId,
    clientSecret = config.google?.clientSecret,
    refreshToken = config.google?.refreshToken,
    vaultFolderName = config.obsidian?.vaultFolderName || 'vault',
    vaultFolderId = config.obsidian?.vaultFolderId || '',
    driveClient = null,
    cacheTtlMs = 5 * 60 * 1000,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.vaultFolderName = vaultFolderName;
    this.vaultFolderId = vaultFolderId || null;
    this.driveClient = driveClient;
    this.cachedSubfolderIds = new Map();
    this._vaultCache = { timestamp: 0, files: [], folders: new Map() };
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
      console.warn('[DriveVaultClient] Google Drive API no disponible:', err.message);
      return null;
    }
  }

  invalidateCache() {
    this._vaultCache.timestamp = 0;
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
    if (search?.data?.files?.[0]) {
      this.vaultFolderId = search.data.files[0].id;
      return this.vaultFolderId;
    }

    const created = await drive.files.create({
      requestBody: { name: this.vaultFolderName, mimeType: 'application/vnd.google-apps.folder', parents: ['root'] },
      fields: 'id, name',
    });
    this.vaultFolderId = created?.data?.id;
    return this.vaultFolderId;
  }

  async getOrCreateSubfolder(subfolderName) {
    const rootId = await this.getOrCreateVaultFolder();
    if (!subfolderName || subfolderName === '.' || subfolderName === '/') return rootId;
    const norm = subfolderName.replace(/^\/+|\/+$/g, '');
    if (this._vaultCache?.folders?.has(norm)) return this._vaultCache.folders.get(norm);
    if (this.cachedSubfolderIds.has(norm)) return this.cachedSubfolderIds.get(norm);

    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado');

    let currentParentId = rootId;
    let accumulatedPath = '';
    for (const segment of norm.split('/').filter(Boolean)) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
      if (this.cachedSubfolderIds.has(accumulatedPath)) {
        currentParentId = this.cachedSubfolderIds.get(accumulatedPath);
        continue;
      }
      const search = await drive.files.list({
        q: `'${currentParentId}' in parents and name = '${segment.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 1,
      });
      if (search?.data?.files?.[0]) {
        currentParentId = search.data.files[0].id;
      } else {
        const created = await drive.files.create({
          requestBody: { name: segment, mimeType: 'application/vnd.google-apps.folder', parents: [currentParentId] },
          fields: 'id, name',
        });
        currentParentId = created?.data?.id;
      }
      this.cachedSubfolderIds.set(accumulatedPath, currentParentId);
      this._vaultCache?.folders?.set(accumulatedPath, currentParentId);
    }
    return currentParentId;
  }

  async _buildVaultTree({ forceRefresh = false } = {}) {
    const valid = !forceRefresh && (Date.now() - this._vaultCache.timestamp < this._cacheTtlMs) && this._vaultCache.files.length > 0;
    if (valid) return this._vaultCache.files;

    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');
    const rootFolderId = await this.getOrCreateVaultFolder();

    const collectedFiles = [];
    const collectedFoldersMap = new Map([['', rootFolderId]]);
    const visitedFolders = new Set([rootFolderId]);
    const queue = [{ folderId: rootFolderId, folderPath: '' }];

    while (queue.length > 0) {
      const { folderId, folderPath } = queue.shift();
      let pageToken = null;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)',
          pageSize: 100,
          pageToken: pageToken || undefined,
        });
        for (const item of (res?.data?.files || [])) {
          if (item.mimeType === 'application/vnd.google-apps.folder') {
            if (item.name?.startsWith('.obsidian') || visitedFolders.has(item.id)) continue;
            visitedFolders.add(item.id);
            const childPath = folderPath ? `${folderPath}/${item.name}` : item.name;
            collectedFoldersMap.set(childPath, item.id);
            this.cachedSubfolderIds.set(childPath, item.id);
            queue.push({ folderId: item.id, folderPath: childPath });
          } else if ((item.name?.endsWith('.md') || item.mimeType?.includes('text')) && !item.name?.startsWith('.obsidian')) {
            collectedFiles.push({
              id: item.id,
              name: item.name,
              cleanTitle: item.name.replace(/\.md$/i, ''),
              relativePath: folderPath ? `${folderPath}/${item.name}` : item.name,
              folderPath,
              modifiedTime: item.modifiedTime,
              webViewLink: item.webViewLink,
            });
          }
        }
        pageToken = res?.data?.nextPageToken;
      } while (pageToken);
    }

    this._vaultCache = { timestamp: Date.now(), files: collectedFiles, folders: collectedFoldersMap };
    return collectedFiles;
  }

  async listAllNotes({ folder = null, maxResults = 50 } = {}) {
    const files = await this._buildVaultTree();
    let result = files.filter(f => !f.folderPath?.includes('.obsidian') && !f.relativePath?.includes('.obsidian/'));
    if (folder && folder.trim()) {
      const target = folder.trim().toLowerCase();
      result = result.filter(f => (f.folderPath && f.folderPath.toLowerCase().includes(target)) || (f.relativePath && f.relativePath.toLowerCase().includes(target)));
    }
    result.sort((a, b) => (a.modifiedTime && b.modifiedTime ? new Date(b.modifiedTime) - new Date(a.modifiedTime) : (a.name || '').localeCompare(b.name || '')));
    return result.slice(0, maxResults);
  }

  async searchNotes({ query = '', folder = null, maxResults = 20 } = {}) {
    const clean = (query || '').trim();
    const norm = clean.toLowerCase();
    const isGeneric = !clean || ['reporte', 'resumen', 'notas', 'todas', 'todo', 'general', 'lista', 'listado', 'boveda', 'bóveda', 'segundo cerebro', 'obsidian'].includes(norm);
    if (isGeneric) return this.listAllNotes({ folder, maxResults });

    const files = await this._buildVaultTree();
    const terms = norm.split(/\s+/).filter(Boolean);
    const targetFolder = folder?.trim().toLowerCase();

    let matched = files.filter(f => {
      if (f.folderPath?.includes('.obsidian') || f.relativePath?.includes('.obsidian/')) return false;
      if (targetFolder && !f.folderPath?.toLowerCase().includes(targetFolder) && !f.relativePath?.toLowerCase().includes(targetFolder)) return false;
      const title = (f.cleanTitle || '').toLowerCase();
      const path = (f.relativePath || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      if (title.includes(norm) || path.includes(norm) || name.includes(norm)) return true;
      return terms.length > 0 && terms.every(t => matchesSearchTerm(title, t) || matchesSearchTerm(path, t) || matchesSearchTerm(name, t));
    });

    matched.sort((a, b) => (a.modifiedTime && b.modifiedTime ? new Date(b.modifiedTime) - new Date(a.modifiedTime) : (a.name || '').localeCompare(b.name || '')));
    if (matched.length > 0) return matched.slice(0, maxResults);

    if (this._vaultCache.files.length === 0) {
      try {
        const drive = await this._getDriveClient();
        if (drive) {
          let q = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
          if (folder) {
            const folderId = await this.getOrCreateSubfolder(folder);
            if (folderId) q += ` and '${folderId}' in parents`;
          }
          q += ` and name contains '${clean.replace(/'/g, "\\'")}'`;
          const res = await drive.files.list({ q, fields: 'files(id, name, webViewLink, modifiedTime, parents)', pageSize: Math.max(maxResults, 20) });
          return res?.data?.files || [];
        }
      } catch (err) {
        console.warn('[DriveVaultClient] Fallback searchNotes error:', err.message);
      }
    }
    return [];
  }

  async readNote({ fileId = null, name = null, folder = null } = {}) {
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');
    let targetId = fileId, targetName = name;
    if (!targetId && name) {
      const found = await this.searchNotes({ query: name, folder, maxResults: 1 });
      if (found.length > 0) { targetId = found[0].id; targetName = found[0].name; }
    }
    if (!targetId) throw new Error(`Nota no encontrada${name ? `: ${name}` : ''}`);
    const res = await drive.files.get({ fileId: targetId, alt: 'media' });
    return {
      fileId: targetId,
      fileName: targetName,
      content: typeof res.data === 'string' ? res.data : JSON.stringify(res.data),
    };
  }

  async saveFile({ fileId = null, name, folderId = null, content }) {
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');
    if (fileId) {
      const res = await drive.files.update({
        fileId,
        media: { mimeType: 'text/markdown', body: content },
        fields: 'id, name, webViewLink, parents',
      });
      this.invalidateCache();
      return { fileId, name: res?.data?.name || name, webViewLink: res?.data?.webViewLink };
    }
    const res = await drive.files.create({
      requestBody: { name, mimeType: 'text/markdown', parents: folderId ? [folderId] : [] },
      media: { mimeType: 'text/markdown', body: content },
      fields: 'id, name, webViewLink, parents',
    });
    this.invalidateCache();
    return { fileId: res?.data?.id, name, webViewLink: res?.data?.webViewLink };
  }

  async deleteFile(fileId) {
    if (!fileId) throw new Error('fileId requerido para eliminar archivo');
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');
    if (typeof drive.files.delete === 'function') {
      await drive.files.delete({ fileId });
    } else {
      await drive.files.update({ fileId, requestBody: { trashed: true } });
    }
    this.invalidateCache();
    return true;
  }
}

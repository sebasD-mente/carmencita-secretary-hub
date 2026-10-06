import { config } from '../config.js';

export class ObsidianDriveService {
  constructor({
    clientId = config.google?.clientId,
    clientSecret = config.google?.clientSecret,
    refreshToken = config.google?.refreshToken,
    vaultFolderName = config.obsidian?.vaultFolderName || 'vault',
    vaultFolderId = config.obsidian?.vaultFolderId || '',
    driveClient = null,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.vaultFolderName = vaultFolderName;
    this.vaultFolderId = vaultFolderId || null;
    this.driveClient = driveClient;
    this.cachedSubfolderIds = new Map();
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
    if (this.cachedSubfolderIds.has(normalizedName)) {
      return this.cachedSubfolderIds.get(normalizedName);
    }

    const drive = await this._getDriveClient();
    const search = await drive.files.list({
      q: `'${rootId}' in parents and name = '${normalizedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
    });

    if (search?.data?.files && search.data.files.length > 0) {
      const folderId = search.data.files[0].id;
      this.cachedSubfolderIds.set(normalizedName, folderId);
      return folderId;
    }

    const created = await drive.files.create({
      requestBody: {
        name: normalizedName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootId],
      },
      fields: 'id, name',
    });

    const folderId = created?.data?.id;
    this.cachedSubfolderIds.set(normalizedName, folderId);
    return folderId;
  }

  async createNote({ title, content, folder = 'Inbox', tags = [], wikilinks = [] }) {
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

    return {
      fileId: createdFile?.data?.id,
      fileName,
      folder,
      webViewLink: createdFile?.data?.webViewLink,
      rawContent: markdownBody,
    };
  }

  async searchNotes({ query = '', folder = null, maxResults = 5 } = {}) {
    const drive = await this._getDriveClient();
    if (!drive) throw new Error('Google Drive no configurado para Obsidian');

    let q = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";

    if (folder) {
      const folderId = await this.getOrCreateSubfolder(folder);
      q += ` and '${folderId}' in parents`;
    }

    if (query && query.trim()) {
      const sanitized = query.trim().replace(/'/g, "\\'");
      q += ` and name contains '${sanitized}'`;
    } else {
      q += " and (name contains '.md' or mimeType = 'text/markdown' or mimeType = 'text/plain')";
    }

    const res = await drive.files.list({
      q,
      fields: 'files(id, name, webViewLink, modifiedTime, parents)',
      pageSize: maxResults,
    });

    return res?.data?.files || [];
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
}

export const defaultObsidianDriveService = new ObsidianDriveService();

import { Readable } from 'node:stream';
import { config } from '../config.js';

/**
 * 🏛️ GoogleDriveService - Servicio Soberano de Google Drive API v3
 * Desacoplado 100% de Obsidian Vault y de la memoria RAG de PostgreSQL.
 * Estándar Deko Labs Enterprise: Robusto, Profesional y Escalable.
 * Ticket: [DEKO-CARMEN-M6]
 */

export const OFFICIAL_DRIVE_FOLDERS = Object.freeze({
  comunicacion: '1YJYlmRu5lfGuBXQXA_CGecE4mWXFplEX',
  comunicados: '1YJYlmRu5lfGuBXQXA_CGecE4mWXFplEX',
  reportes: '1bfzr_VZ1hu8EP18AIYO_RNql4BgwNqht',
  custom_agents: '1y6Zo6iBOT-NbaeJjsR8ta4KJ6nGwiz3q',
});

export class GoogleDriveService {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.clientId]
   * @param {string} [options.clientSecret]
   * @param {string} [options.refreshToken]
   * @param {Object} [options.driveClient]
   */
  constructor({
    clientId = config.google?.clientId,
    clientSecret = config.google?.clientSecret,
    refreshToken = config.google?.refreshToken,
    driveClient = null,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.driveClient = driveClient;
    this.folderAliases = new Map(Object.entries(OFFICIAL_DRIVE_FOLDERS));
  }

  /**
   * Obtiene o inicializa el cliente oficial de Google Drive v3 con OAuth2.
   * @returns {Promise<Object>}
   */
  async _getDriveClient() {
    if (this.driveClient) return this.driveClient;
    if (!this.refreshToken) {
      throw new Error('Google Drive no configurado: Falta GOOGLE_REFRESH_TOKEN.');
    }
    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
      oauth2Client.setCredentials({ refresh_token: this.refreshToken });
      this.driveClient = google.drive({ version: 'v3', auth: oauth2Client });
      return this.driveClient;
    } catch (err) {
      console.error('[GoogleDriveService] Error inicializando cliente Drive v3:', err.message);
      throw err;
    }
  }

  /**
   * Resuelve alias oficiales (ej. 'comunicacion', 'reportes') o IDs directos de Google Drive.
   * @param {string} folderAliasOrId
   * @returns {string}
   */
  resolveFolderId(folderAliasOrId) {
    if (!folderAliasOrId || typeof folderAliasOrId !== 'string') {
      return OFFICIAL_DRIVE_FOLDERS.comunicacion;
    }
    const cleanKey = folderAliasOrId.trim().toLowerCase();
    if (this.folderAliases.has(cleanKey)) {
      return this.folderAliases.get(cleanKey);
    }
    return folderAliasOrId.trim();
  }

  /**
   * Lista archivos contenidos en una carpeta de Google Drive.
   * @param {Object} opts
   * @param {string} [opts.folder='comunicacion']
   * @param {number} [opts.maxResults=20]
   * @param {string} [opts.query]
   * @returns {Promise<Array<Object>>}
   */
  async listFiles({ folder = 'comunicacion', maxResults = 20, query = '' } = {}) {
    const drive = await this._getDriveClient();
    const folderId = this.resolveFolderId(folder);

    let q = `'${folderId}' in parents and trashed = false`;
    if (query && query.trim()) {
      const sanitized = query.replace(/'/g, "\\'");
      q += ` and (name contains '${sanitized}')`;
    }

    const res = await drive.files.list({
      q,
      pageSize: Math.min(maxResults || 20, 100),
      fields: 'files(id, name, mimeType, webViewLink, modifiedTime, size)',
      orderBy: 'modifiedTime desc',
    });

    return (res.data?.files || []).map((file) => ({
      fileId: file.id,
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      modifiedTime: file.modifiedTime,
      size: file.size ? Number(file.size) : null,
      folderId,
    }));
  }

  /**
   * Lee y descarga el contenido textual de un archivo en Drive.
   * @param {Object} opts
   * @param {string} [opts.fileId]
   * @param {string} [opts.name]
   * @param {string} [opts.folder='comunicacion']
   * @returns {Promise<{ fileId: string, name: string, content: string, mimeType: string }>}
   */
  async readFile({ fileId = null, name = null, folder = 'comunicacion' } = {}) {
    const drive = await this._getDriveClient();
    let targetFileId = fileId;
    let fileName = name;

    if (!targetFileId && fileName) {
      const folderId = this.resolveFolderId(folder);
      const searchRes = await drive.files.list({
        q: `'${folderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`,
        pageSize: 1,
        fields: 'files(id, name, mimeType)',
      });
      const found = searchRes.data?.files?.[0];
      if (!found) {
        throw new Error(`Archivo '${fileName}' no encontrado en la carpeta de Google Drive.`);
      }
      targetFileId = found.id;
      fileName = found.name;
    }

    if (!targetFileId) {
      throw new Error('Debe proporcionar fileId o name para leer un archivo en Google Drive.');
    }

    const res = await drive.files.get(
      { fileId: targetFileId, alt: 'media' },
      { responseType: 'text' }
    );

    let content = '';
    if (typeof res.data === 'string') {
      content = res.data;
    } else if (Buffer.isBuffer(res.data)) {
      content = res.data.toString('utf-8');
    } else if (res.data && typeof res.data === 'object') {
      content = JSON.stringify(res.data, null, 2);
    } else {
      content = String(res.data || '');
    }

    return {
      fileId: targetFileId,
      name: fileName || targetFileId,
      content,
      mimeType: res.headers?.['content-type'] || 'text/markdown',
    };
  }

  /**
   * Crea un archivo soberano en la carpeta especificada de Drive.
   * @param {Object} opts
   * @param {string} opts.name
   * @param {string} opts.content
   * @param {string} [opts.mimeType='text/markdown']
   * @param {string} [opts.folder='comunicacion']
   * @returns {Promise<Object>}
   */
  async createFile({ name, content, mimeType = 'text/markdown', folder = 'comunicacion' }) {
    if (!name || typeof name !== 'string') {
      throw new Error('El parámetro name es obligatorio para crear un archivo en Drive.');
    }
    const drive = await this._getDriveClient();
    const folderId = this.resolveFolderId(folder);

    const bodyStream = Readable.from([content || '']);
    const res = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId],
        mimeType,
      },
      media: {
        mimeType,
        body: bodyStream,
      },
      fields: 'id, name, mimeType, webViewLink, modifiedTime',
    });

    const file = res.data;
    return {
      fileId: file.id,
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      modifiedTime: file.modifiedTime,
      folderId,
    };
  }

  /**
   * Actualiza el contenido de un archivo existente en Drive in-place sin duplicar.
   * @param {Object} opts
   * @param {string} [opts.fileId]
   * @param {string} [opts.name]
   * @param {string} opts.content
   * @param {string} [opts.folder='comunicacion']
   * @param {string} [opts.mimeType='text/markdown']
   * @returns {Promise<Object>}
   */
  async updateFile({ fileId = null, name = null, content, folder = 'comunicacion', mimeType = 'text/markdown' }) {
    const drive = await this._getDriveClient();
    let targetFileId = fileId;
    let targetName = name;

    if (!targetFileId && targetName) {
      const folderId = this.resolveFolderId(folder);
      const searchRes = await drive.files.list({
        q: `'${folderId}' in parents and name = '${targetName.replace(/'/g, "\\'")}' and trashed = false`,
        pageSize: 1,
        fields: 'files(id, name, mimeType)',
      });
      const found = searchRes.data?.files?.[0];
      if (!found) {
        throw new Error(`Archivo '${targetName}' no encontrado para actualizar.`);
      }
      targetFileId = found.id;
    }

    if (!targetFileId) {
      throw new Error('Debe proporcionar fileId o name para actualizar un archivo en Drive.');
    }

    const bodyStream = Readable.from([content || '']);
    const res = await drive.files.update({
      fileId: targetFileId,
      media: {
        mimeType,
        body: bodyStream,
      },
      fields: 'id, name, mimeType, webViewLink, modifiedTime',
    });

    const file = res.data;
    return {
      fileId: file.id,
      id: file.id,
      name: file.name || targetName,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      modifiedTime: file.modifiedTime,
    };
  }

  /**
   * Mueve un archivo de una carpeta a otra en Drive.
   * @param {Object} opts
   * @param {string} opts.fileId
   * @param {string} opts.targetFolder
   * @returns {Promise<Object>}
   */
  async moveFile({ fileId, targetFolder }) {
    if (!fileId || !targetFolder) {
      throw new Error('Debe suministrar fileId y targetFolder para mover el archivo.');
    }
    const drive = await this._getDriveClient();
    const targetFolderId = this.resolveFolderId(targetFolder);

    const fileMeta = await drive.files.get({ fileId, fields: 'parents, name' });
    const previousParents = (fileMeta.data?.parents || []).join(',');

    const res = await drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents: previousParents,
      fields: 'id, name, parents, webViewLink',
    });

    return {
      fileId: res.data.id,
      name: res.data.name,
      targetFolderId,
      parents: res.data.parents,
      webViewLink: res.data.webViewLink,
    };
  }

  /**
   * Elimina un archivo permanentemente o lo envía a la papelera.
   * @param {string} fileId
   * @returns {Promise<{ success: boolean, fileId: string }>}
   */
  async deleteFile(fileId) {
    if (!fileId) throw new Error('fileId es requerido para eliminar un archivo.');
    const drive = await this._getDriveClient();
    await drive.files.delete({ fileId });
    return { success: true, fileId };
  }

  /**
   * Busca archivos en Drive por texto o coincidencia de nombre.
   * @param {Object} opts
   * @param {string} opts.query
   * @param {string} [opts.folder]
   * @param {number} [opts.maxResults=20]
   * @returns {Promise<Array<Object>>}
   */
  async searchFiles({ query, folder = null, maxResults = 20 } = {}) {
    return this.listFiles({ folder: folder || 'comunicacion', maxResults, query });
  }
}

export const defaultGoogleDriveService = new GoogleDriveService();
export const googleDriveService = defaultGoogleDriveService;

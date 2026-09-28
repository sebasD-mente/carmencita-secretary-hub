import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export class StorageProvider {
  constructor(opts = {}) {
    if (typeof opts === 'string') {
      this.baseDir = path.resolve(opts);
      this.bucketName = null;
      this.refreshToken = null;
      this.clientId = null;
      this.clientSecret = null;
      this.gcsClient = null;
    } else {
      this.baseDir = path.resolve(opts.baseDir || config.storageDir);
      this.bucketName = opts.bucketName ?? config.google?.bucketName ?? 'carmencita-vault-deko';
      this.refreshToken = opts.refreshToken ?? config.google?.refreshToken ?? null;
      this.clientId = opts.clientId ?? config.google?.clientId ?? null;
      this.clientSecret = opts.clientSecret ?? config.google?.clientSecret ?? null;
      this.gcsClient = opts.gcsClient || null;
    }

    this.documentsDir = path.join(this.baseDir, 'documents');
    this.invoicesDir = path.join(this.baseDir, 'facturas');
    this.exportsDir = path.join(this.baseDir, 'exports');
  }

  isCloudEnabled() {
    return Boolean(this.gcsClient || (this.refreshToken && this.bucketName));
  }

  async _getGcsClient() {
    if (this.gcsClient) return this.gcsClient;
    if (!this.refreshToken) return null;

    try {
      const { Storage } = await import('@google-cloud/storage');
      let authClient = null;

      if (this.clientId && this.clientSecret) {
        try {
          const { google } = await import('googleapis');
          const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
          oauth2Client.setCredentials({ refresh_token: this.refreshToken });
          authClient = oauth2Client;
        } catch (authErr) {
          console.warn('[StorageProvider] No se pudo inicializar OAuth2Client para GCS:', authErr.message);
        }
      }

      this.gcsClient = new Storage(authClient ? { authClient } : {});
      return this.gcsClient;
    } catch (err) {
      console.warn('[StorageProvider] @google-cloud/storage no disponible, usando fallback local:', err.message);
      return null;
    }
  }

  async init() {
    if (!this.isCloudEnabled()) {
      await fs.mkdir(this.baseDir, { recursive: true });
      await fs.mkdir(this.documentsDir, { recursive: true });
      await fs.mkdir(this.invoicesDir, { recursive: true });
      await fs.mkdir(this.exportsDir, { recursive: true });
    }
  }

  _sanitizeSlug(name) {
    return (name || 'archivo')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 40);
  }

  async saveFile({ buffer, originalName, mimeType = 'application/octet-stream', subDir = 'documents' }) {
    const ext = path.extname(originalName) || this._guessExtension(mimeType);
    const baseSlug = this._sanitizeSlug(path.basename(originalName, ext));
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const timestamp = Date.now();
    const fileName = `${timestamp}_${baseSlug}${ext}`;

    // 1. Desacoplamiento total: Subida directa a Google Cloud Storage
    if (this.isCloudEnabled()) {
      const gcs = await this._getGcsClient();
      if (gcs) {
        const objectPath = `${subDir}/${yearMonth}/${fileName}`;
        const bucket = gcs.bucket(this.bucketName);
        const file = bucket.file(objectPath);

        await file.save(buffer, {
          contentType: mimeType,
          resumable: false,
        });

        const gcsUri = `gs://${this.bucketName}/${objectPath}`;
        const cloudUrl = `https://storage.googleapis.com/${this.bucketName}/${objectPath}`;

        return {
          fileName,
          originalName,
          filePath: gcsUri,
          cloudUrl,
          publicUrl: cloudUrl,
          fileSize: buffer.length,
          mimeType,
          isCloud: true,
        };
      }
    }

    // 2. Fallback Seguro a Almacenamiento Local (Local/Test Mode)
    await this.init();
    const targetFolder = path.join(this.baseDir, subDir, yearMonth);
    await fs.mkdir(targetFolder, { recursive: true });

    const localFileName = `${now.toISOString().slice(0, 10)}_${baseSlug}_${timestamp}${ext}`;
    const absolutePath = path.join(targetFolder, localFileName);

    await fs.writeFile(absolutePath, buffer);
    const relativePath = path.relative(this.baseDir, absolutePath);

    return {
      fileName: localFileName,
      originalName,
      filePath: relativePath,
      absolutePath,
      fileSize: buffer.length,
      mimeType,
      isCloud: false,
    };
  }

  async readFile(filePath) {
    if (filePath && filePath.startsWith('gs://')) {
      const withoutPrefix = filePath.replace(/^gs:\/\//, '');
      const firstSlash = withoutPrefix.indexOf('/');
      const bucketName = firstSlash !== -1 ? withoutPrefix.slice(0, firstSlash) : this.bucketName;
      const objectPath = firstSlash !== -1 ? withoutPrefix.slice(firstSlash + 1) : withoutPrefix;

      const gcs = await this._getGcsClient();
      if (gcs) {
        const bucket = gcs.bucket(bucketName);
        const [contents] = await bucket.file(objectPath).download();
        return contents;
      }
      throw new Error(`No se pudo leer archivo de GCS: cliente no configurado para ${filePath}`);
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.baseDir, filePath);
    return await fs.readFile(absolutePath);
  }

  async deleteFile(filePath) {
    try {
      if (filePath && filePath.startsWith('gs://')) {
        const withoutPrefix = filePath.replace(/^gs:\/\//, '');
        const firstSlash = withoutPrefix.indexOf('/');
        const bucketName = firstSlash !== -1 ? withoutPrefix.slice(0, firstSlash) : this.bucketName;
        const objectPath = firstSlash !== -1 ? withoutPrefix.slice(firstSlash + 1) : withoutPrefix;

        const gcs = await this._getGcsClient();
        if (gcs) {
          const bucket = gcs.bucket(bucketName);
          await bucket.file(objectPath).delete({ ignoreNotFound: true });
          return true;
        }
        return false;
      }

      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.baseDir, filePath);
      await fs.unlink(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  _guessExtension(mimeType) {
    if (!mimeType) return '.bin';
    if (mimeType.includes('pdf')) return '.pdf';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
    if (mimeType.includes('png')) return '.png';
    if (mimeType.includes('spreadsheetml') || mimeType.includes('excel')) return '.xlsx';
    if (mimeType.includes('wordprocessingml') || mimeType.includes('word')) return '.docx';
    if (mimeType.includes('audio/ogg')) return '.ogg';
    if (mimeType.includes('audio/mp3') || mimeType.includes('audio/mpeg')) return '.mp3';
    return '.bin';
  }
}

export const defaultStorageProvider = new StorageProvider();

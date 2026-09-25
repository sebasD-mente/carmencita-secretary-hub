import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export class StorageProvider {
  constructor(baseDir = config.storageDir) {
    this.baseDir = path.resolve(baseDir);
    this.documentsDir = path.join(this.baseDir, 'documents');
    this.invoicesDir = path.join(this.baseDir, 'facturas');
    this.exportsDir = path.join(this.baseDir, 'exports');
  }

  async init() {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(this.documentsDir, { recursive: true });
    await fs.mkdir(this.invoicesDir, { recursive: true });
    await fs.mkdir(this.exportsDir, { recursive: true });
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
    await this.init();

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const targetFolder = path.join(this.baseDir, subDir, yearMonth);
    await fs.mkdir(targetFolder, { recursive: true });

    const ext = path.extname(originalName) || this._guessExtension(mimeType);
    const baseSlug = this._sanitizeSlug(path.basename(originalName, ext));
    const fileName = `${now.toISOString().slice(0, 10)}_${baseSlug}_${Date.now()}${ext}`;
    const absolutePath = path.join(targetFolder, fileName);

    await fs.writeFile(absolutePath, buffer);
    const relativePath = path.relative(this.baseDir, absolutePath);

    return {
      fileName,
      originalName,
      filePath: relativePath,
      absolutePath,
      fileSize: buffer.length,
      mimeType,
    };
  }

  async readFile(relativePath) {
    const absolutePath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(this.baseDir, relativePath);
    return await fs.readFile(absolutePath);
  }

  async deleteFile(relativePath) {
    try {
      const absolutePath = path.isAbsolute(relativePath)
        ? relativePath
        : path.join(this.baseDir, relativePath);
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

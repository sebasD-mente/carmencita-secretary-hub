import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

export class MediaService {
  constructor(baseDir = process.cwd()) {
    this.mediaDir = path.join(baseDir, 'data', 'media');
    this.qrDir = path.join(this.mediaDir, 'qr');
    this.perfilDir = path.join(this.mediaDir, 'perfil');
    this._ensureDirectories();
  }

  _ensureDirectories() {
    [this.mediaDir, this.qrDir, this.perfilDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  async generateQrCode({ text, title = 'Código QR', fileName = null }) {
    if (!text) throw new Error('El texto o URL para el QR es obligatorio');
    const safeName = fileName || `qr_${Date.now()}.png`;
    const filePath = path.join(this.qrDir, safeName);

    const buffer = await QRCode.toBuffer(text, {
      type: 'png',
      width: 600,
      margin: 2,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    await fs.promises.writeFile(filePath, buffer);

    return {
      filePath,
      buffer,
      fileName: safeName,
      title,
    };
  }

  resolveProfilePicture() {
    const candidates = [
      path.join(this.perfilDir, 'carmencita_profile.jpg'),
      path.join(this.perfilDir, 'avatar.jpg'),
      path.join(this.mediaDir, 'perfil', 'carmencita_profile.jpg'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return {
          filePath: p,
          fileName: path.basename(p),
          mimeType: 'image/jpeg',
        };
      }
    }
    return null;
  }
}

export const defaultMediaService = new MediaService();

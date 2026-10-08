import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { prisma as defaultPrisma } from '../core/prisma.js';
import { defaultObsidianDriveService } from './obsidian-drive.service.js';
import { defaultGmailService } from './gmail.service.js';
import { defaultCalendarService } from './calendar.service.js';
import { defaultGoogleTasksService } from './google-tasks.service.js';

export function sanitizeLogLine(line) {
  if (!line || typeof line !== 'string') return '';
  return line
    .replace(/AIza[0-9A-Za-z-_]{35,}/g, '[REDACTED_API_KEY]')
    .replace(/AQ\.[0-9A-Za-z-_]+/g, '[REDACTED_AUTH_KEY]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/refreshToken[=:]["']?[^"'\s&]+["']?/gi, 'refreshToken=[REDACTED]')
    .replace(/password[=:]["']?[^"'\s&]+["']?/gi, 'password=[REDACTED]');
}

export class DiagnosticsService {
  constructor({
    prisma,
    obsidianService,
    gmailService,
    calendarService,
    googleTasksService,
    logFilePath,
  } = {}) {
    this.prisma = prisma || defaultPrisma;
    this.obsidianService = obsidianService || defaultObsidianDriveService;
    this.gmailService = gmailService || defaultGmailService;
    this.calendarService = calendarService || defaultCalendarService;
    this.googleTasksService = googleTasksService || defaultGoogleTasksService;

    if (logFilePath) {
      this.logFilePath = logFilePath;
    } else if (fsSync.existsSync('/root/.pm2/logs/carmencita-hub-error-0.log')) {
      this.logFilePath = '/root/.pm2/logs/carmencita-hub-error-0.log';
    } else {
      this.logFilePath = process.env.PM2_ERROR_LOG_PATH || '/root/.pm2/logs/carmencita-hub-error.log';
    }
  }

  async getRecentErrorLogs(maxLines = 5) {
    try {
      const content = await fs.readFile(this.logFilePath, 'utf-8');
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      const slice = lines.slice(-maxLines);
      return slice.map((line) => sanitizeLogLine(line));
    } catch {
      return [];
    }
  }

  async checkDatabaseHealth() {
    const start = Date.now();
    try {
      if (this.prisma?.$queryRaw) {
        await this.prisma.$queryRaw`SELECT 1`;
      } else if (this.prisma?.$queryRawUnsafe) {
        await this.prisma.$queryRawUnsafe('SELECT 1');
      }
      return {
        status: 'CONNECTED',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 'ERROR',
        error: err.message,
        latencyMs: Date.now() - start,
      };
    }
  }

  checkGoogleWorkspaceApis() {
    const driveOk = Boolean(
      this.obsidianService && (this.obsidianService.refreshToken || this.obsidianService.driveClient)
    );
    const gmailOk = Boolean(
      this.gmailService && (
        typeof this.gmailService.isConfigured === 'function'
          ? this.gmailService.isConfigured()
          : (this.gmailService.refreshToken || this.gmailService.gmailClient)
      )
    );
    const calendarOk = Boolean(
      this.calendarService && (
        typeof this.calendarService.isConfigured === 'function'
          ? this.calendarService.isConfigured()
          : (this.calendarService.refreshToken || this.calendarService.calendarClient)
      )
    );
    const tasksOk = Boolean(
      this.googleTasksService && (
        typeof this.googleTasksService.isConfigured === 'function'
          ? this.googleTasksService.isConfigured()
          : true
      )
    );

    return {
      drive: driveOk,
      gmail: gmailOk,
      calendar: calendarOk,
      tasks: tasksOk,
    };
  }

  getProcessInfo() {
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeFormatted = `${hours > 0 ? `${hours}h ` : ''}${minutes}m ${seconds}s`;

    const mem = process.memoryUsage();
    return {
      status: 'ONLINE',
      pid: process.pid,
      nodeVersion: process.version,
      uptimeSeconds: uptimeSec,
      uptimeFormatted,
      memoryUsage: {
        rssMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
        heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
        heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
      },
    };
  }

  async getSystemStatus({ scope = 'full' } = {}) {
    const processInfo = this.getProcessInfo();
    const dbStatus = scope === 'pm2' ? null : await this.checkDatabaseHealth();
    const workspaceStatus = (scope === 'pm2' || scope === 'errors') ? null : this.checkGoogleWorkspaceApis();
    const recentErrors = scope === 'services' ? [] : await this.getRecentErrorLogs(5);

    const isHealthy = (!dbStatus || dbStatus.status === 'CONNECTED') && recentErrors.length === 0;

    return {
      timestamp: new Date().toISOString(),
      scope,
      status: isHealthy ? 'HEALTHY' : 'DEGRADED',
      process: processInfo,
      database: dbStatus,
      googleWorkspace: workspaceStatus,
      recentErrors,
    };
  }
}

export const defaultDiagnosticsService = new DiagnosticsService();

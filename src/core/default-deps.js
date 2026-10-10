import { prisma as defaultPrisma } from './prisma.js';
import { documentService as defaultDocService } from '../services/document.service.js';
import { taskService as defaultTaskService } from '../services/task.service.js';
import { ideaService as defaultIdeaService } from '../services/idea.service.js';
import { excelService as defaultExcelService } from '../services/excel.service.js';
import { defaultCalendarService } from '../services/calendar.service.js';
import { contactService as defaultContactService } from '../services/contact.service.js';
import { defaultGoogleTasksService } from '../services/google-tasks.service.js';
import { defaultEmbeddingService } from '../services/embedding.service.js';
import { defaultObsidianDriveService } from '../services/obsidian-drive.service.js';
import { defaultGoogleDriveService } from '../services/google-drive.service.js';
import { defaultGmailService } from '../services/gmail.service.js';
import { defaultVoiceService } from '../services/voice.service.js';
import { defaultMediaService } from '../services/media.service.js';
import { defaultDiagnosticsService } from '../services/diagnostics.service.js';

/**
 * Resuelve y vincula las dependencias por omisión del Carmencita Hub.
 */
export function resolveDefaultDeps(deps = {}) {
  return {
    prisma: deps?.prisma || defaultPrisma,
    documentService: deps?.documentService || defaultDocService,
    taskService: deps?.taskService || defaultTaskService,
    ideaService: deps?.ideaService || defaultIdeaService,
    excelService: deps?.excelService || defaultExcelService,
    calendarService: deps?.calendarService || defaultCalendarService,
    contactService: deps?.contactService || defaultContactService,
    googleTasksService: deps?.googleTasksService || defaultGoogleTasksService,
    embeddingService: deps?.embeddingService !== undefined ? deps.embeddingService : (deps?.prisma ? null : defaultEmbeddingService),
    obsidianService: deps?.obsidianService !== undefined ? deps.obsidianService : defaultObsidianDriveService,
    googleDriveService: deps?.googleDriveService !== undefined ? deps.googleDriveService : defaultGoogleDriveService,
    gmailService: deps?.gmailService !== undefined ? deps.gmailService : defaultGmailService,
    voiceService: deps?.voiceService !== undefined ? deps.voiceService : defaultVoiceService,
    mediaService: deps?.mediaService !== undefined ? deps.mediaService : defaultMediaService,
    diagnosticsService: deps?.diagnosticsService !== undefined ? deps.diagnosticsService : defaultDiagnosticsService,
  };
}

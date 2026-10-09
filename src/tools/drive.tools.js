import { z } from 'zod';

/**
 * 🛠️ Herramientas Desacopladas de Google Drive API v3 (manage_drive)
 * Estándar Deko Labs Enterprise: Cohesión y Segregación de Dominio.
 * Ticket: [DEKO-CARMEN-M6]
 */

export const DriveToolSchema = z.object({
  action: z.enum(['LIST', 'READ', 'CREATE', 'UPDATE', 'MOVE', 'DELETE', 'SEARCH']),
  name: z.string().optional(),
  content: z.string().optional(),
  folder: z.string().optional().default('comunicacion'),
  targetFolder: z.string().optional(),
  fileId: z.string().optional(),
  query: z.string().optional(),
  maxResults: z.coerce.number().optional().default(20),
});

/**
 * Handler centralizado para la ejecución de acciones en Google Drive.
 * @param {Object} service - Instancia de GoogleDriveService
 * @param {Object} args - Argumentos validados por DriveToolSchema
 * @returns {Promise<{ success: boolean, data: unknown }>}
 */
export async function handleDriveAction(service, args = {}) {
  if (!service) {
    throw new Error('Servicio de Google Drive soberano no disponible.');
  }

  const action = String(args.action || '').toUpperCase();

  switch (action) {
    case 'LIST': {
      const files = await service.listFiles({
        folder: args.folder,
        maxResults: args.maxResults || 20,
        query: args.query,
      });
      return {
        success: true,
        data: {
          action: 'LIST',
          folder: args.folder,
          count: files.length,
          files,
        },
      };
    }

    case 'READ': {
      const fileData = await service.readFile({
        fileId: args.fileId,
        name: args.name,
        folder: args.folder,
      });
      return {
        success: true,
        data: {
          action: 'READ',
          file: fileData,
        },
      };
    }

    case 'CREATE': {
      const created = await service.createFile({
        name: args.name,
        content: args.content || '',
        folder: args.folder,
      });
      return {
        success: true,
        data: {
          action: 'CREATE',
          file: created,
        },
      };
    }

    case 'UPDATE': {
      const updated = await service.updateFile({
        fileId: args.fileId,
        name: args.name,
        content: args.content || '',
        folder: args.folder,
      });
      return {
        success: true,
        data: {
          action: 'UPDATE',
          file: updated,
        },
      };
    }

    case 'MOVE': {
      const moved = await service.moveFile({
        fileId: args.fileId,
        targetFolder: args.targetFolder,
      });
      return {
        success: true,
        data: {
          action: 'MOVE',
          file: moved,
        },
      };
    }

    case 'DELETE': {
      const deleted = await service.deleteFile(args.fileId);
      return {
        success: true,
        data: {
          action: 'DELETE',
          result: deleted,
        },
      };
    }

    case 'SEARCH': {
      const searchResults = await service.searchFiles({
        query: args.query || args.name || '',
        folder: args.folder,
        maxResults: args.maxResults || 20,
      });
      return {
        success: true,
        data: {
          action: 'SEARCH',
          query: args.query || args.name || '',
          count: searchResults.length,
          files: searchResults,
        },
      };
    }

    default:
      throw new Error(`Acción de Google Drive no soportada: ${action}`);
  }
}

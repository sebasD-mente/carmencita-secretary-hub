import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleDriveService, OFFICIAL_DRIVE_FOLDERS } from '../src/services/google-drive.service.js';
import { handleDriveAction, DriveToolSchema } from '../src/tools/drive.tools.js';
import { ToolDispatcher } from '../src/tools/dispatcher.js';

test('🏛️ GoogleDriveService Soberano - Validación de Alias y Operaciones Directas', async (t) => {
  await t.test('1. Resolución de Alias Oficiales de Carpetas', () => {
    const service = new GoogleDriveService();

    assert.equal(service.resolveFolderId('comunicacion'), OFFICIAL_DRIVE_FOLDERS.comunicacion);
    assert.equal(service.resolveFolderId('comunicados'), OFFICIAL_DRIVE_FOLDERS.comunicacion);
    assert.equal(service.resolveFolderId('reportes'), OFFICIAL_DRIVE_FOLDERS.reportes);
    assert.equal(service.resolveFolderId('custom_agents'), OFFICIAL_DRIVE_FOLDERS.custom_agents);
    assert.equal(service.resolveFolderId('12345_CUSTOM_ID'), '12345_CUSTOM_ID');
    assert.equal(service.resolveFolderId(null), OFFICIAL_DRIVE_FOLDERS.comunicacion);
  });

  await t.test('2. listFiles: Lista archivos resolviendo carpetas y formateando campos', async () => {
    let capturedListQuery = null;
    const mockDrive = {
      files: {
        list: async (params) => {
          capturedListQuery = params.q;
          return {
            data: {
              files: [
                {
                  id: 'file_001',
                  name: 'COM_20261009_ERICK_A_FRED.md',
                  mimeType: 'text/markdown',
                  webViewLink: 'https://drive.google.com/file/d/file_001/view',
                  modifiedTime: '2026-10-09T15:58:00Z',
                  size: '11042',
                },
              ],
            },
          };
        },
      },
    };

    const service = new GoogleDriveService({ driveClient: mockDrive });
    const files = await service.listFiles({ folder: 'comunicacion', query: 'ERICK' });

    assert.equal(files.length, 1);
    assert.equal(files[0].fileId, 'file_001');
    assert.equal(files[0].name, 'COM_20261009_ERICK_A_FRED.md');
    assert.ok(capturedListQuery.includes(OFFICIAL_DRIVE_FOLDERS.comunicacion));
    assert.ok(capturedListQuery.includes('ERICK'));
  });

  await t.test('3. readFile: Lee y descarga contenido de archivo por fileId o nombre', async () => {
    const mockDrive = {
      files: {
        get: async ({ fileId, alt }) => {
          assert.equal(alt, 'media');
          return {
            data: `# Documento de prueba ${fileId}\nContenido soberano.`,
            headers: { 'content-type': 'text/markdown' },
          };
        },
        list: async () => ({
          data: { files: [{ id: 'file_search_123', name: 'TEST.md' }] },
        }),
      },
    };

    const service = new GoogleDriveService({ driveClient: mockDrive });

    // Lectura directa por ID
    const byId = await service.readFile({ fileId: 'doc_direct_id' });
    assert.equal(byId.fileId, 'doc_direct_id');
    assert.ok(byId.content.includes('doc_direct_id'));

    // Lectura resolviendo por nombre
    const byName = await service.readFile({ name: 'TEST.md', folder: 'comunicacion' });
    assert.equal(byName.fileId, 'file_search_123');
    assert.ok(byName.content.includes('file_search_123'));
  });

  await t.test('4. createFile: Crea archivo en la carpeta oficial designada', async () => {
    let capturedCreate = null;
    const mockDrive = {
      files: {
        create: async (params) => {
          capturedCreate = params;
          return {
            data: {
              id: 'file_new_999',
              name: params.requestBody.name,
              mimeType: params.requestBody.mimeType,
              webViewLink: 'https://drive.google.com/file/d/file_new_999/view',
              modifiedTime: '2026-10-09T16:00:00Z',
            },
          };
        },
      },
    };

    const service = new GoogleDriveService({ driveClient: mockDrive });
    const created = await service.createFile({
      name: 'PERFIL_TEST.md',
      content: '# Perfil Test',
      folder: 'reportes',
    });

    assert.equal(created.fileId, 'file_new_999');
    assert.equal(created.folderId, OFFICIAL_DRIVE_FOLDERS.reportes);
    assert.equal(capturedCreate.requestBody.parents[0], OFFICIAL_DRIVE_FOLDERS.reportes);
  });

  await t.test('5. updateFile: Actualiza in-place sin crear archivos duplicados', async () => {
    let capturedUpdate = null;
    const mockDrive = {
      files: {
        update: async (params) => {
          capturedUpdate = params;
          return {
            data: {
              id: params.fileId,
              name: 'EXISTING.md',
              mimeType: 'text/markdown',
              modifiedTime: '2026-10-09T16:05:00Z',
            },
          };
        },
      },
    };

    const service = new GoogleDriveService({ driveClient: mockDrive });
    const updated = await service.updateFile({
      fileId: 'file_existing_111',
      content: '# Contenido Actualizado',
    });

    assert.equal(updated.fileId, 'file_existing_111');
    assert.equal(capturedUpdate.fileId, 'file_existing_111');
  });

  await t.test('6. moveFile: Mueve archivo cambiando parents (addParents / removeParents)', async () => {
    let capturedMove = null;
    const mockDrive = {
      files: {
        get: async () => ({
          data: { id: 'file_movable', parents: ['old_parent_folder_id'] },
        }),
        update: async (params) => {
          capturedMove = params;
          return {
            data: {
              id: params.fileId,
              name: 'MOVED.md',
              parents: [params.addParents],
              webViewLink: 'https://drive.google.com/moved',
            },
          };
        },
      },
    };

    const service = new GoogleDriveService({ driveClient: mockDrive });
    const moved = await service.moveFile({
      fileId: 'file_movable',
      targetFolder: 'reportes',
    });

    assert.equal(moved.fileId, 'file_movable');
    assert.equal(capturedMove.addParents, OFFICIAL_DRIVE_FOLDERS.reportes);
    assert.equal(capturedMove.removeParents, 'old_parent_folder_id');
  });

  await t.test('7. deleteFile: Elimina archivo de Google Drive', async () => {
    let deletedId = null;
    const mockDrive = {
      files: {
        delete: async ({ fileId }) => {
          deletedId = fileId;
          return { data: {} };
        },
      },
    };

    const service = new GoogleDriveService({ driveClient: mockDrive });
    const res = await service.deleteFile('file_to_delete');
    assert.equal(res.success, true);
    assert.equal(deletedId, 'file_to_delete');
  });
});

test('🛠️ Herramienta manage_drive - Validación de Schema Zod y ToolDispatcher', async (t) => {
  await t.test('1. Validación de Esquema Zod DriveToolSchema', () => {
    const valid = DriveToolSchema.safeParse({ action: 'LIST', folder: 'comunicacion' });
    assert.ok(valid.success);
    assert.equal(valid.data.action, 'LIST');

    const invalid = DriveToolSchema.safeParse({ action: 'NON_EXISTENT_ACTION' });
    assert.ok(!invalid.success);
  });

  await t.test('2. ToolDispatcher: Despacha manage_drive exitosamente a través de GoogleDriveService', async () => {
    const mockDrive = {
      files: {
        list: async () => ({
          data: {
            files: [
              {
                id: 'drive_doc_42',
                name: 'COM_STATUS.md',
                mimeType: 'text/markdown',
              },
            ],
          },
        }),
      },
    };

    const googleDriveService = new GoogleDriveService({ driveClient: mockDrive });
    const dispatcher = new ToolDispatcher({ googleDriveService });

    const result = await dispatcher.dispatch('manage_drive', {
      action: 'LIST',
      folder: 'comunicacion',
    });

    assert.equal(result.success, true);
    assert.equal(result.data.action, 'LIST');
    assert.equal(result.data.count, 1);
    assert.equal(result.data.files[0].id, 'drive_doc_42');
  });

  await t.test('3. ToolDispatcher: Acción destructiva DELETE en manage_drive entra en Staging (HITL)', async () => {
    const googleDriveService = new GoogleDriveService();
    const dispatcher = new ToolDispatcher({ googleDriveService });

    assert.ok(dispatcher.isDestructiveAction('manage_drive', { action: 'DELETE' }));
    assert.ok(!dispatcher.isDestructiveAction('manage_drive', { action: 'LIST' }));
    assert.ok(!dispatcher.isDestructiveAction('manage_drive', { action: 'READ' }));

    const stagedResult = await dispatcher.dispatch(
      'manage_drive',
      { action: 'DELETE', fileId: 'important_file_id' },
      { isConfirmed: false }
    );

    assert.equal(stagedResult.status, 'staged');
    assert.equal(stagedResult.requiresConfirmation, true);
    assert.equal(stagedResult.action, 'DELETE_DRIVE_FILE');
  });
});

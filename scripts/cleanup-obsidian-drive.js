import { defaultObsidianDriveService, normalizeNoteTitle } from '../src/services/obsidian-drive.service.js';
import { prisma } from '../src/core/prisma.js';

/**
 * Script de Limpieza y Consolidación de Notas en Obsidian Vault (Google Drive)
 * - Identifica y elimina notas de 0 bytes (enlaces huérfanos generados por wikilinks).
 * - Identifica notas duplicadas (variaciones tipográficas o de guiones) y consolida en una versión oficial.
 *
 * @param {Object} options
 * @param {boolean} [options.dryRun=false] - Modo simulación sin borrado destructivo
 * @param {Object} [options.obsidianService] - Instancia de ObsidianDriveService
 * @param {Object} [options.driveClient] - Cliente Google Drive
 * @returns {Promise<{ zeroByteNotes: Array, duplicateGroups: Array, totalCleaned: number, dryRun: boolean }>}
 */
export async function cleanupObsidianDrive({
  dryRun = false,
  obsidianService = defaultObsidianDriveService,
  driveClient = null,
} = {}) {
  console.log(`🧹 [Cleanup Obsidian] Iniciando escaneo del Vault (Modo DryRun: ${dryRun ? 'SÍ' : 'NO'})...`);

  const drive = driveClient || (await obsidianService._getDriveClient());
  if (!drive) {
    throw new Error('Google Drive API no disponible o no configurada.');
  }

  const rootFolderId = await obsidianService.getOrCreateVaultFolder();
  if (!rootFolderId) {
    throw new Error('No se pudo acceder a la carpeta raíz del Obsidian Vault.');
  }

  // 1. Recorrido recursivo para obtener todos los archivos con su tamaño en bytes
  const allVaultFiles = [];
  const folderQueue = [{ folderId: rootFolderId, folderPath: '' }];

  while (folderQueue.length > 0) {
    const { folderId: currentFolderId, folderPath: currentFolderPath } = folderQueue.shift();
    let pageToken = null;

    do {
      const res = await drive.files.list({
        q: `'${currentFolderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)',
        pageSize: 100,
        pageToken: pageToken || undefined,
      });

      const files = res?.data?.files || [];
      for (const item of files) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          if (item.name === '.obsidian' || item.name?.startsWith('.obsidian')) {
            continue;
          }
          const childFolderPath = currentFolderPath ? `${currentFolderPath}/${item.name}` : item.name;
          folderQueue.push({ folderId: item.id, folderPath: childFolderPath });
        } else {
          const isMd = (item.name && item.name.toLowerCase().endsWith('.md')) ||
            item.mimeType === 'text/markdown' ||
            item.mimeType === 'text/plain';

          if (isMd && !currentFolderPath.startsWith('.obsidian')) {
            allVaultFiles.push({
              id: item.id,
              name: item.name,
              size: item.size !== undefined ? Number(item.size) : null,
              modifiedTime: item.modifiedTime,
              folderPath: currentFolderPath,
              webViewLink: item.webViewLink,
            });
          }
        }
      }

      pageToken = res?.data?.nextPageToken;
    } while (pageToken);
  }

  console.log(`📁 [Cleanup Obsidian] Total de notas .md escaneadas en el Vault: ${allVaultFiles.length}`);

  // 2. Detección y depuración de notas de 0 bytes (fantasmas huérfanas)
  const zeroByteNotes = [];
  const remainingFiles = [];

  for (const file of allVaultFiles) {
    let isZero = file.size === 0;

    // Si el tamaño reportado es null o 0, verificar contenido
    if (file.size === 0 || file.size === null) {
      try {
        const getRes = await drive.files.get({ fileId: file.id, alt: 'media' });
        const content = typeof getRes.data === 'string' ? getRes.data : '';
        if (content.trim().length === 0) {
          isZero = true;
        }
      } catch {
        // Si no se puede leer, confiar en file.size === 0
      }
    }

    if (isZero) {
      zeroByteNotes.push(file);
      console.log(`  🗑️ Detectada nota vacía (0 bytes): "${file.name}" (ID: ${file.id}) en /${file.folderPath}`);
      if (!dryRun) {
        try {
          if (typeof drive.files.delete === 'function') {
            await drive.files.delete({ fileId: file.id });
          } else {
            await drive.files.update({ fileId: file.id, requestBody: { trashed: true } });
          }
          console.log(`    ✅ Eliminada nota huérfana: "${file.name}"`);
        } catch (delErr) {
          console.warn(`    ⚠️ No se pudo eliminar "${file.name}":`, delErr.message);
        }
      }
    } else {
      remainingFiles.push(file);
    }
  }

  // 3. Detección y consolidación de notas duplicadas
  // Agrupar por clave normalizada (y carpeta si aplica, o consolidar variaciones de guiones en la misma carpeta)
  const groupsByNormalizedTitle = new Map();

  for (const file of remainingFiles) {
    const normKey = `${file.folderPath}::${normalizeNoteTitle(file.name)}`;
    if (!groupsByNormalizedTitle.has(normKey)) {
      groupsByNormalizedTitle.set(normKey, []);
    }
    groupsByNormalizedTitle.get(normKey).push(file);
  }

  const duplicateGroups = [];
  let totalDuplicatesRemoved = 0;

  for (const [key, filesGroup] of groupsByNormalizedTitle.entries()) {
    if (filesGroup.length > 1) {
      // Ordenar por fecha de modificación descendente (el más reciente es la versión oficial)
      filesGroup.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));

      const officialNote = filesGroup[0];
      const duplicates = filesGroup.slice(1);

      duplicateGroups.push({
        normalizedKey: key,
        official: officialNote,
        duplicates,
      });

      console.log(`\n  👥 Grupo duplicado detectado para "${key}":`);
      console.log(`    ⭐ Versión oficial (conservada): "${officialNote.name}" (ID: ${officialNote.id}, mod: ${officialNote.modifiedTime})`);

      for (const dup of duplicates) {
        console.log(`    ❌ Duplicado a remover: "${dup.name}" (ID: ${dup.id}, mod: ${dup.modifiedTime})`);
        if (!dryRun) {
          try {
            if (typeof drive.files.delete === 'function') {
              await drive.files.delete({ fileId: dup.id });
            } else {
              await drive.files.update({ fileId: dup.id, requestBody: { trashed: true } });
            }
            totalDuplicatesRemoved++;
            console.log(`      ✅ Eliminado duplicado con éxito: "${dup.name}"`);
          } catch (dupErr) {
            console.warn(`      ⚠️ No se pudo eliminar duplicado "${dup.name}":`, dupErr.message);
          }
        }
      }
    }
  }

  // Invalidar caché del Vault tras limpiezas
  if (!dryRun && (zeroByteNotes.length > 0 || totalDuplicatesRemoved > 0)) {
    if (obsidianService._vaultCache) {
      obsidianService._vaultCache.timestamp = 0;
    }
  }

  console.log('\n📊 [Cleanup Obsidian] Resumen de Limpieza:');
  console.log(`  • Notas vacías (0 bytes) encontradas: ${zeroByteNotes.length}`);
  console.log(`  • Grupos de duplicados detectados: ${duplicateGroups.length}`);
  console.log(`  • Duplicados eliminados: ${dryRun ? 0 : totalDuplicatesRemoved}`);
  console.log(`  • Modo de ejecución: ${dryRun ? 'SIMULACIÓN (dry-run)' : 'REAL (modificaciones aplicadas)'}\n`);

  return {
    totalScanned: allVaultFiles.length,
    zeroByteNotes,
    duplicateGroups,
    totalCleaned: zeroByteNotes.length + (dryRun ? 0 : totalDuplicatesRemoved),
    dryRun,
  };
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('cleanup-obsidian-drive.js') ||
  process.argv[1].endsWith('cleanup-obsidian-drive')
);

if (isMain) {
  cleanupObsidianDrive({ dryRun: process.argv.includes('--dry-run') })
    .then(() => {
      console.log('✅ [Cleanup Obsidian] Proceso finalizado.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ [Cleanup Obsidian] Error fatal:', err);
      process.exit(1);
    });
}

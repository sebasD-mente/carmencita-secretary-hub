import { defaultObsidianDriveService } from '../src/services/obsidian-drive.service.js';
import { defaultEmbeddingService } from '../src/services/embedding.service.js';
import { prisma } from '../src/core/prisma.js';

async function run() {
  console.log('🔄 [Obsidian RAG Sync] Iniciando barrido e indexación masiva del Vault...');
  const startTime = Date.now();

  try {
    await prisma.$connect();
    const result = await defaultObsidianDriveService.syncVaultToVector({
      embeddingService: defaultEmbeddingService,
      force: process.argv.includes('--force'),
      onProgress: ({ current, total, noteName, chunksCount }) => {
        console.log(`  [${current}/${total}] Vectorizada: "${noteName}" -> ${chunksCount} fragmentos`);
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n✅ [Obsidian RAG Sync] Sincronización completada con éxito.');
    console.log(`📊 Notas encontradas: ${result.totalFound}`);
    console.log(`📝 Notas indexadas: ${result.totalIndexed}`);
    console.log(`🧩 Chunks semánticos generados: ${result.totalChunks}`);
    if (result.errors.length > 0) {
      console.warn(`⚠️ Advertencias/Errores (${result.errors.length}):`, result.errors);
    }
    console.log(`⏱️ Tiempo transcurrido: ${elapsed}s`);
  } catch (err) {
    console.error('❌ [Obsidian RAG Sync] Error fatal durante la sincronización:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();

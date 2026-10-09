import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Matriz de Techos Dinámicos de Dominio (Deko Labs Mechanical Harness)
 */
export const DOMAIN_CEILINGS = {
  // Capa Core y Orquestación
  'src/core/brain.js': 350,
  'src/index.js': 250,

  // Capa de Herramientas Modulares (src/tools/)
  'src/tools/obsidian.tools.js': 280,
  'src/tools/workspace.tools.js': 400,
  'src/tools/system.tools.js': 200,
  'src/tools/media.tools.js': 220,
  'src/tools/documents.tools.js': 220,
  'src/tools/index.js': 220,

  // Capa de Servicios Especializados (src/services/)
  'src/services/obsidian-drive.service.js': 950,
  'src/services/gmail.service.js': 380,
  'src/services/calendar.service.js': 320,
  'src/services/task.service.js': 320,
  'src/services/google-tasks.service.js': 250,
  'src/services/embedding.service.js': 260,
  'src/services/document.service.js': 300,
  'src/services/voice.service.js': 260,
  'src/services/diagnostics.service.js': 200,
  'src/services/storage.provider.js': 260,
  'src/services/scheduler.service.js': 320,

  // Capa de Esquemas y Validadores Cohesivos
  'src/validators/actions.schema.js': 380,
  'src/routes/webhooks.js': 250,
};

export const LAYER_DEFAULT_CEILINGS = {
  'src/tools': 250,
  'src/services': 380,
  'src/routes': 250,
  'src/core': 350,
  'src/adapters': 400,
};

export function auditMonoliths({ baseDir = rootDir } = {}) {
  let violations = [];

  for (const [relPath, ceiling] of Object.entries(DOMAIN_CEILINGS)) {
    const fullPath = path.join(baseDir, relPath);
    if (!fs.existsSync(fullPath)) continue;

    const content = fs.readFileSync(fullPath, 'utf-8');
    const lineCount = content.split('\n').length;

    if (lineCount > ceiling) {
      violations.push({
        file: relPath,
        lines: lineCount,
        ceiling,
        excess: lineCount - ceiling,
      });
    }
  }

  return violations;
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('audit-monoliths.js') ||
  process.argv[1].endsWith('audit-monoliths')
);

if (isMain) {
  console.log('🛡️ [Mechanical Harness] Verificando techos dinámicos en Carmencita Hub...');
  const violations = auditMonoliths();

  if (violations.length > 0) {
    console.error('\n❌ VIOLACIÓN DE TECHOS DINÁMICOS DETECTADA (ARQUITECTURA COMPROMETIDA):');
    violations.forEach((v) => {
      console.error(`  • ${v.file}: ${v.lines} líneas (Techo máximo permitido: ${v.ceiling} líneas — Exceso: +${v.excess})`);
    });
    console.error('\nRegla de Oro: Desmantela el monolito en submódulos cohesivos antes de continuar.\n');
    process.exit(1);
  }

  console.log('✅ [Mechanical Harness] Todos los archivos cumplen estrictamente con los techos dinámicos de dominio.');
  process.exit(0);
}

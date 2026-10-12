import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * ⚡ [DEKO LABS] Escáner Estático de Sintaxis y Compilación Node.js
 * 
 * Ejecuta 'node --check' sobre todos los archivos JavaScript del proyecto.
 * Detecta errores de sintaxis, tokens rotos, imports inválidos y paréntesis desbalanceados
 * antes de tiempo de ejecución y antes de cualquier commit o despliegue.
 */

console.info('⚡ [DEKO LABS] Verificando sintaxis estricta de archivos JavaScript (node --check)...');

const rootDir = process.cwd();
const filesToVerify = [];

const IGNORED_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  '.vite',
  'coverage',
  '_archive',
  'historico',
  'scratch',
  'tmp',
  '.cache'
];

const JS_EXTENSIONS = /\.(js|mjs|cjs)$/i;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        scanDir(fullPath);
      }
    } else if (JS_EXTENSIONS.test(entry.name)) {
      filesToVerify.push(fullPath);
    }
  }
}

scanDir(rootDir);

let syntaxErrors = [];

for (const file of filesToVerify) {
  const relPath = path.relative(rootDir, file).replace(/\\/g, '/');
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf-8',
    env: process.env,
  });

  if (result.status !== 0) {
    syntaxErrors.push({
      file: relPath,
      error: (result.stderr || result.stdout || 'Error de sintaxis desconocido').trim()
    });
  }
}

if (syntaxErrors.length > 0) {
  console.error(`\n❌ ERROR CRÍTICO DE SINTAXIS DETECTADO: Se encontraron ${syntaxErrors.length} archivos con errores de sintaxis:`);
  syntaxErrors.forEach((err) => {
    console.error(`\n  • Archivo: ${err.file}`);
    console.error(`    Detalle:\n${err.error.split('\n').map(l => '      ' + l).join('\n')}`);
  });
  console.error('\n👉 Acción requerida: Repara los errores de sintaxis antes de continuar.\n');
  process.exit(1);
}

console.info(`✅ [DEKO LABS] Sintaxis 100% limpia y verificada en ${filesToVerify.length} archivos JavaScript.\n`);
process.exit(0);

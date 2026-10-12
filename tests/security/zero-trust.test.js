import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 🔒 [DEKO LABS] Suite de Seguridad Zero-Trust & Aislamiento Estricto
 * 
 * Corre con el test runner nativo de Node.js (node --test).
 * Cero dependencias externas pesadas.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

function getAllFiles(dir, extensions = ['.js', '.mjs', '.ts', '.jsx', '.tsx']) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (['node_modules', 'dist', 'build', '.git', 'coverage', '_archive', 'historico'].includes(file)) continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath, extensions));
    } else {
      if (extensions.some((ext) => file.endsWith(ext))) {
        results.push(filePath);
      }
    }
  }
  return results;
}

describe('🔒 Suite de Seguridad Zero-Trust & Aislamiento Estricto', () => {
  it('No deben existir correos personales en texto plano dentro del código backend', () => {
    // Escanea carpetas de backend si existen (server/, api/, lib/, etc.)
    const backendDirs = ['server', 'src', 'api', 'backend'].map(d => path.join(projectRoot, d));
    const violations = [];

    for (const bDir of backendDirs) {
      const files = getAllFiles(bDir);
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          // Detecta emails comunes hardcodeados
          if (/@(gmail|hotmail|yahoo|outlook)\.com/i.test(line) && !line.includes('// test-ignore') && !line.includes('// audit-ignore')) {
            violations.push({
              file: path.relative(projectRoot, file).replace(/\\/g, '/'),
              line: index + 1,
              content: line.trim(),
            });
          }
        });
      }
    }

    assert.equal(
      violations.length,
      0,
      `Se encontraron correos personales hardcodeados en el código:\n${JSON.stringify(violations, null, 2)}`
    );
  });

  it('No deben existir bypasses de autenticación de desarrollo (x-dev-role o devUser)', () => {
    const srcDir = path.join(projectRoot, 'src');
    const serverDir = path.join(projectRoot, 'server');
    const allFiles = [...getAllFiles(srcDir), ...getAllFiles(serverDir)];
    const violations = [];

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('x-dev-role') || content.includes('mockDevUser') || content.includes('devBypassAuth')) {
        violations.push(path.relative(projectRoot, file).replace(/\\/g, '/'));
      }
    }

    assert.equal(
      violations.length,
      0,
      `Se detectaron bypasses inseguros de desarrollo en los siguientes archivos:\n${JSON.stringify(violations, null, 2)}`
    );
  });

  it('El archivo .env nunca debe comitearse a Git (debe estar en .gitignore)', () => {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      const lines = gitignore.split('\n').map(l => l.trim());
      const hasEnv = lines.some(l => l === '.env' || l === '.env*' || l === '*.env' || l === '.env.local');
      assert.ok(hasEnv, 'El archivo .gitignore DEBE incluir .env para evitar fugas de secretos.');
    }
  });
});

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 🛡️ [DEKO LABS] ORQUESTADOR MAESTRO DEL ARNÉS MECÁNICO UNIVERSAL 2.0
 * 
 * Pipeline Coercitivo de 6 Fases Fail-Fast:
 * 1. Auditoría de Secretos y Zero-Trust (audit-secrets.js)
 * 2. Chequeo Estático de Sintaxis JS (audit-syntax.js)
 * 3. Verificación de Modelos Oficiales de IA (verify-gemini-models.js)
 * 4. Verificación de Techos Dinámicos de Dominio (audit-monoliths.js)
 * 5. Suite de Seguridad Zero-Trust (zero-trust.test.js)
 * 6. Suite de Pruebas Unitarias Fail-Fast (node --test)
 */

console.log('\n======================================================================');
console.log('🛡️  DEKO LABS — COMPUERTA MECÁNICA UNIVERSAL (harness:check)');
console.log('======================================================================\n');

const startTime = Date.now();
const rootDir = process.cwd();
const args = process.argv.slice(2);
const skipUnit = args.includes('--skip-unit');

const results = {
  secrets: 'PENDING',
  syntax: 'PENDING',
  models: 'PENDING',
  monoliths: 'PENDING',
  security: 'SKIPPED',
  tests: 'SKIPPED',
};

function runStep(name, cmd, cmdArgs = [], options = {}) {
  console.log(`▶️ Ejecutando Fase: ${name}...`);
  const stepStart = Date.now();
  const isWin = process.platform === 'win32';
  const resolvedCmd = (isWin && cmd === 'npm') ? 'npm.cmd' : cmd;
  const useShell = options.shell !== undefined ? options.shell : (isWin && (cmd === 'npm' || (typeof resolvedCmd === 'string' && resolvedCmd.endsWith('.cmd'))));

  const res = spawnSync(resolvedCmd, cmdArgs, {
    stdio: 'inherit',
    encoding: 'utf-8',
    env: process.env,
    cwd: rootDir,
    shell: useShell,
  });

  const duration = ((Date.now() - stepStart) / 1000).toFixed(2);

  if (res.error) {
    console.error(`💥 [Error del sistema]: ${res.error.message || res.error}`);
  }

  if (res.status !== 0) {
    console.error(`\n❌ [FALLO EN ARNÉS] La fase '${name}' ha fallado tras ${duration}s.`);
    console.error('🛑 RECHAZO COERCITIVO: Ningún commit o despliegue puede proceder.\n');
    process.exit(1);
  }

  console.log(`✅ [OK] Fase '${name}' superada con éxito (${duration}s).\n`);
  return true;
}

// 1. Auditoría de Secretos
if (fs.existsSync(path.join(rootDir, 'scripts', 'audit-secrets.js'))) {
  runStep('1/6: Auditoría de Secretos y Zero-Trust', process.execPath, ['scripts/audit-secrets.js']);
  results.secrets = 'PASS';
} else {
  console.warn('⚠️ scripts/audit-secrets.js no encontrado. Omitiendo.');
  results.secrets = 'SKIPPED';
}

// 2. Chequeo Estático de Sintaxis
if (fs.existsSync(path.join(rootDir, 'scripts', 'audit-syntax.js'))) {
  runStep('2/6: Chequeo Estático de Sintaxis (node --check)', process.execPath, ['scripts/audit-syntax.js']);
  results.syntax = 'PASS';
} else {
  console.warn('⚠️ scripts/audit-syntax.js no encontrado. Omitiendo.');
  results.syntax = 'SKIPPED';
}

// 3. Verificación de Modelos Oficiales de IA
if (fs.existsSync(path.join(rootDir, 'scripts', 'verify-gemini-models.js'))) {
  runStep('3/6: Verificación de Modelos Oficiales de Google Gemini', process.execPath, ['scripts/verify-gemini-models.js']);
  results.models = 'PASS';
} else {
  results.models = 'SKIPPED';
}

// 4. Techos Dinámicos de Dominio
if (fs.existsSync(path.join(rootDir, 'scripts', 'audit-monoliths.js'))) {
  runStep('4/6: Techos Dinámicos de Dominio (Anti-Ravioli)', process.execPath, ['scripts/audit-monoliths.js']);
  results.monoliths = 'PASS';
} else {
  console.warn('⚠️ scripts/audit-monoliths.js no encontrado. Omitiendo.');
  results.monoliths = 'SKIPPED';
}

// 5. Suite de Seguridad Zero-Trust
const securityTestPath = path.join(rootDir, 'tests', 'security', 'zero-trust.test.js');
if (fs.existsSync(securityTestPath)) {
  runStep('5/6: Suite de Seguridad Zero-Trust', process.execPath, ['--test', 'tests/security/zero-trust.test.js']);
  results.security = 'PASS';
} else {
  results.security = 'SKIPPED';
}

// 6. Suite de Pruebas Unitarias Fail-Fast
if (!skipUnit) {
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  } catch (e) {}

  if (pkg.scripts && pkg.scripts['test:unit']) {
    runStep('6/6: Suite de Pruebas Unitarias (npm run test:unit)', 'npm', ['run', 'test:unit']);
    results.tests = 'PASS';
  } else {
    const candidateDirs = ['test', 'tests'];
    let testFiles = [];
    for (const cDir of candidateDirs) {
      const fullDir = path.join(rootDir, cDir);
      if (fs.existsSync(fullDir)) {
        const found = fs.readdirSync(fullDir)
          .filter((file) => file.endsWith('.test.js'))
          .map((file) => path.join(cDir, file).replace(/\\/g, '/'));
        testFiles.push(...found);
      }
    }

    // Excluir zero-trust para no duplicar la ejecución de la fase 5
    testFiles = testFiles.filter((f) => !f.includes('zero-trust'));

    if (testFiles.length > 0) {
      runStep(`6/6: Suite de Pruebas Unitarias (${testFiles.length} suites)`, process.execPath, [
        '--test',
        '--test-concurrency=1',
        ...testFiles,
      ]);
      results.tests = 'PASS';
    } else {
      console.warn('⚠️ No se encontraron suites unitarias adicionales. Omitiendo.');
      results.tests = 'SKIPPED';
    }
  }
} else {
  console.log('⏩ [Flag --skip-unit activa] Omitiendo suite unitaria extendida.');
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('======================================================================');
console.log('🎉 ¡COMPUERTA MECÁNICA SUPERADA AL 100%! (CERTIFICADO DE CALIDAD)');
console.log('======================================================================');
console.log(`⏱️  Tiempo total de verificación: ${totalTime}s`);
console.log('📊 Recibo Mecánico Inmutable:');
console.log(JSON.stringify({
  status: 'HARNESS_PASS',
  framework: 'DEKO-LABS-MECHANICAL-HARNESS-2.0',
  results,
  totalTimeSeconds: parseFloat(totalTime),
  timestamp: new Date().toISOString(),
}, null, 2));
console.log('======================================================================\n');
process.exit(0);

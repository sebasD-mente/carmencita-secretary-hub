import fs from 'node:fs';
import path from 'node:path';

/**
 * 🔒 [DEKO LABS] Escáner Universal de Secretos & Auditoría Zero-Trust
 * 
 * Regla inquebrantable: Ningún secreto, API Key, correo personal o IP privada
 * puede vivir en texto plano dentro del código fuente de producción.
 */

console.info('🔒 [DEKO LABS] Ejecutando Auditoría Zero-Trust de Secretos y Aislamiento...');

const rootDir = process.cwd();
const filesToScan = [];

// Carpetas que deben excluirse del escaneo
const IGNORED_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '.next',
  '.vite',
  'coverage',
  '.agents',
  'tests',
  'test',
  'scripts',
  'scratch',
  '_archive',
  'historico',
  '.tempmediaStorage'
];

// Extensiones de código a inspeccionar
const SCANNABLE_EXTENSIONS = /\.(js|jsx|ts|tsx|json|mjs|cjs|vue|svelte)$/i;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        scanDir(fullPath);
      }
    } else if (SCANNABLE_EXTENSIONS.test(entry.name)) {
      filesToScan.push(fullPath);
    }
  }
}

scanDir(rootDir);

// Patrones universales de fuga de credenciales
const LEAK_PATTERNS = [
  { name: 'Google API Key Hardcodeada', regex: /AIza[0-9A-Za-z-_]{35}/ },
  { name: 'Google Studio AQ Key Hardcodeada', regex: /AQ\.[0-9A-Za-z-_]{20,}/ },
  { name: 'OpenAI Secret Key Hardcodeada', regex: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic API Key Hardcodeada', regex: /sk-ant-api[0-9A-Za-z-_]{30,}/ },
  { name: 'Stripe Secret Key Hardcodeada', regex: /sk_(live|test)_[0-9a-zA-Z]{24,}/ },
  { name: 'Token JWT Hardcodeado', regex: /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]{30,}/ },
  { name: 'Clave Privada RSA/SSH', regex: /-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----/ },
  { name: 'AWS Access Key ID Hardcodeada', regex: /(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/ },
  { name: 'Correo Personal Hardcodeado', regex: /@(gmail|hotmail|yahoo|outlook)\.com/i },
];

let leaksFound = 0;

for (const file of filesToScan) {
  const relPath = path.relative(rootDir, file).replace(/\\/g, '/');
  if (relPath.includes('env.example') || relPath.endsWith('package-lock.json')) continue;

  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    if (line.includes('// test-ignore') || line.includes('// audit-ignore')) return;

    for (const pattern of LEAK_PATTERNS) {
      if (pattern.regex.test(line)) {
        console.error(`\n🚨 [ALERTA DE SEGURIDAD ZERO-TRUST]`);
        console.error(`  Fuga o violación detectada: ${pattern.name}`);
        console.error(`  Archivo comprometido: ${relPath}:${index + 1}`);
        console.error(`  Línea: ${line.trim()}`);
        leaksFound++;
      }
    }
  });
}

if (leaksFound > 0) {
  console.error(`\n❌ Auditoría fallida: Se encontraron ${leaksFound} posibles fugas o credenciales expuestas.`);
  console.error(`👉 Acción requerida: Mueve estas credenciales a variables de entorno (.env) y valida con Zod.\n`);
  process.exit(1);
}

console.info(`✅ [DEKO LABS] Cero fugas o violaciones detectadas en ${filesToScan.length} archivos analizados.\n`);
process.exit(0);

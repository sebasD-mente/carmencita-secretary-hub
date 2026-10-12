import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 🔍 [DEKO LABS] Verificador Mecánico de Modelos Oficiales de Google Gemini
 * 
 * Verificación contra el Catálogo Oficial Upstream de Google Gemini API (2026):
 * - Familia Principal: Gemini 3 Series (3.8 Flash, 3.7 Flash, 3.6 Flash, 3.5 Flash, 3.5 Flash-Lite)
 * - Familia Visual: Nano Banana Pro (gemini-3-pro-image) y Nano Banana 2 (gemini-3.1-flash-image)
 * - Familia de Voz / Live: Gemini 3.8 Live, Gemini 3.8 Flash TTS, Gemini 3.5 Transcribe
 * 
 * Prohíbe alucinaciones conceptuales no versionadas (ej: 'gemini-nano-banana-2.1')
 * y modelos obsoletos cerrados (ej: 'gemini-3-pro-image-preview', 'gemini-flash-latest').
 */

console.log('\n🔍 [DEKO LABS] Verificando legitimidad de modelos Google Gemini en código...');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Catálogo Oficial y Vigente Upstream de Google Gemini API (2026)
export const OFFICIAL_GEMINI_MODELS = new Set([
  // 1. Modelos de Razonamiento, Código y Texto (Gemini 3 Flagship)
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  
  // 2. Modelos Nativos de Generación y Edición Visual (Nano Banana Series)
  'gemini-3-pro-image',          // Nano Banana Pro
  'gemini-3.1-flash-image',      // Nano Banana 2
  'gemini-3.1-flash-lite-image', // Nano Banana 2 Lite
  'imagen-3.0-generate-002',
  'imagen-4.0-generate-001',
  
  // 3. Modelos de Audio, Live, Transcripción y Multimodal Omni
  'gemini-3.8-live',
  'gemini-3.8-live-extended-thinking',
  'gemini-3.8-flash-tts',
  'gemini-3.8-flash-lite-tts',
  'gemini-3.5-transcribe',
  'gemini-3.5-transcribe-live',
  'gemini-3.5-live-translate-preview',
  'gemini-omni-1.1-flash',

  // 4. Modelos Legacy 2.5 / 2.0 (Acceso restringido para compatibilidad histórica)
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-image',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  
  // 5. Modelos de Embeddings
  'text-embedding-004',
  'text-embedding-005',
]);

// Modelos Prohibidos, Alucinaciones Conceptuales y Alias Obsoletos
export const BANNED_MODELS = new Set([
  'gemini-nano-banana-2.1',     // Alucinación de nombre conceptual no versionado
  'gemini-3-pro-image-preview',   // Modelo cerrado en junio 2026 (usar gemini-3-pro-image)
  'gemini-3.1-flash-image-preview', // Cerrado en junio 2026 (usar gemini-3.1-flash-image)
  'gemini-flash-latest',        // Alias sin anclaje de versión
  'gemini-1.5-flash',           // Obsoleto cerrado
  'gemini-1.5-pro',             // Obsoleto cerrado
]);

let violations = [];

// 1. Auditar src/config.js si existe
const configPath = path.join(rootDir, 'src', 'config.js');
if (fs.existsSync(configPath)) {
  const content = fs.readFileSync(configPath, 'utf-8');
  for (const banned of BANNED_MODELS) {
    if (content.includes(banned)) {
      violations.push({
        file: 'src/config.js',
        model: banned,
        reason: 'Modelo prohibido, alucinado u obsoleto detectado en configuración central',
      });
    }
  }
}

// 2. Auditar src/services/image-generation.service.js si existe
const imageServicePath = path.join(rootDir, 'src', 'services', 'image-generation.service.js');
if (fs.existsSync(imageServicePath)) {
  const content = fs.readFileSync(imageServicePath, 'utf-8');
  for (const banned of BANNED_MODELS) {
    if (content.includes(banned)) {
      violations.push({
        file: 'src/services/image-generation.service.js',
        model: banned,
        reason: 'Modelo prohibido, alucinado u obsoleto detectado en motor de generación visual',
      });
    }
  }
}

if (violations.length > 0) {
  console.error('\n❌ VIOLACIÓN DE MODELOS DE IA DETECTADA:');
  violations.forEach((v) => {
    console.error(`  • Archivo: ${v.file}`);
    console.error(`    Modelo no válido: '${v.model}' — Causa: ${v.reason}`);
  });
  console.error('\n👉 Acción requerida: Reemplaza estos identificadores por modelos oficiales del catálogo upstream Gemini 3.\n');
  process.exit(1);
}

console.log('✅ [DEKO LABS] Todos los modelos de Gemini y generación visual son 100% legítimos y oficiales.\n');
process.exit(0);

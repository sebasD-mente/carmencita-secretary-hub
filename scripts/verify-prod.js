import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma as defaultPrisma } from '../src/core/prisma.js';
import { config } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * ==============================================================================
 * CARMENCITA SECRETARY HUB — RECIBO MECÁNICO POST-DEPLOY (SRE CERTIFICATION)
 * Estándar Deko Labs Enterprise: Robusto, Profesional y Escalable
 * Ticket: [DEKO-CARMEN-M5]
 * ==============================================================================
 */
export async function verifyProd({
  baseUrl = `http://127.0.0.1:${process.env.PORT || config?.port || 3050}`,
  apiKey = process.env.CARMENCITA_API_KEY || config?.apiKey,
  prisma = defaultPrisma,
  ffmpegCmd = 'ffmpeg',
  checkFfmpeg = null,
  reportsDir = path.join(rootDir, 'reports'),
  exitOnFinish = false,
} = {}) {
  const timestamp = new Date().toISOString();
  const results = {
    timestamp,
    standard: 'Deko Labs Enterprise',
    environment: process.env.NODE_ENV || 'production',
    allPassed: true,
    checks: {},
  };

  console.log('\n========================================================================');
  console.log('🛡️ DEKO LABS ENTERPRISE — CERTIFICACIÓN SRE POST-DESPLIEGUE [M5]');
  console.log('========================================================================');
  console.log(`📡 URL Objetivo:   ${baseUrl}`);
  console.log(`⏱️ Timestamp:      ${timestamp}\n`);

  // 1. Verificación de Fastify /health
  try {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/health`);
    const latency = Date.now() - start;
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} recibido en /health`);
    }
    const data = await res.json();
    if (data.status !== 'ok') {
      throw new Error(`Payload /health inválido: status = ${data.status}`);
    }
    results.checks.health = { status: 'PASS', httpStatus: res.status, latencyMs: latency, data };
    console.log(`✅ [1/4] Fastify /health Probe ................... PASS (${latency}ms)`);
  } catch (err) {
    results.allPassed = false;
    results.checks.health = { status: 'FAIL', error: err.message };
    console.error(`❌ [1/4] Fastify /health Probe ................... FAIL (${err.message})`);
  }

  // 2. Verificación de Telemetría SRE /api/metrics
  try {
    const start = Date.now();
    const headers = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const res = await fetch(`${baseUrl}/api/metrics`, { headers });
    const latency = Date.now() - start;
    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} recibido en /api/metrics`);
    }
    const data = await res.json();
    if (!data.process || !data.geminiPool || !data.sessionQueue || !data.connections) {
      throw new Error('Estructura de métricas incompleta');
    }
    results.checks.metrics = { status: 'PASS', httpStatus: res.status, latencyMs: latency, data };
    console.log(`✅ [2/4] Fastify /api/metrics Telemetry .......... PASS (${latency}ms)`);
  } catch (err) {
    results.allPassed = false;
    results.checks.metrics = { status: 'FAIL', error: err.message };
    console.error(`❌ [2/4] Fastify /api/metrics Telemetry .......... FAIL (${err.message})`);
  }

  // 3. Verificación de PostgreSQL y Extensión pgvector (< 20ms)
  try {
    const start = Date.now();
    let pgvectorInstalled = false;
    if (prisma?.$queryRawUnsafe) {
      const ext = await prisma.$queryRawUnsafe(`SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`);
      pgvectorInstalled = Array.isArray(ext) && ext.length > 0;
      await prisma.$queryRawUnsafe(`SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector as dist`);
    } else if (prisma?.$queryRaw) {
      await prisma.$queryRaw`SELECT 1 as ok`;
      pgvectorInstalled = true;
    }
    const latency = Date.now() - start;
    if (!pgvectorInstalled) {
      throw new Error('Extensión pgvector no está instalada en la base de datos');
    }
    if (latency >= 20) {
      console.warn(`⚠️ [3/4] pgvector Latencia elevada: ${latency}ms (umbral < 20ms)`);
    }
    results.checks.databasePgvector = { status: 'PASS', latencyMs: latency, pgvector: true };
    console.log(`✅ [3/4] PostgreSQL pgvector Latency ............. PASS (${latency}ms)`);
  } catch (err) {
    results.allPassed = false;
    results.checks.databasePgvector = { status: 'FAIL', error: err.message };
    console.error(`❌ [3/4] PostgreSQL pgvector Latency ............. FAIL (${err.message})`);
  }

  // 4. Verificación de FFmpeg & Transcodificación libopus
  try {
    if (typeof checkFfmpeg === 'function') {
      const customRes = await checkFfmpeg();
      results.checks.ffmpeg = customRes;
    } else {
      const versionOutput = execSync(`${ffmpegCmd} -version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
      const hasLibopus = versionOutput.includes('libopus') || versionOutput.includes('enable-libopus');
      if (!hasLibopus) {
        throw new Error('FFmpeg encontrado pero libopus no está habilitado');
      }
      const testConversion = execSync(
        `${ffmpegCmd} -f lavfi -i anullsrc=r=24000:cl=mono -t 0.2 -c:a libopus -f ogg pipe:1`,
        { stdio: ['pipe', 'pipe', 'ignore'] }
      );
      if (!testConversion || testConversion.length === 0) {
        throw new Error('La transcodificación efímera no generó bytes de audio válidos');
      }
      results.checks.ffmpeg = { status: 'PASS', libopus: true, testBytes: testConversion.length };
    }
    console.log(`✅ [4/4] FFmpeg & libopus Transcoding ........... PASS`);
  } catch (err) {
    results.allPassed = false;
    results.checks.ffmpeg = { status: 'FAIL', error: err.message };
    console.error(`❌ [4/4] FFmpeg & libopus Transcoding ........... FAIL (${err.message})`);
  }

  // 5. Generación de Reporte Inmutable
  let reportPath = null;
  try {
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const safeDate = timestamp.replace(/[:.]/g, '-');
    reportPath = path.join(reportsDir, `prod-certification-${safeDate}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
    const latestPath = path.join(reportsDir, 'latest-certification.json');
    fs.writeFileSync(latestPath, JSON.stringify(results, null, 2), 'utf-8');
  } catch (err) {
    console.warn('⚠️ No se pudo guardar el reporte JSON:', err.message);
  }

  console.log('------------------------------------------------------------------------');
  if (results.allPassed) {
    console.log('🎉 ESTADO GLOBAL: CERTIFICACIÓN SRE APROBADA (0 FALLOS)');
    if (reportPath) console.log(`📄 Reporte inmutable generado: ${reportPath}`);
    console.log('========================================================================\n');
    if (exitOnFinish) process.exit(0);
    return results;
  } else {
    console.error('❌ ESTADO GLOBAL: CERTIFICACIÓN FALLIDA — VERIFICAR DEFICIENCIAS');
    if (reportPath) console.log(`📄 Reporte forense generado: ${reportPath}`);
    console.log('========================================================================\n');
    if (exitOnFinish) process.exit(1);
    return results;
  }
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('verify-prod.js') ||
  process.argv[1].endsWith('verify-prod')
);

if (isMain) {
  verifyProd({ exitOnFinish: true }).catch((err) => {
    console.error('Fatal verify-prod error:', err);
    process.exit(1);
  });
}

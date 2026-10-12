import fs from 'node:fs';
import path from 'node:path';

/**
 * 🔒 [DEKO LABS] Instalador de Compuerta Git Hook (pre-push)
 * 
 * Instala un candado físico en .git/hooks/pre-push que ejecuta
 * automáticamente 'npm run harness:check' antes de permitir cualquier 'git push'.
 */

console.log('🔒 [DEKO LABS] Instalando compuerta Git Hook pre-push...');

const rootDir = process.cwd();
const gitDir = path.join(rootDir, '.git');

if (!fs.existsSync(gitDir)) {
  console.warn('⚠️ No se detectó repositorio .git en este directorio. Omitiendo instalación de hook.');
  process.exit(0);
}

const hooksDir = path.join(gitDir, 'hooks');
if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

const prePushScript = `#!/bin/sh
# ==============================================================================
# 🛡️ DEKO LABS — COMPUERTA GIT PRE-PUSH (BLOQUEO COERCITIVO INFRANQUEABLE)
# ==============================================================================
echo ""
echo "🛡️ [Deko Labs Git Hook] Verificando compuerta mecánica antes del push..."
npm run harness:check

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "🛑 ===================================================================="
  echo "❌ [Deko Labs Git Hook] PUSH RECHAZADO EN SECO (EXIT CODE $EXIT_CODE)"
  echo "===================================================================="
  echo "👉 El arnés mecánico detectó violaciones de sintaxis, secretos o tests."
  echo "👉 Repara la causa raíz antes de intentar enviar código a producción."
  echo "===================================================================="
  echo ""
  exit 1
fi

echo ""
echo "✅ [Deko Labs Git Hook] Compuerta superada con éxito. Procediendo con el push."
echo ""
exit 0
`;

const prePushPath = path.join(hooksDir, 'pre-push');
fs.writeFileSync(prePushPath, prePushScript, { mode: 0o755, encoding: 'utf-8' });

console.log(`✅ [OK] Compuerta pre-push instalada con éxito en: ${path.relative(rootDir, prePushPath)}`);
process.exit(0);

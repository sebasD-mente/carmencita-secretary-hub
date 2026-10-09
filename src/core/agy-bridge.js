import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Lista blanca estricta e inmutable de comandos de solo lectura para telemetría
const ALLOWED_TELEMETRY = Object.freeze({
  status: 'uptime -p && free -h && df -h /',
  docker: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"',
  system: 'hostname && uname -a && uptime -p',
});

const ALLOWED_TELEMETRY_WIN = Object.freeze({
  status: 'hostname; (Get-CimInstance Win32_OperatingSystem).Caption; (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB',
  docker: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"',
  system: 'hostname; (Get-CimInstance Win32_OperatingSystem).Caption',
});

/**
 * Sanitiza el prompt entrante para prevenir inyecciones de comandos shell
 * @param {string} prompt
 * @returns {string}
 */
export function sanitizeShellPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return '';
  return prompt
    .replace(/[;&|`]/g, ' ')
    .replace(/\$\([^)]*\)/g, '')
    .replace(/\$\{[^}]*\)/g, '')
    .trim();
}

function resolveWhitelistedTelemetry(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const p = prompt.trim().toLowerCase();

  let key = null;
  if (p === 'status' || /^(status|uptime|recursos|memoria|ram|disco|espacio|servidor|carga)$/i.test(p)) {
    key = 'status';
  } else if (p === 'docker' || /^(docker|contenedores?|containers?|dokploy)$/i.test(p)) {
    key = 'docker';
  } else if (p === 'system' || /^(system|sistema|hostname|uname|os|especificaciones)$/i.test(p)) {
    key = 'system';
  } else {
    for (const [k, cmd] of Object.entries(ALLOWED_TELEMETRY)) {
      if (prompt.trim() === cmd) {
        key = k;
        break;
      }
    }
  }

  if (!key) return null;
  return process.platform === 'win32' ? ALLOWED_TELEMETRY_WIN[key] : ALLOWED_TELEMETRY[key];
}

export class AgyBridge {
  constructor(binPath = config.ai.agyBinPath) {
    this.binPath = this._resolveAgyBinPath(binPath || process.env.AGY_BIN_PATH || '/root/.local/bin/agy');
    this.model = 'gemini-3.8-flash-low';
  }

  _resolveAgyBinPath(candidate) {
    if (candidate && fs.existsSync(candidate)) return candidate;
    if (candidate && candidate !== 'agy') return candidate;
    const commonPaths = ['/root/.local/bin/agy', '/usr/local/bin/agy', 'agy'];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }
    return candidate || '/root/.local/bin/agy';
  }

  async executeTask(prompt, { timeoutMs = 90000, model = this.model, cwd = process.cwd() } = {}) {
    // Restricción estricta de seguridad: Prohibido ejecutar comandos de sistema como usuario root (UID 0)
    if (typeof process.getuid === 'function' && process.getuid() === 0 && !process.env.ALLOW_ROOT_EXEC) {
      console.warn('[AGY Bridge Security] Bloqueo de seguridad: intento de ejecución como usuario root denegado.');
      return {
        success: false,
        mode: 'Security Guard',
        output: 'Ejecución denegada: no se permite la ejecución de tareas del sistema con privilegios de superusuario (root).',
      };
    }

    // Sanitización perimetral contra inyecciones de comandos shell (|, ;, &&, $(), backticks)
    const cleanPrompt = sanitizeShellPrompt(prompt);

    // Filtrado de comandos destructivos o de elevación de privilegios
    if (
      /\b(sudo|su\s+-|chmod\s+777|rm\s+-rf\s+\/|mkfs|shutdown|reboot)\b/i.test(prompt) ||
      /\b(sudo|su\s+-|chmod\s+777|rm\s+-rf\s+\/|mkfs|shutdown|reboot)\b/i.test(cleanPrompt)
    ) {
      console.warn(`[AGY Bridge Security] Bloqueo de seguridad: prompt contiene comandos no autorizados.`);
      return {
        success: false,
        mode: 'Security Guard',
        output: 'Ejecución denegada: comando no autorizado en la lista blanca de seguridad.',
      };
    }

    console.log(`🤖 [AGY Bridge] Despachando tarea a la terminal: "${cleanPrompt.slice(0, 80)}..."`);
    const args = [
      '-p',
      cleanPrompt,
      '--dangerously-skip-permissions',
      '--model',
      model,
    ];

    try {
      const { stdout, stderr } = await execFileAsync(this.binPath, args, {
        timeout: timeoutMs,
        cwd,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = stdout.trim() || stderr.trim();
      return {
        success: true,
        mode: 'AGY CLI',
        output: output || 'Tarea completada en la terminal sin salida visible.',
      };
    } catch (err) {
      // Si el binario AGY no existe (ENOENT), recurrir ÚNICAMENTE a comandos de lista blanca
      if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
        console.warn(`[AGY Bridge Security] '${this.binPath}' no encontrado. Evaluando lista blanca de telemetría...`);

        // Evaluación estricta de seguridad: CERO ejecución de comandos arbitrarios
        const safeCmd = resolveWhitelistedTelemetry(cleanPrompt);

        if (!safeCmd) {
          console.warn(`[AGY Bridge Security] Bloqueo de seguridad: prompt "${prompt}" no autorizado en lista blanca.`);
          return {
            success: false,
            mode: 'Security Guard',
            output: 'Ejecución denegada: comando no autorizado en la lista blanca de seguridad.',
          };
        }

        try {
          const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';

          const { stdout, stderr } = await execAsync(safeCmd, {
            timeout: timeoutMs,
            cwd,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
            shell,
          });

          const output = stdout.trim() || stderr.trim();
          return {
            success: true,
            mode: 'Telemetría Segura VPS (Whitelist)',
            output: output || 'Comando de telemetría completado sin salida.',
          };
        } catch (shellErr) {
          console.error('[AGY Bridge] Error ejecutando telemetría en lista blanca:', shellErr.message);
          return {
            success: false,
            mode: 'Telemetría Segura VPS',
            output: `Error al consultar telemetría: ${shellErr.message}`,
          };
        }
      }

      console.error('[AGY Bridge] Error ejecutando comando en terminal:', err.message);
      return {
        success: false,
        output: `Error al ejecutar la tarea en la terminal con AGY: ${err.message}`,
      };
    }
  }
}

export default AgyBridge;

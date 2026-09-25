import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export class AgyBridge {
  constructor(binPath = config.ai.agyBinPath) {
    this.binPath = binPath;
    this.model = 'gemini-3.8-flash-low';
  }

  async executeTask(prompt, { timeoutMs = 90000, model = this.model, cwd = process.cwd() } = {}) {
    console.log(`🤖 [AGY Bridge] Despachando tarea a la terminal: "${prompt.slice(0, 80)}..."`);
    const args = [
      '-p',
      prompt,
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
      // Si el binario AGY no existe en el sistema (ENOENT), ejecutar comando nativo en shell
      if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
        console.warn(`[AGY Bridge] '${this.binPath}' no encontrado. Ejecutando via Shell Nativo (Host VPS)...`);
        try {
          const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
          
          let cmd = prompt;
          const isGenericSystemQuery = /par[aá]metros del sistema|especificaciones|servidor|recursos|hostname/i.test(prompt) && !prompt.includes('&&') && !prompt.includes(';') && !prompt.includes('|');
          if (isGenericSystemQuery) {
            cmd = process.platform === 'win32'
              ? 'hostname; (Get-CimInstance Win32_OperatingSystem).Caption; (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB'
              : 'hostname && uname -a && uptime -p && free -h && df -h /';
          }

          const { stdout, stderr } = await execAsync(cmd, {
            timeout: timeoutMs,
            cwd,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
            shell,
          });
          const output = stdout.trim() || stderr.trim();
          return {
            success: true,
            mode: 'Shell Nativo VPS',
            output: output || 'Comando ejecutado con éxito sin salida.',
          };
        } catch (shellErr) {
          console.error('[AGY Bridge] Error ejecutando comando en Shell nativo:', shellErr.message);
          return {
            success: false,
            mode: 'Shell Nativo VPS',
            output: `Error al ejecutar en la terminal: ${shellErr.message}`,
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

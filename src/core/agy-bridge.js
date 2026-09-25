import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';

const execFileAsync = promisify(execFile);

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
        output: output || 'Tarea completada en la terminal sin salida visible.',
      };
    } catch (err) {
      console.error('[AGY Bridge] Error ejecutando comando en terminal:', err.message);
      return {
        success: false,
        output: `Error al ejecutar la tarea en la terminal con AGY: ${err.message}`,
      };
    }
  }
}

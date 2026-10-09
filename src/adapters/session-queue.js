/**
 * UserSessionQueue - Gestor de Concurrencia FIFO por Usuario en Memoria
 * Estándar: DeKo Labs Enterprise (Robusto, Profesional, Escalable)
 * 
 * Garantiza procesamiento secuencial estricto (First-In, First-Out) por usuario,
 * evitando condiciones de carrera, transacciones solapadas en PostgreSQL y colisiones de estado,
 * con aislamiento total entre diferentes usuarios y recolección de basura automática.
 */
export class UserSessionQueue {
  constructor() {
    // Map<string, Promise<unknown>> - Promesa tail de la cola activa por usuario
    this._userQueues = new Map();
    // Map<string, number> - Conteo de tareas pendientes y en ejecución por usuario
    this._queueLengths = new Map();
    // Métricas SRE de ciclo de vida
    this._totalEnqueued = 0;
    this._totalCompleted = 0;
    this._totalRejected = 0;
  }

  /**
   * Encola una tarea asíncrona para ser procesada secuencialmente (FIFO) por usuario.
   * Si la tarea anterior falla o tiene éxito, la siguiente se ejecuta sin bloquear la cola.
   *
   * @param {string|number} userId - Identificador único del usuario (ej: Telegram chat/user ID)
   * @param {() => Promise<any>|any} taskFn - Función asíncrona que ejecuta la tarea
   * @returns {Promise<any>} Promesa con el resultado de taskFn
   */
  async enqueue(userId, taskFn) {
    if (typeof taskFn !== 'function') {
      throw new TypeError('UserSessionQueue.enqueue: taskFn debe ser una función.');
    }

    this._totalEnqueued++;
    const key = String(userId || 'default');
    const currentPromise = this._userQueues.get(key) || Promise.resolve();
    const currentCount = this._queueLengths.get(key) || 0;
    this._queueLengths.set(key, currentCount + 1);

    const executeTask = async () => {
      try {
        const result = await taskFn();
        this._totalCompleted++;
        return result;
      } catch (err) {
        this._totalRejected++;
        throw err;
      } finally {
        const remainingCount = (this._queueLengths.get(key) || 1) - 1;
        if (remainingCount <= 0) {
          this._queueLengths.delete(key);
          this._userQueues.delete(key); // Garbage collection automática de cola vacía
        } else {
          this._queueLengths.set(key, remainingCount);
        }
      }
    };

    // El nuevo tail se encadena independientemente de si la tarea anterior falló o tuvo éxito
    const nextPromise = currentPromise.then(executeTask, executeTask);
    this._userQueues.set(key, nextPromise);
    return nextPromise;
  }

  /**
   * Retorna el número de tareas actualmente en cola o ejecución para un usuario.
   * @param {string|number} userId
   * @returns {number}
   */
  getQueueLength(userId) {
    const key = String(userId || 'default');
    return this._queueLengths.get(key) || 0;
  }

  /**
   * Indica si hay trabajo en curso o en espera para un usuario.
   * @param {string|number} userId
   * @returns {boolean}
   */
  isProcessing(userId) {
    return this.getQueueLength(userId) > 0;
  }

  /**
   * Retorna el número total de usuarios con colas activas en memoria.
   * @returns {number}
   */
  getActiveUsersCount() {
    return this._userQueues.size;
  }

  /**
   * Métricas operativas de la cola para telemetría SRE.
   * @returns {{ activeTasks: number, activeUsers: number, totalEnqueued: number, totalCompleted: number, totalRejected: number }}
   */
  getMetrics() {
    let activeTasks = 0;
    for (const count of this._queueLengths.values()) {
      activeTasks += count;
    }
    return {
      activeTasks,
      activeUsers: this._userQueues.size,
      totalEnqueued: this._totalEnqueued,
      totalCompleted: this._totalCompleted,
      totalRejected: this._totalRejected,
    };
  }

  getStats() {
    return this.getMetrics();
  }
}

export const defaultSessionQueue = new UserSessionQueue();

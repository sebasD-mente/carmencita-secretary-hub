import { config } from '../config.js';

export class GoogleTasksService {
  constructor(opts = {}) {
    this.clientId = opts.clientId ?? config.google?.clientId ?? '';
    this.clientSecret = opts.clientSecret ?? config.google?.clientSecret ?? '';
    this.refreshToken = opts.refreshToken ?? config.google?.refreshToken ?? '';
    this.tasksClient = opts.tasksClient || null;
  }

  isConfigured() {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    if (!this.tasksClient && isTestEnv) {
      return false;
    }
    return Boolean(this.tasksClient || (this.refreshToken && this.clientId && this.clientSecret));
  }

  async _getTasksClient() {
    if (this.tasksClient) return this.tasksClient;
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
    if (isTestEnv) return null;
    if (!this.refreshToken) return null;

    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
      oauth2Client.setCredentials({ refresh_token: this.refreshToken });
      this.tasksClient = google.tasks({ version: 'v1', auth: oauth2Client });
      return this.tasksClient;
    } catch (err) {
      console.warn('[GoogleTasksService] googleapis no disponible o fallo de inicialización:', err.message);
      return null;
    }
  }

  async createTask({ title, notes = '', dueDate = null, due: rawDue = null, tasklist = '@default' }) {
    const tasks = await this._getTasksClient();
    if (!tasks) {
      throw new Error('Google Tasks no está configurado (falta GOOGLE_REFRESH_TOKEN o cliente OAuth).');
    }

    const dateVal = dueDate || rawDue;
    let due = undefined;
    if (dateVal) {
      const parsed = new Date(dateVal);
      if (!isNaN(parsed.getTime())) {
        due = parsed.toISOString();
      }
    }

    const requestBody = {
      title,
      notes: notes || undefined,
      due,
    };

    const res = await tasks.tasks.insert({
      tasklist,
      requestBody,
    });

    const item = res.data;
    return {
      id: item.id,
      title: item.title,
      notes: item.notes || null,
      due: item.due || null,
      status: item.status || 'needsAction',
      updated: item.updated,
    };
  }

  async listTasks({ tasklist = '@default', showCompleted = false, maxResults = 20 } = {}) {
    const tasks = await this._getTasksClient();
    if (!tasks) {
      return [];
    }

    const res = await tasks.tasks.list({
      tasklist,
      showCompleted,
      maxResults,
    });

    const items = res.data?.items || [];
    return items.map((t) => ({
      id: t.id,
      title: t.title || '(Sin título)',
      notes: t.notes || null,
      due: t.due || null,
      status: t.status,
      completed: Boolean(t.completed),
    }));
  }

  async completeTask({ taskId, tasklist = '@default' }) {
    const tasks = await this._getTasksClient();
    if (!tasks) throw new Error('Google Tasks no está configurado.');
    const res = await tasks.tasks.patch({
      tasklist,
      task: taskId,
      requestBody: { status: 'completed' },
    });
    return res.data;
  }

  async deleteTask({ taskId, tasklist = '@default' }) {
    const tasks = await this._getTasksClient();
    if (!tasks) throw new Error('Google Tasks no está configurado.');
    await tasks.tasks.delete({
      tasklist,
      task: taskId,
    });
    return { success: true, taskId };
  }
}

export const defaultGoogleTasksService = new GoogleTasksService();

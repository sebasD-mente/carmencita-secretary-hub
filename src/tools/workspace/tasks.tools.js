import { makeActionResult } from '../index.js';

export async function handleTasksAction(parsedAction, deps, context = {}) {
  const { action } = parsedAction;
  const cleanText = context.cleanText || '';

  if (action === 'SAVE_TASK') {
    if (deps.taskService?.createTask) {
      await deps.taskService.createTask({
        description: parsedAction.description, due: parsedAction.due,
        dueDate: parsedAction.dueDate, priority: parsedAction.priority,
      });
    }
    return Object.assign(makeActionResult({
      reply: cleanText,
      actionData: parsedAction,
    }), { data: { success: true, description: parsedAction.description, priority: parsedAction.priority, dueDate: parsedAction.dueDate } });
  }

  if (action === 'COMPLETE_TASK' || action === 'CANCEL_TASK') {
    const isComplete = action === 'COMPLETE_TASK';
    let task = null, taskErr = null;
    try {
      task = isComplete
        ? await deps.taskService?.completeTaskByNameOrId?.({ id: parsedAction.id || null, query: parsedAction.query || null })
        : await deps.taskService?.cancelTaskByNameOrId?.({ id: parsedAction.id || null, query: parsedAction.query || null });
    } catch (err) {
      console.error(`[Brain Task] Error ${isComplete ? 'completando' : 'cancelando'} tarea:`, err.message);
      taskErr = err.message;
    }

    const verb = isComplete ? 'completar' : 'cancelar', past = isComplete ? 'completada' : 'cancelada';
    const reply = taskErr ? `⚠️ Sebastián querido, ocurrió un error al intentar ${verb} la tarea: ${taskErr}`
      : (!task ? (cleanText || `Sebastián querido, no encontré ninguna tarea pendiente para ${verb} con "${parsedAction.query || parsedAction.id || 'la búsqueda'}".`)
      : (cleanText || (isComplete ? `¡Listo mi Sebastián querido! Di por concluida la tarea "${task.description}" en tu lista.` : `¡Listo, mi jefe querido! Cancelé la tarea "${task.description}" de tu lista.`)));

    return Object.assign(makeActionResult({
      reply, hasTask: Boolean(task), task, actionData: parsedAction,
      fullHistoryText: `${reply}\n[Tarea ${past}: ${task?.description || parsedAction.query || parsedAction.id || 'N/A'}]`,
    }), { data: { task, isComplete, success: Boolean(task) } });
  }

  if (action === 'LIST_TASKS') {
    const statusFilter = parsedAction.status === 'TODAS' ? null : (parsedAction.status || 'PENDIENTE');
    const onlyPending = statusFilter === 'PENDIENTE';
    let tasks = [], listErr = null;
    try {
      if (deps.taskService && typeof deps.taskService.listTasks === 'function') {
        tasks = await deps.taskService.listTasks({ status: statusFilter, onlyPending, limit: parsedAction.limit || 20 });
      }
    } catch (err) {
      console.error('[Brain Task] Error listando tareas:', err.message);
      listErr = err.message;
    }

    let reply = '';
    if (listErr) {
      reply = `⚠️ Sebastián querido, ocurrió un detalle al consultar tus tareas: ${listErr}`;
    } else if (tasks.length === 0) {
      reply = cleanText || `Sebastián querido, no tienes tareas registradas${statusFilter ? ` con estado ${statusFilter.toLowerCase()}` : ''}. ¡Todo al día y en orden!`;
    } else {
      const list = tasks.map((t, i) => `${i + 1}. 📌 [${t.status}] **${t.description}** (Prioridad: ${t.priority || 'MEDIA'})`).join('\n');
      reply = `${cleanText ? cleanText + '\n\n' : ''}📋 **Tus tareas (${statusFilter || 'PENDIENTE'} - ${tasks.length}):**\n\n${list}`;
    }

    return Object.assign(makeActionResult({
      reply,
      hasTask: tasks.length > 0,
      tasks,
      actionData: parsedAction,
      fullHistoryText: `${reply}\n[Tareas consultadas (${statusFilter || 'TODAS'}): ${tasks.length} encontradas]`,
    }), { data: { tasks, count: tasks.length, status: statusFilter || 'TODAS' } });
  }

  return makeActionResult({ reply: cleanText });
}

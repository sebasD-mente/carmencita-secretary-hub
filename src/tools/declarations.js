import { Type } from '@google/genai';

/**
 * Catálogo Oficial de Declaraciones de Herramientas Tipadas para Gemini (Native Tool Calling).
 * Cumple con el estándar de contratos de @google/genai y ReAct Multi-Paso.
 */
export const CARMENCITA_TOOL_DECLARATIONS = [
  {
    name: 'manage_calendar',
    description: 'Gestiona la agenda y eventos de Google Calendar: crear nuevos eventos, listar la agenda, reprogramar o cancelar eventos existentes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Acción a realizar en el calendario: CREATE, LIST, RESCHEDULE o CANCEL.',
          enum: ['CREATE', 'LIST', 'RESCHEDULE', 'CANCEL'],
        },
        summary: {
          type: Type.STRING,
          description: 'Título o resumen descriptivo del evento.',
        },
        startTime: {
          type: Type.STRING,
          description: 'Fecha y hora de inicio en formato ISO 8601 o temporal.',
        },
        endTime: {
          type: Type.STRING,
          description: 'Fecha y hora de finalización en formato ISO 8601 o temporal (opcional).',
        },
        timeMin: {
          type: Type.STRING,
          description: 'Límite inferior para búsqueda o listado de eventos en formato ISO.',
        },
        timeMax: {
          type: Type.STRING,
          description: 'Límite superior para búsqueda o listado de eventos en formato ISO.',
        },
        eventId: {
          type: Type.STRING,
          description: 'Identificador único del evento para reprogramar o cancelar.',
        },
        location: {
          type: Type.STRING,
          description: 'Ubicación física o enlace de videollamada para el evento.',
        },
        range: {
          type: Type.STRING,
          description: 'Rango relativo para listar eventos (ej: TODAY, THIS_WEEK, THIS_MONTH).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'search_gmail',
    description: 'Busca y lee mensajes o hilos de correo electrónico en la bandeja de entrada de Gmail.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Consulta de búsqueda en sintaxis nativa de Gmail (ej: "from:proveedor", "subject:factura").',
        },
        maxResults: {
          type: Type.INTEGER,
          description: 'Límite máximo de mensajes a recuperar (por defecto 5).',
        },
        messageId: {
          type: Type.STRING,
          description: 'Identificador opcional de un correo específico para leer su cuerpo en detalle.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'manage_obsidian_notes',
    description: 'Administra exclusivamente las notas estructuradas del Obsidian Vault (DekoLabs-Vault): buscar, leer, crear, actualizar, anexar o sincronizar notas en formato Markdown con frontmatter y memoria RAG.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Acción a realizar en el Vault: SEARCH, READ, CREATE, UPDATE, APPEND o SYNC.',
          enum: ['SEARCH', 'READ', 'CREATE', 'UPDATE', 'APPEND', 'SYNC'],
        },
        title: {
          type: Type.STRING,
          description: 'Título o nombre de la nota en Obsidian.',
        },
        content: {
          type: Type.STRING,
          description: 'Cuerpo o contenido de la nota en formato Markdown.',
        },
        folder: {
          type: Type.STRING,
          description: 'Carpeta o ruta relativa dentro del Vault.',
        },
        query: {
          type: Type.STRING,
          description: 'Término de búsqueda semántica o por palabras clave.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_drive',
    description: 'Gestiona archivos y carpetas soberanas en Google Drive API v3 (carpetas oficiales: comunicacion, reportes, custom_agents): listar, leer, crear, actualizar in-place, mover o eliminar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Acción soberana en Google Drive: LIST, READ, CREATE, UPDATE, MOVE, DELETE o SEARCH.',
          enum: ['LIST', 'READ', 'CREATE', 'UPDATE', 'MOVE', 'DELETE', 'SEARCH'],
        },
        name: {
          type: Type.STRING,
          description: 'Nombre del archivo con extensión (ej: PERFIL_Y_BLUEPRINT_CARMENCITA_CHIEF_OF_STAFF.md o COM_20261009_...).',
        },
        content: {
          type: Type.STRING,
          description: 'Contenido completo en texto o Markdown para crear o actualizar el archivo.',
        },
        folder: {
          type: Type.STRING,
          description: 'Alias de carpeta oficial (comunicacion, reportes, custom_agents) o ID directo de Google Drive.',
        },
        targetFolder: {
          type: Type.STRING,
          description: 'Carpeta destino para la acción MOVE (alias o ID directo).',
        },
        fileId: {
          type: Type.STRING,
          description: 'Identificador único de Google Drive para lectura directa, actualización o movimiento.',
        },
        query: {
          type: Type.STRING,
          description: 'Término de búsqueda o filtro de nombre.',
        },
        maxResults: {
          type: Type.INTEGER,
          description: 'Límite de archivos a recuperar (por defecto 20).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_tasks',
    description: 'Gestiona tareas pendientes y recordatorios en Google Tasks o el sistema local: crear, listar, completar o cancelar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Acción a ejecutar: CREATE, LIST, COMPLETE o CANCEL.',
          enum: ['CREATE', 'LIST', 'COMPLETE', 'CANCEL'],
        },
        title: {
          type: Type.STRING,
          description: 'Título o descripción principal de la tarea.',
        },
        taskId: {
          type: Type.STRING,
          description: 'Identificador único de la tarea.',
        },
        notes: {
          type: Type.STRING,
          description: 'Notas o detalles adicionales adjuntos a la tarea.',
        },
        dueDate: {
          type: Type.STRING,
          description: 'Fecha o plazo de vencimiento en formato ISO 8601.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_documents',
    description: 'Busca o recupera documentos resguardados en la Bóveda documental (facturas, contratos, cotizaciones, comprobantes).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Acción a realizar: SEARCH para buscar por afinidad o READ para obtener detalles de un documento.',
          enum: ['SEARCH', 'READ'],
        },
        query: {
          type: Type.STRING,
          description: 'Texto de búsqueda, nombre de proveedor, artículo o número de factura.',
        },
        category: {
          type: Type.STRING,
          description: 'Categoría documental opcional (ej: FACTURA, CONTRATO, COTIZACION, COMPROBANTE, GENERAL).',
        },
      },
      required: ['action', 'query'],
    },
  },
  {
    name: 'search_knowledge_base',
    description: 'Realiza una búsqueda semántica deliberativa sobre acuerdos, directivas de Sebastián, acuerdos con proveedores y memoria de largo plazo.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Consulta deliberativa o tema sobre directivas, reglas o acuerdos a recuperar.',
        },
        category: {
          type: Type.STRING,
          description: 'Categoría opcional: ACUERDO, DIRECTIVA, PREFERENCIA o PROVEEDOR.',
          enum: ['ACUERDO', 'DIRECTIVA', 'PREFERENCIA', 'PROVEEDOR'],
        },
        limit: {
          type: Type.INTEGER,
          description: 'Cantidad máxima de recuerdos relevantes a recuperar (por defecto 3).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'diagnose_system',
    description: 'Ejecuta telemetría, salud de servicios y diagnóstico del entorno de Carmencita (Docker, memoria, PostgreSQL, Drive).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        target: {
          type: Type.STRING,
          description: 'Alcance del diagnóstico técnico: status, docker o system.',
          enum: ['status', 'docker', 'system'],
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'generate_media',
    description: 'Genera artefactos visuales o estructurados: códigos QR, hojas de cálculo Excel o avatares de Carmencita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: {
          type: Type.STRING,
          description: 'Tipo de medio a generar: QR, EXCEL o AVATAR.',
          enum: ['QR', 'EXCEL', 'AVATAR'],
        },
        data: {
          type: Type.OBJECT,
          description: 'Parámetros específicos para la generación (datos para QR, columnas/filas para Excel, etc.).',
        },
      },
      required: ['type'],
    },
  },
];

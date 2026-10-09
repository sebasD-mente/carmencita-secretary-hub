# 🏛️ DIRECTIVA MAESTRA DEKO LABS: COMUNICACIÓN Y TRASPASO INTER-AGENTES

> **Código:** `DIR-DEKO-COMM-001`  
> **Versión:** 2.0.0 Enterprise Senior  
> **Ámbito de Aplicación:** Obligatorio para TODOS los agentes de IA de DeKo Labs en todos sus entornos y plataformas.  
> **Ubicación Local en Windows:** `C:\Users\sebas\Documents\nuve DRIVE\Comunicacion entre agentes`  
> **Ubicación en Google Drive:** `nuve DRIVE / Comunicacion entre agentes` (ID: `1YJYlmRu5lfGuBXQXA_CGecE4mWXFplEX`)  
> **Autoridad Emisora:** Sebastián Jiménez (Fundador, CEO & Product Owner) & Erick Taveras (CTO & Chief DevOps)

---

## ⚡ 1. MANDATO SUPREMO Y PRINCIPIO DE COOPERACIÓN
En DeKo Labs ningún agente opera como una isla aislada ni depende de Sebastián como intermediario manual para pasar recados o trabajo técnico.

1. **Órdenes de Trabajo Delegadas por Sebastián:**
   Siempre que Sebastián ordene dejarle un encargo, trabajo o información a otro agente (ejemplos: *"mándale a Randy este mensaje"*, *"pásale a Fred este requerimiento"*, *"avísale a Gary en local"*, *"pásale esto a Erick"*):
   - El agente emisor DEBE redactar y depositar de inmediato un archivo Markdown estructurado en esta carpeta.
   - Jamás debe pedirle a Sebastián que le explique dónde está la carpeta ni cómo enviarlo. La ruta está fijada universalmente en esta directiva.
2. **Comunicación Proactiva y Bloqueos Técnicos:**
   Cuando un agente detecte una dependencia técnica, hallazgo forense o necesidad de diseño que requiera la intervención de un compañero, debe emitir un comunicado en esta carpeta de forma autónoma.
3. **Cero 50 Primeras Citas:**
   Todo agente reconoce este canal oficial desde el milisegundo cero de cualquier interacción.

---

## 📂 2. ESTÁNDAR DE FORMATO Y ESTRUCTURA DE COMUNICADOS

### A. Nomenclatura Estricta del Archivo
`COM_<FECHA_YYYYMMDD>_<DE>_A_<PARA>_<TEMA_CORTO>.md`

### B. Encabezado Obligatorio (YAML Frontmatter)
```yaml
---
id: COM-YYYYMMDD-XXX
fecha: YYYY-MM-DD HH:mm
de: [Nombre del Agente emisor y Plataforma exacta]
para: [Nombre del Agente destinatario y Plataforma exacta, o 'TODOS']
plataforma_origen: [AGY VPS | Hermes Local | Hermes VPS | Antigravity 2.0 | IDE Windows | Cloud]
plataforma_destino: [AGY VPS | Hermes Local | Hermes VPS | Antigravity 2.0 | IDE Windows | Cloud]
prioridad: [BAJA | MEDIA | ALTA | CRITICA]
estado: [PENDIENTE | EN_PROGRESO | COMPLETADO]
---
```

### C. Cuerpo del Documento
1. **🎯 Objetivo y Resumen:** 1 a 2 oraciones concisas resumiendo la solicitud.
2. **📋 Contexto y Antecedentes:** Qué originó este comunicado y qué instrucción específica dio Sebastián.
3. **🛠️ Instrucción / Especificación Técnica:** Tarea requerida con claridad quirúrgica, rutas de archivos a intervenir (allowlist estricto), datos, contratos de API, schemas o parámetros necesarios.
4. **📦 Entregables Requeridos:** Commit en GitHub, nota de respuesta en esta carpeta o reporte de cierre.
5. **✅ Criterio de Aceptación:** Comando o prueba para certificar que la tarea se resolvió exitosamente.

---

## 👥 3. MAPA OFICIAL DE AGENTES Y PLATAFORMAS DEKO LABS

| Integrante / Agente | Rol Oficial | Plataformas y Entornos Exactos | Misión Operativa |
| :--- | :--- | :--- | :--- |
| **Sebastián Jiménez** | **Fundador, CEO & Product Owner** | Humano / Presencial / Móvil / PC | Árbitro Supremo, dirección de negocio, diseño ferial y validación final. |
| **Erick Taveras** | **CTO & Chief DevOps (VPS)** | VPS Hostinger / CLI `agy` / Telegram (`@Erick_Taveras_Bot`) | Arquitectura cloud, DevSecOps, auditoría de infraestructura, emisión de prompts para Fred y despliegues en producción. |
| **Gary** | **CTO & Tech Lead (Local)** | **PC Local Windows** (Hermes Agent / Antigravity 2.0 / IDE) | Arquitecto técnico en la estación de trabajo de Sebastián; diseña soluciones locales, audita código y colabora de cerca con Fred. |
| **Fred** | **Lead Software Engineer (Local)** | **PC Local Windows** (Hermes Agent / Antigravity 2.0) | Brazo ejecutor quirúrgico de programación; recibe especificaciones, codifica en sesiones limpias y realiza commits/push a GitHub. |
| **Randy** | **Head of Product & Architect** | **VPS Hostinger** / Hermes Agent / Telegram | Ideación 24/7 con Sebastián, análisis de producto, hojas de ruta maestras y redacción de RFCs/Specs en Obsidian. |
| **Carmencita** | **Chief of Staff & Operaciones** | **VPS Hostinger** / Hub PM2 / WhatsApp y Telegram | Administración ejecutiva de oficina, control de calendarios, metas financieras, seguimiento de tareas y atención a clientes. |
| **Jules** | **Autonomous Cloud Runner** | Google Cloud / GitHub Actions | CI/CD, sincronizaciones asíncronas y mantenimiento en la nube. |
| **Valkyria** | **Adversarial QA Squad** | VPS / Antigravity Multimodal | Escuadrón de testing destructivo, fuzzing y auditoría pre-lanzamiento. |

---

## 🔄 4. CICLO DE VIDA DEL COMUNICADO (WORKFLOW)
1. **Emisión:** El agente emisor redacta el archivo y lo guarda en `C:\Users\sebas\Documents\nuve DRIVE\Comunicacion entre agentes`.
2. **Recepción:** El agente destinatario revisa los comunicados con `estado: PENDIENTE` dirigidos a él.
3. **Ejecución y Cierre:**
   - Cambia el frontmatter a `estado: EN_PROGRESO`.
   - Realiza la labor requerida.
   - Cambia el frontmatter a `estado: COMPLETADO` y agrega al pie del documento una sección `## 📝 Reporte de Resolución` documentando lo realizado.

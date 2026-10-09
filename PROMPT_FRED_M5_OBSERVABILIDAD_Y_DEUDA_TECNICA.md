# 🏛️ PROMPT DE INGENIERÍA: MILESTONE 5 — OBSERVABILIDAD SRE, DESACOPLE DE MONOLITOS & CERTIFICACIÓN DE PRODUCCIÓN

> **Estándar:** DeKo Labs Enterprise — Robusto, Profesional, Escalable  
> **Destinatario:** Fred (Lead Software Engineer / Single Developer)  
> **Auditor & Diseñador:** Gary (Lead Enterprise Architect & CTO)  
> **Ticket / Alcance:** `[DEKO-CARMEN-M5]` Telemetría SRE, Script de Verificación Post-Deploy `verify-prod.js`, Desacople del Monolito de Obsidian y Certificación Final de Calidad  
> **Fecha:** 9 de Octubre, 2026  

---

## 🎯 1. VISIÓN DEL HITO & OBJETIVOS ARQUITECTÓNICOS

El Milestone 5 representa el **cierre y certificación de producción** del Plan Maestro de Reconstrucción Integral de **Carmencita 2.0**. Sus objetivos centrales son:

1. **Desacople Cohesivo del Monolito de Obsidian (Erradicación de Deuda Técnica):**
   - Actualmente `src/services/obsidian-drive.service.js` acumulaba 906 líneas, violando el Principio de Responsabilidad Única (SRP) al mezclar I/O de Drive, parseo de Markdown y sincronización RAG.
   - Desacoplar este monolito en submódulos especializados de $\le 250$ líneas dentro de `src/services/obsidian/`:
     * `src/services/obsidian/drive-vault.client.js`: Cliente I/O contra Google Drive API, jerarquía de carpetas y caché TTL.
     * `src/services/obsidian/markdown-serializer.js`: Parseo y normalización de Markdown, frontmatter YAML, wikilinks, tags y segmentación (`_chunkMarkdown`).
   - Mantener `src/services/obsidian-drive.service.js` como una fachada compacta y compatible hacia atrás ($\le 320$ líneas) que delega en estos componentes.
   - Calibrar y reducir el techo dinámico en `scripts/audit-monoliths.js` para `src/services/obsidian-drive.service.js` de 950 a **350 líneas máximas**.
2. **Telemetría SRE y Endpoint `/api/metrics`:**
   - Exponer en `src/services/diagnostics.service.js` y `src/routes/webhooks.js` (o ruta dedicada `/api/metrics`) métricas operativas en tiempo real:
     * Uptime y memoria del proceso.
     * Pool de Gemini API Keys: keys activas, eventos de rotación/failover y estado de salud.
     * Métricas de cola `UserSessionQueue`: tareas activas, completadas y rechazadas.
     * Estado de conexiones (PostgreSQL con pgvector, Telegram bot, WhatsApp).
3. **Recibo Mecánico Post-Deploy (`scripts/verify-prod.js`):**
   - Crear un script ejecutable que certifique mecánicamente el estado de salud post-despliegue en Dokploy:
     * Fastify HTTP 200 en `/health` y `/api/metrics`.
     * Extensión `pgvector` instalada y latencia de consulta `< 20ms`.
     * Transcodificación `ffmpeg` funcional ejecutando una prueba de conversión efímera a OGG Opus.
     * Generación de un reporte JSON inmutable de certificación.
4. **Harness y Suite Completa al 100% en Verde:**
   - La suite combinada (`session-queue.test.js`, `hitl-briefing.test.js`, `formatter.test.js`, `agent-runner.test.js`, `gemini-pool.test.js`, `hub.test.js`, `obsidian-modular.test.js`) debe superar los **70 tests unitarios y de integración con 0 fallos**.
   - `npm run harness:check` con **0 violaciones de techos dinámicos**.

---

## 📁 2. ARCHIVOS INTERVENIDOS Y CREADOS

1. **`src/services/obsidian/drive-vault.client.js`:**
   - Cliente I/O de Google Drive API, jerarquía de carpetas, caché TTL, lectura y escritura con protección contra ciclos.
2. **`src/services/obsidian/markdown-serializer.js`:**
   - Normalización de títulos (`normalizeNoteTitle`), búsqueda difusa (`matchesSearchTerm`), segmentación (`_chunkMarkdown`), serialización de frontmatter YAML, wikilinks y tags.
3. **`src/services/obsidian-drive.service.js`:**
   - Fachada compacta de $\le 320$ líneas delegando limpiamente en `DriveVaultClient` y `MarkdownSerializer`.
4. **`src/services/diagnostics.service.js`:**
   - Método `collectMetrics()` con telemetría de proceso, pool de Gemini, `UserSessionQueue` y estado de salud de conexiones.
5. **`src/routes/webhooks.js`:**
   - Endpoint `GET /api/metrics` con protección perimetral.
6. **`src/adapters/session-queue.js`:**
   - Registro y cálculo de métricas de tareas encoladas, completadas y rechazadas.
7. **`scripts/verify-prod.js`:**
   - Recibo mecánico y certificación post-deploy SRE con reporte JSON inmutable.
8. **`scripts/audit-monoliths.js`:**
   - Calibración de techos dinámicos de dominio.
9. **`test/obsidian-modular.test.js`:**
   - Suite de certificación integral con 100% de tests en verde.

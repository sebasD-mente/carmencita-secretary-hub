# Ticket [DEKO-CARMEN-M2]: Milestone 2 — Purificación Cognitiva, Arquetipo Ejecutivo y Middleware de Presentación

**Estándar:** DeKo Labs Enterprise — Robusto, Profesional, Escalable  
**Autor:** Gary (Lead Enterprise Architect & Auditor Técnico)  
**Ejecutor:** Fred (Lead Software Engineer / Single Developer)  
**Product Owner:** Sebastián Jiménez  
**Fecha:** 9 de Octubre, 2026  

---

## 🏛️ 1. Contexto y Misión Técnica

Tras el despliegue exitoso del Milestone 1 (Motor Agéntico ReAct, Native Tool Calling con `@google/genai`, contratos Zod y Circuit Breakers), el sistema ya no depende de regex ni bloques JSON manuales para operar.

Sin embargo, el System Prompt previo (`src/core/carmencita.prompt.js`) padecía de una grave intoxicación cognitiva identificada unánimemente en la auditoría de Hermes:
1. **Asfixia por Prohibiciones Negativas:** El prompt acumulaba 206 líneas saturadas con más de 38 directivas punitivas ("PROHIBIDO", "TERMINANTEMENTE PROHIBIDO", "CERO", "NUNCA"). Por el efecto del elefante rosa, el espacio atencional de Gemini colapsaba intentando no violar restricciones de formato en lugar de resolver la intención del negocio.
2. **Esquizofrenia de Arquetipos:** Coexistían tres personalidades en pugna: la señora cariñosa de 58 años, un auditor contable zero-trust y un operador de consola de Docker.
3. **Falta de Discriminación de Negocio:** No mapeaba con claridad el Doble Sombrero de Sebastián (la operación retail/eventos de Deco Vintage vs. la innovación y software de DeKo Labs).
4. **Acoplamiento de Formato al LLM:** Se le exigía al modelo que genere HTML y gestione el espaciado visual en su generación de texto, en lugar de delegar el formateo visual a código JavaScript puro.

### La Misión del Milestone 2:
- **Purificar el System Prompt:** Reducirlo drásticamente de 206 líneas a $\le$ 50 líneas de alta densidad afirmativa basadas en principios ejecutivos.
- **Unificar la Identidad:** Consolidar el arquetipo en Chief of Staff Ejecutiva de Alta Dirección para Sebastián Jiménez.
- **Mapear el Doble Sombrero:** Discernir fluidamente entre Deco Vintage y DeKo Labs.
- **Respuestas con Criterio de Decisión:** Triage por urgencia, destacar el impacto y proponer siempre la siguiente acción (cero volcado plano de datos).
- **Crear el Middleware de Presentación (`src/presentation/formatter.js`):** Módulo desacoplado en JS puro que garantiza doble salto de línea (`\n\n`), viñetas limpias (`•`), conversión a HTML válido de Telegram y cero asteriscos en pantalla.
- **Limpiar VoiceService:** Erradicar filtros regex obsoletos de bloques JSON en el audio.

---

## 🛠️ 2. Especificaciones Técnicas Detalladas

- **PASO 1:** Purificación Radical del System Prompt (`src/core/carmencita.prompt.js`).
- **PASO 2:** Comprensión y Mapeo del Doble Sombrero (Deco Vintage vs. DeKo Labs).
- **PASO 3:** Heurística Positiva de Metacognición (Evaluar antes de actuar, cierre operativo, veracidad constructiva).
- **PASO 4:** Middleware de Presentación Desacoplado (`src/presentation/formatter.js`).
- **PASO 5:** Limpieza y Modernización de VoiceService (`src/services/voice.service.js`).
- **PASO 6:** Integración en TelegramAdapter (`src/adapters/telegram.js`).
- **PASO 7:** Suite de Pruebas Unitarias del Formateador (`test/formatter.test.js`).
- **PASO 8:** Arnés Mecánico y Techos Dinámicos (`scripts/audit-monoliths.js`).

---

## 🚦 3. Criterios de Aceptación Mecánicos (Quality Gate 2)

1. Suite del Formateador 100% Verde (`node test/formatter.test.js`).
2. Suite Agéntica y Pool 100% Verde (`node test/agent-runner.test.js && node test/gemini-pool.test.js`).
3. Cero Regresiones en Suite Global (`ALLOW_ROOT_EXEC=true node test/hub.test.js` - 59/59 tests pasando).
4. Prompt Limpio y Afirmativo ($\le$ 50 líneas, cero palabras punitivas y arquetipo unificado).
5. Arnés Mecánico sin Violaciones (`npm run harness:check` con código 0).

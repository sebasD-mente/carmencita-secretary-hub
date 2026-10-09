import test from 'node:test';
import assert from 'node:assert/strict';
import { PresentationFormatter } from '../src/presentation/formatter.js';
import { CARMENCITA_SYSTEM_PROMPT } from '../src/core/carmencita.prompt.js';

test('Suite de Pruebas Unitarias del Formateador de Presentación y Purificación Cognitiva (Milestone 2)', async (t) => {
  await t.test('Caso 1: Conversión de negritas **Sebas** a <b>Sebas</b> sin dejar asteriscos', () => {
    const input = '¡Hola **Sebas**! Bienvenido a **DeKo Labs** y **Deco Vintage**.';
    const output = PresentationFormatter.formatForTelegram(input);

    assert.ok(output.includes('<b>Sebas</b>'), 'Debe transformar **Sebas** a <b>Sebas</b>');
    assert.ok(output.includes('<b>DeKo Labs</b>'), 'Debe transformar **DeKo Labs** a <b>DeKo Labs</b>');
    assert.ok(output.includes('<b>Deco Vintage</b>'), 'Debe transformar **Deco Vintage** a <b>Deco Vintage</b>');
    assert.ok(!output.includes('*'), 'Ningún asterisco de markdown debe quedar en el texto final');
  });

  await t.test('Caso 2: Separación de ideas y párrafos con doble salto de línea \\n\\n', () => {
    const input = 'Primera idea ejecutiva.\nSegunda idea sobre inventario.\n\n\nTercera idea sobre infraestructura.';
    const output = PresentationFormatter.formatForTelegram(input);

    assert.ok(!output.includes('\n\n\n'), 'No debe contener saltos triples o excesivos');
    assert.ok(output.includes('Primera idea ejecutiva.\n\nSegunda idea sobre inventario.'), 'Debe garantizar doble salto entre ideas');
    assert.ok(output.includes('Segunda idea sobre inventario.\n\nTercera idea sobre infraestructura.'), 'Debe garantizar doble salto entre párrafos');
  });

  await t.test('Caso 3: Transformación de guiones sueltos en viñetas limpias • ', () => {
    const input = '📋 Mis pendientes:\n- Revisar stands para ComicCon\n - Coordinar transporte de mobiliario\n* Aprobar cotizaciones de madera';
    const output = PresentationFormatter.formatForTelegram(input);

    assert.ok(!output.includes('- Revisar'), 'No deben quedar guiones de lista sueltos');
    assert.ok(!output.includes('* Aprobar'), 'No deben quedar asteriscos de viñeta');
    assert.ok(output.includes('• Revisar stands para ComicCon'), 'Debe normalizar a viñeta limpia •');
    assert.ok(output.includes('• Coordinar transporte de mobiliario'), 'Debe normalizar guiones con indentación a •');
    assert.ok(output.includes('• Aprobar cotizaciones de madera'), 'Debe normalizar asteriscos de viñeta a •');
  });

  await t.test('Caso 4: Sanitización de ampersands (& -> &amp;) y cierre de tags HTML huérfanos', () => {
    const input = 'Sebastián & Gary revisaron DeKo Labs &amp; Deco Vintage en <b>Dokploy y <i>servicios';
    const output = PresentationFormatter.formatForTelegram(input);

    // Sanitización de ampersands
    assert.ok(output.includes('Sebastián &amp; Gary'), 'Debe escapar ampersands sueltos a &amp;');
    assert.ok(output.includes('DeKo Labs &amp; Deco Vintage'), 'No debe duplicar entidades &amp; preexistentes (&amp;amp;)');

    // Cierre de tags HTML huérfanos
    assert.ok(output.includes('<b>Dokploy y <i>servicios</i></b>') || (output.includes('<i>servicios</i>') && output.endsWith('</b>')), 'Debe cerrar tags huérfanos ordenadamente');
  });

  await t.test('Caso 5: Verificación de longitud del prompt: CARMENCITA_SYSTEM_PROMPT tiene <= 50 líneas de directivas y 0 ocurrencias de palabras punitivas', () => {
    const lines = CARMENCITA_SYSTEM_PROMPT.trim().split('\n');
    assert.ok(lines.length <= 50, `El System Prompt debe tener <= 50 líneas de directivas (actual: ${lines.length})`);

    // Erradicación de palabras punitivas en mayúsculas
    const punitiveWords = [
      'PROHIBIDO',
      'TERMINANTEMENTE PROHIBIDO',
      'NUNCA',
      'CERO ASTERISCOS',
      'CERO VÓMITO',
      'CERO LISTAS',
    ];

    punitiveWords.forEach((word) => {
      assert.ok(
        !CARMENCITA_SYSTEM_PROMPT.includes(word),
        `El prompt purificado no debe contener directivas negativas punitivas como "${word}"`
      );
    });

    // Erradicación de bloques JSON legacy
    assert.ok(
      !CARMENCITA_SYSTEM_PROMPT.includes('{"action"'),
      'El prompt no debe contener bloques JSON manuales de acción'
    );

    // Verificación de arquetipo Chief of Staff y Doble Sombrero
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('Chief of Staff'), 'Debe definir el rol de Chief of Staff');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('Deco Vintage'), 'Debe incluir el ecosistema Deco Vintage');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('DeKo Labs'), 'Debe incluir el ecosistema DeKo Labs');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('Sebas'), 'Debe incluir apelativos de confianza');
    assert.ok(CARMENCITA_SYSTEM_PROMPT.includes('mi jefe consentido'), 'Debe incluir zalamería reactiva');
  });

  await t.test('Caso 6: Limpieza para síntesis de voz (formatForVoice)', () => {
    const dirty = '¡Hola 👋 **Sebas** ☕! Revisa <pre>docker ps</pre> y [Deco Vintage](https://decovintage.online). • Todo al 100%.\n```json\n{"action": "TEST"}\n```';
    const voiceText = PresentationFormatter.formatForVoice(dirty);

    assert.ok(!voiceText.includes('👋'), 'Debe erradicar emojis');
    assert.ok(!voiceText.includes('☕'), 'Debe erradicar emojis de café');
    assert.ok(!voiceText.includes('**'), 'Debe eliminar negritas markdown');
    assert.ok(!voiceText.includes('<pre>'), 'Debe eliminar tags HTML');
    assert.ok(!voiceText.includes('</pre>'), 'Debe eliminar tags HTML');
    assert.ok(!voiceText.includes('https://'), 'Debe remover URLs directas');
    assert.ok(!voiceText.includes('```'), 'Debe remover code blocks');
    assert.ok(!voiceText.includes('action'), 'Debe remover bloques JSON');
    assert.ok(voiceText.includes('Sebas'), 'Debe preservar el contenido esencial');
    assert.ok(voiceText.includes('Deco Vintage'), 'Debe preservar texto de enlaces');
  });
});

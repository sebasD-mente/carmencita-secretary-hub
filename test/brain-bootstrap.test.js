import test from 'node:test';
import assert from 'node:assert/strict';
import { CarmencitaBrain } from '../src/core/brain.js';

test('🏛️ CarmencitaBrain - Arnés de Bootstrap en Frío (Zero Mocks en IoC Root)', async (t) => {
  await t.test('1. Instanciación en frío incluye todos los servicios soberanos requeridos', () => {
    const brain = new CarmencitaBrain();

    // 1. Google Drive Soberano (Mandatorio Ticket DEKO-CARMEN-043)
    assert.ok(brain.deps.googleDriveService, 'googleDriveService debe estar instanciado en deps');
    assert.equal(typeof brain.deps.googleDriveService.listFiles, 'function', 'googleDriveService.listFiles debe existir');
    assert.equal(typeof brain.deps.googleDriveService.readFile, 'function', 'googleDriveService.readFile debe existir');
    assert.equal(typeof brain.deps.googleDriveService.createFile, 'function', 'googleDriveService.createFile debe existir');

    // 2. Obsidian Vault
    assert.ok(brain.deps.obsidianService, 'obsidianService debe estar instanciado en deps');

    // 3. Herramientas registradas en ToolDispatcher
    assert.ok(brain.toolDispatcher, 'toolDispatcher debe estar inicializado');
  });

  await t.test('2. ToolDispatcher despacha manage_drive a través de brain.deps', async () => {
    const brain = new CarmencitaBrain();
    // Simular listFiles en el cliente interno sin llamadas de red reales
    brain.deps.googleDriveService.listFiles = async () => [
      { id: 'com_001', name: 'COM_20261010_TEST.md', folderPath: 'comunicacion' }
    ];

    const result = await brain.toolDispatcher.dispatch('manage_drive', {
      action: 'LIST',
      folder: 'comunicacion'
    });

    assert.equal(result.success, true);
    assert.equal(result.data.files.length, 1);
    assert.equal(result.data.files[0].name, 'COM_20261010_TEST.md');
  });
});

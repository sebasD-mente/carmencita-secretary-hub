import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateImageActionSchema, AspectRatioSchema, ImageModeSchema } from '../src/validators/actions.schema.js';
import {
  ImageGenerationService,
  PRO_MODELS,
  FLASH_MODELS,
  QuotaExceededError,
  SafetyFilterError,
  TimeoutError,
} from '../src/services/image-generation.service.js';
import { ToolDispatcher } from '../src/tools/dispatcher.js';
import { CarmencitaBrain } from '../src/core/brain.js';
import { mapToolSummaryToActionResult } from '../src/core/agent-runner.js';

test('🧠 Suite Coercitiva: Motor de Generación Visual Nano Banana Pro [DEKO-CARMEN-046]', async (t) => {

  await t.test('1. GenerateImageActionSchema valida campos requeridos, valores por omisión y rechaza enums inválidos', () => {
    // Caso válido mínimo
    const validMinimal = GenerateImageActionSchema.parse({
      prompt: 'Diseño de stand para feria',
    });
    assert.equal(validMinimal.action, 'GENERATE_IMAGE');
    assert.equal(validMinimal.prompt, 'Diseño de stand para feria');
    assert.equal(validMinimal.aspectRatio, '1:1');
    assert.equal(validMinimal.mode, 'arte_final');

    // Caso válido completo
    const validFull = GenerateImageActionSchema.parse({
      action: 'GENERATE_IMAGE',
      prompt: 'Rótulo comercial luminoso para Midas',
      aspectRatio: '16:9',
      mode: 'boceto',
      style: 'vintage industrial',
    });
    assert.equal(validFull.aspectRatio, '16:9');
    assert.equal(validFull.mode, 'boceto');
    assert.equal(validFull.style, 'vintage industrial');

    // Rechazo de prompt menor a 5 caracteres
    assert.throws(
      () => GenerateImageActionSchema.parse({ prompt: 'abc' }),
      /al menos 5 caracteres/
    );

    // Rechazo de aspectRatio inválido
    assert.throws(
      () => GenerateImageActionSchema.parse({ prompt: 'Stand de feria', aspectRatio: '21:9' })
    );

    // Rechazo de mode inválido
    assert.throws(
      () => GenerateImageActionSchema.parse({ prompt: 'Stand de feria', mode: 'ultra_hd' })
    );
  });

  await t.test('2. ImageGenerationService procesa una generación mockeada con dirección de arte y subida a GCS', async () => {
    const fakeImageBase64 = Buffer.from('fake-pixel-data-nano-banana').toString('base64');
    let capturedModel = null;
    let capturedConfig = null;
    let savedToGcs = false;

    const mockAi = {
      models: {
        generateContent: async ({ model, contents, config }) => {
          capturedModel = model;
          capturedConfig = config;
          return {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: fakeImageBase64,
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      },
    };

    const mockStorageProvider = {
      saveFile: async ({ buffer, originalName, mimeType, subDir }) => {
        savedToGcs = true;
        assert.equal(subDir, 'generated-images');
        assert.ok(originalName.startsWith('nano_'));
        return {
          fileName: originalName,
          filePath: `gs://carmencita-vault-deko/${subDir}/2026-10/${originalName}`,
          cloudUrl: `https://storage.googleapis.com/carmencita-vault-deko/${subDir}/${originalName}`,
          publicUrl: `https://storage.googleapis.com/carmencita-vault-deko/${subDir}/${originalName}`,
          fileSize: buffer.length,
          mimeType,
          isCloud: true,
        };
      },
    };

    const service = new ImageGenerationService({
      ai: mockAi,
      storageProvider: mockStorageProvider,
    });

    const result = await service.generateImage({
      prompt: 'Stand de feria para Deco Vintage con madera envejecida',
      aspectRatio: '16:9',
      mode: 'arte_final',
    });

    assert.equal(result.success, true);
    assert.equal(capturedModel, PRO_MODELS[0]);
    assert.deepEqual(capturedConfig, { responseModalities: ['IMAGE'] });
    assert.ok(result.buffer instanceof Buffer);
    assert.equal(result.mimeType, 'image/png');
    assert.equal(savedToGcs, true);
    assert.ok(result.cloudUrl.includes('carmencita-vault-deko'));
    assert.ok(result.expandedPrompt.includes('Composition: Aspect ratio 16:9'));
    assert.ok(result.expandedPrompt.includes('Deco Vintage'));
  });

  await t.test('3. Detección y manejo elegante de excepciones tipadas (SafetyFilterError, QuotaExceededError, TimeoutError)', async () => {
    // 3.1 Detección de SAFETY FILTER
    const mockSafetyAi = {
      models: {
        generateContent: async () => ({
          candidates: [
            {
              finishReason: 'SAFETY',
              content: { parts: [] },
            },
          ],
        }),
      },
    };

    const serviceSafety = new ImageGenerationService({ ai: mockSafetyAi });
    
    // Retorno estructurado amable por defecto
    const safetyRes = await serviceSafety.generateImage({
      prompt: 'Prompt potencialmente bloqueable',
    });
    assert.equal(safetyRes.success, false);
    assert.equal(safetyRes.isSafetyBlock, true);
    assert.equal(safetyRes.reason, 'SAFETY_FILTER_TRIGGERED');

    // Lanzamiento tipado si throwOnError: true
    await assert.rejects(
      async () => {
        await serviceSafety.generateImage({
          prompt: 'Prompt potencialmente bloqueable',
          throwOnError: true,
        });
      },
      SafetyFilterError
    );

    // 3.2 Detección de QUOTA EXCEEDED
    let rotateCalled = 0;
    const mockQuotaAi = {
      models: {
        generateContent: async () => {
          const err = new Error('ResourceExhausted: 429 Quota exceeded');
          err.status = 429;
          throw err;
        },
      },
    };
    const mockPool = {
      size: 2,
      rotateKey: () => { rotateCalled++; },
      isRateLimitError: () => true,
    };

    const serviceQuota = new ImageGenerationService({
      ai: mockQuotaAi,
      geminiPool: mockPool,
    });

    await assert.rejects(
      async () => {
        await serviceQuota.generateImage({ prompt: 'Render de stand comercial' });
      },
      QuotaExceededError
    );
    assert.ok(rotateCalled > 0, 'Debe haber intentado rotar llaves en el pool');

    // 3.3 Detección de TIMEOUT
    const mockHangingAi = {
      models: {
        generateContent: async () => new Promise((resolve) => setTimeout(resolve, 500)),
      },
    };
    const serviceTimeout = new ImageGenerationService({
      ai: mockHangingAi,
      timeoutMs: 50,
    });

    await assert.rejects(
      async () => {
        await serviceTimeout.generateImage({ prompt: 'Render con tiempo excedido' });
      },
      TimeoutError
    );
  });

  await t.test('4. Fallover de modelos entre Pro y Flash si el modelo principal no responde', async () => {
    const modelsAttempted = [];
    const fakeImageBase64 = Buffer.from('fake-pixel-data').toString('base64');

    const mockAi = {
      models: {
        generateContent: async ({ model }) => {
          modelsAttempted.push(model);
          if (model === PRO_MODELS[0]) {
            throw new Error(`Model ${model} is not supported or 404 not found`);
          }
          return {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ inlineData: { mimeType: 'image/png', data: fakeImageBase64 } }],
                },
              },
            ],
          };
        },
      },
    };

    const mockStorage = {
      saveFile: async ({ buffer, originalName, mimeType }) => ({
        fileName: originalName,
        cloudUrl: `https://storage.googleapis.com/carmencita-vault-deko/${originalName}`,
        publicUrl: `https://storage.googleapis.com/carmencita-vault-deko/${originalName}`,
        fileSize: buffer.length,
        mimeType,
      }),
    };

    const service = new ImageGenerationService({
      ai: mockAi,
      storageProvider: mockStorage,
    });

    const result = await service.generateImage({
      prompt: 'Stand elegante con detalles de bronce',
      mode: 'arte_final',
    });

    assert.equal(result.success, true);
    assert.equal(result.model, PRO_MODELS[1], 'Debe haber hecho failover al segundo modelo de PRO_MODELS');
    assert.deepEqual(modelsAttempted, [PRO_MODELS[0], PRO_MODELS[1]]);
  });

  await t.test('5. ToolDispatcher despacha generate_image retornando el DTO esperado sin llamadas anidadas', async () => {
    let capturedArgs = null;
    const mockImageGenerationService = {
      generateImage: async (args) => {
        capturedArgs = args;
        return {
          success: true,
          cloudUrl: 'https://storage.googleapis.com/carmencita-vault-deko/generated-images/nano_test.png',
          publicUrl: 'https://storage.googleapis.com/carmencita-vault-deko/generated-images/nano_test.png',
          fileName: 'nano_test.png',
          mimeType: 'image/png',
          fileSize: 1234,
          model: 'gemini-3-pro-image',
          prompt: args.prompt,
          aspectRatio: args.aspectRatio,
          mode: args.mode,
        };
      },
    };

    const dispatcher = new ToolDispatcher({
      imageGenerationService: mockImageGenerationService,
    });

    // Despacho exitoso
    const dispatchResult = await dispatcher.dispatch('generate_image', {
      prompt: 'Boceto rápido de rótulo para Midas',
      aspectRatio: '4:3',
      mode: 'boceto',
    });

    assert.equal(dispatchResult.success, true);
    assert.equal(dispatchResult.data.fileName, 'nano_test.png');
    assert.equal(capturedArgs.prompt, 'Boceto rápido de rótulo para Midas');
    assert.equal(capturedArgs.aspectRatio, '4:3');
    assert.equal(capturedArgs.mode, 'boceto');

    // Despacho con error de validación (prompt menor a 5 chars)
    const invalidResult = await dispatcher.dispatch('generate_image', {
      prompt: 'mini',
    });
    assert.equal(invalidResult.status, 'error');
    assert.equal(invalidResult.reason, 'INVALID_ARGUMENTS');
  });

  await t.test('6. [DEKO-CARMEN-046.1] CarmencitaBrain expone imageGenerationService y emailTriageService en get deps()', () => {
    const fakeImageGen = { name: 'fake-image-gen-service' };
    const fakeEmailTriage = { name: 'fake-email-triage-service' };

    const brain = new CarmencitaBrain({
      imageGenerationService: fakeImageGen,
      emailTriageService: fakeEmailTriage,
    });

    assert.equal(brain.deps.imageGenerationService, fakeImageGen);
    assert.equal(brain.deps.emailTriageService, fakeEmailTriage);
    assert.ok(brain.toolDispatcher, 'ToolDispatcher debe haberse inicializado con las dependencias');
  });

  await t.test('7. [DEKO-CARMEN-046.1] mapToolSummaryToActionResult mapea generate_image activando opts.hasPhoto para Telegram', () => {
    const fakeBuffer = Buffer.from('png-bytes-test');
    const runnerResult = {
      reply: 'Aquí tienes el diseño de tu stand.',
      toolCallsSummary: [
        {
          name: 'generate_image',
          args: { prompt: 'Stand de feria' },
          result: {
            data: {
              buffer: fakeBuffer,
              fileName: 'nano_stand.png',
              cloudUrl: 'https://storage.googleapis.com/test/nano_stand.png',
            },
          },
        },
      ],
    };

    const actionResult = mapToolSummaryToActionResult(runnerResult);

    assert.equal(actionResult.hasPhoto, true);
    assert.ok(actionResult.photoFile);
    assert.equal(actionResult.photoFile.buffer, fakeBuffer);
    assert.equal(actionResult.photoFile.fileName, 'nano_stand.png');
    assert.equal(actionResult.photoFile.caption, 'Aquí tienes el diseño de tu stand.');
    assert.equal(actionResult.actionData.action, 'GENERATE_IMAGE');
    assert.equal(actionResult.actionData.cloudUrl, 'https://storage.googleapis.com/test/nano_stand.png');
  });

});


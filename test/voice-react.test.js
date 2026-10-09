import test from 'node:test';
import assert from 'node:assert/strict';
import { CarmencitaBrain } from '../src/core/brain.js';
import { handleBrainAudio } from '../src/core/multimodal.js';
import { VoiceService } from '../src/services/voice.service.js';
import { GeminiPoolService } from '../src/services/gemini-pool.service.js';

test('🧠 Unificación Cognitiva de Voz (STT ➡️ ReAct AgentRunner)', async (t) => {
  await t.test('1. handleBrainAudio realiza transcripción multimodal y la inyecta en processTextMessage con isVoiceInput: true', async () => {
    let capturedTranscriptionPrompt = null;
    let capturedTextMessageOptions = null;

    const mockAi = {
      models: {
        generateContent: async ({ contents }) => {
          capturedTranscriptionPrompt = contents;
          return {
            text: 'Revisa las notas de comunicación en Google Drive y dime qué envió Erick.',
          };
        },
      },
    };

    const mockBrain = {
      ai: mockAi,
      _generateContentWithFailover: async (opts) => {
        return await mockAi.models.generateContent(opts);
      },
      processTextMessage: async (opts) => {
        capturedTextMessageOptions = opts;
        return {
          reply: 'Sebastián querido, ya revisé las notas de comunicación en Drive.',
          hasVoice: true,
          voiceFile: { fileName: 'carmencita_voice.ogg', buffer: Buffer.from('VOICE_MOCK') },
        };
      },
    };

    const fakeAudioBuffer = Buffer.from('FAKE_AUDIO_DATA_FOR_GEMINI_STT');
    const result = await handleBrainAudio(mockBrain, {
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      buffer: fakeAudioBuffer,
      mimeType: 'audio/ogg',
    });

    assert.ok(capturedTranscriptionPrompt, 'Debe haber llamado a la API multimodal para STT');
    assert.ok(
      capturedTranscriptionPrompt[0].includes('Transcribe fielmente'),
      'Prompt de transcripción debe ser fiel y sin preámbulos'
    );
    assert.equal(
      capturedTranscriptionPrompt[1].inlineData.data,
      fakeAudioBuffer.toString('base64'),
      'Debe enviar el buffer de audio en base64'
    );

    assert.ok(capturedTextMessageOptions, 'Debe inyectar la transcripción en processTextMessage');
    assert.equal(
      capturedTextMessageOptions.text,
      'Revisa las notas de comunicación en Google Drive y dime qué envió Erick.'
    );
    assert.equal(capturedTextMessageOptions.isVoiceInput, true, 'isVoiceInput debe ser true');
    assert.equal(result.hasVoice, true);
  });

  await t.test('2. processTextMessage con isVoiceInput: true activa síntesis vocal en la respuesta ejecutiva', async () => {
    let capturedVoiceSynthesisText = null;

    const mockVoiceService = {
      synthesizeSpeech: async (text) => {
        capturedVoiceSynthesisText = text;
        return {
          buffer: Buffer.from('AUDIO_OPUS_MOCK'),
          mimeType: 'audio/ogg',
          fileName: 'carmencita_voice.ogg',
        };
      },
    };

    const mockAgentRunner = {
      run: async () => ({
        reply: 'Sebastián querido, tus pendientes están organizados al centímetro.',
        rawReply: 'Sebastián querido, tus pendientes están organizados al centímetro.',
        toolCallsSummary: [],
      }),
    };

    const brain = new CarmencitaBrain({
      ai: { models: { generateContent: async () => ({ text: '{}' }) } },
      agentRunner: mockAgentRunner,
      voiceService: mockVoiceService,
    });

    // Mock logs y contexto
    brain._logMessage = async () => {};
    brain._getRecentContext = async () => ({ recentMessages: [], pendingTasks: [] });
    brain._resolveRAGContext = async () => ({ directivesBlock: '', memoriesBlock: '' });

    const result = await brain.processTextMessage({
      channel: 'telegram',
      senderId: '12345',
      senderName: 'Sebastián',
      text: '¿Cómo va todo?',
      isVoiceInput: true,
    });

    assert.equal(result.hasVoice, true);
    assert.ok(result.voiceFile);
    assert.equal(capturedVoiceSynthesisText, 'Sebastián querido, tus pendientes están organizados al centímetro.');
  });
});

test('🛡️ VoiceService - Blindaje de Cuota, Pool de API Keys y Tolerancia a HTTP 429', async (t) => {
  await t.test('1. Rotación automática de API Key ante HTTP 429 ResourceExhausted', async () => {
    let callCount = 0;
    const pool = new GeminiPoolService(['KEY_ALPHA', 'KEY_BETA', 'KEY_GAMMA'], {
      clientFactory: (key) => ({
        key,
        models: {
          generateContent: async () => {
            callCount++;
            if (callCount === 1) {
              const err = new Error('ResourceExhausted: Quota exceeded for model');
              err.status = 429;
              throw err;
            }
            return {
              candidates: [
                {
                  content: {
                    parts: [{ inlineData: { data: Buffer.from('WAV_DATA').toString('base64') } }],
                  },
                },
              ],
            };
          },
        },
      }),
    });

    const voiceService = new VoiceService({ poolService: pool });
    // Mock de transcodificación
    voiceService._transcodeWavToOgg = async (buf) => ({
      buffer: buf,
      mimeType: 'audio/ogg',
      fileName: 'carmencita_voice.ogg',
    });

    const result = await voiceService.synthesizeSpeech('Hola Sebastián');

    assert.ok(result);
    assert.equal(callCount, 2, 'Debe haber rotado tras el primer error 429 y reintentado con la segunda llave');
    assert.equal(pool.failoverCount, 1, 'Debe registrar 1 rotación de failover');
  });

  await t.test('2. Degrada limpiamente a null si todas las llaves del pool están agotadas', async () => {
    const exhaustedPool = new GeminiPoolService(['EXHAUSTED_1', 'EXHAUSTED_2'], {
      clientFactory: (key) => ({
        key,
        models: {
          generateContent: async () => {
            const err = new Error('Quota exceeded 429');
            err.status = 429;
            throw err;
          },
        },
      }),
    });

    const voiceService = new VoiceService({ poolService: exhaustedPool });
    const result = await voiceService.synthesizeSpeech('Hola Sebastián');

    assert.equal(result, null, 'Debe retornar null sin lanzar excepciones para no interrumpir a Carmencita');
  });
});

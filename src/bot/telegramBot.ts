import { Bot, InputFile } from 'grammy';
import { runAgentLoop } from '../agentLoop.js';
import { AIRouter } from '../router/aiRouter.js';
import { clearHistory } from '../memory/memoryStore.js';
import { TranscriptionRouter } from '../services/transcriptionService.js';
import { HealthStatus, TTSService } from '../types.js';

/**
 * Traduce mensajes de error técnicos a lenguaje humano con emojis.
 */
function translateError(message?: string): string {
  if (!message) return 'Error desconocido ❓';
  if (message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout')) {
    return 'El proveedor está demorando demasiado ⏳';
  }
  if (message.includes('429')) return 'Cuota excedida ⏳';
  if (message.includes('401')) return 'Error de Auth 🔑';
  if (message.includes('404')) return 'Modelo no encontrado 🚫';
  if (message.toLowerCase().includes('network')) return 'Error de red 🌐';
  return 'Error desconocido ❓';
}

/**
 * Formatea el reporte de salud de los proveedores para Telegram.
 */
function formatTelegramHealthReport(aiResults: Record<string, HealthStatus>, sttResults: Record<string, HealthStatus>): string {
  let report = '📡 *Estado de ZeroGravity*\n\n';
  
  report += '🧠 *Motores de IA (Texto)*:\n';
  let aiActive = 0;
  for (const [provider, status] of Object.entries(aiResults)) {
    if (status.up) {
      report += `🟢 *${provider}*: \`${status.latency}ms\`\n`;
      aiActive++;
    } else {
      const errorMsg = translateError(status.message);
      report += `🔴 *${provider}*: ${errorMsg}\n`;
    }
  }

  report += '\n🎙️ *Transcripción (Audio)*:\n';
  let sttActive = 0;
  for (const [provider, status] of Object.entries(sttResults)) {
    if (status.up) {
      report += `🟢 *${provider}*: \`${status.latency}ms\`\n`;
      sttActive++;
    } else {
      const errorMsg = translateError(status.message);
      report += `🔴 *${provider}*: ${errorMsg}\n`;
    }
  }

  report += `\n✅ *${aiActive + sttActive}* proveedores listos.`;

  return report;
}

/**
 * Crea y configura el bot de Telegram.
 */
export function createBot(
  token: string,
  allowedUserIds: number[],
  aiRouter: AIRouter,
  sttRouter: TranscriptionRouter,
  maxIterations: number,
  ttsService: TTSService | null = null
): Bot {
  const bot = new Bot(token);

  // Registrar comandos en el menú de Telegram
  bot.api.setMyCommands([
    { command: 'start', description: '🚀 Iniciar el bot y ver bienvenida' },
    { command: 'status', description: '📊 Ver salud de los proveedores de IA' },
    { command: 'clear', description: '🧹 Limpiar el historial de la conversación' },
  ]).catch(err => console.error('[Bot] Error registrando comandos:', err));

  // Middleware: whitelist de seguridad
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId || !allowedUserIds.includes(userId)) {
      console.warn(`[Bot] Acceso denegado para user ID: ${userId}`);
      await ctx.reply('⛔ No tienes permisos para usar este bot.');
      return;
    }

    await next();
  });

  // Comando /start
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🚀 *ZeroGravity* activo\\.\n\n' +
        'Soy tu agente de IA personal\\. Envíame cualquier mensaje o audio y te responderé\\.\n\n' +
        'Comandos:\n' +
        '/clear \\- Limpiar historial\n' +
        '/status \\- Estado del sistema',
      { parse_mode: 'MarkdownV2' }
    );
  });

  // Comando /clear
  bot.command('clear', async (ctx) => {
    const userId = ctx.from!.id;
    const deleted = await clearHistory(userId);
    await ctx.reply(`🧹 Historial limpiado. ${deleted} mensajes eliminados.`);
  });

  // Comando /status
  bot.command('status', async (ctx) => {
    const statusMsg = await ctx.reply('🔍 Verificando estado...');
    
    try {
      const [aiResults, sttResults] = await Promise.all([
        aiRouter.checkAllHealth(),
        sttRouter.checkAllHealth()
      ]);

      const report = formatTelegramHealthReport(aiResults, sttResults);
      
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, report, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      console.error('[Bot] Error en /status:', error);
      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, '❌ Error verificando el estado de los proveedores.');
    }
  });

  // Mensajes de texto
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const userMessage = ctx.message.text;

    console.log(`[Bot] Mensaje de ${userId}: ${userMessage.substring(0, 50)}...`);
    await ctx.replyWithChatAction('typing');

    try {
      const response = await runAgentLoop(userId, userMessage, aiRouter, maxIterations);
      
      const voiceKeywords = ['habla', 'voz', 'audio', 'nota de voz', 'decime', 'dime', 'hablame', 'háblame', 'escuchar', 'escucha'];
      const normalizeText = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const triggerVoice = voiceKeywords.some(keyword => normalizeText(userMessage).includes(normalizeText(keyword)));

      await sendResponse(ctx, response, ttsService, triggerVoice);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Bot] Error procesando mensaje: ${errorMsg}`);
      await ctx.reply('❌ Error procesando tu mensaje. Intenta de nuevo.');
    }
  });

  // Mensajes de voz
  bot.on('message:voice', async (ctx) => {
    const userId = ctx.from.id;

    console.log(`[Bot] Audio recibido de ${userId} (${ctx.message.voice.duration}s)`);
    await ctx.replyWithChatAction('typing');

    try {
      // 1. Descargar audio de Telegram
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const audioResponse = await fetch(fileUrl);
      if (!audioResponse.ok) {
        throw new Error(`Error descargando audio de Telegram (status ${audioResponse.status})`);
      }
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

      // 2. Transcribir con el nuevo router
      const { text: transcription, provider: sttProvider } = await sttRouter.transcribe(audioBuffer, file.file_path ?? 'voice.ogg');

      if (!transcription) {
        await ctx.reply('🔇 No pude entender el audio. Intenta de nuevo.');
        return;
      }

      // 3. Mostrar transcripción y responder
      await ctx.reply(`🎙️ "${transcription}" (transcribió ${sttProvider})`);
      await ctx.replyWithChatAction('typing');

      const response = await runAgentLoop(userId, transcription, aiRouter, maxIterations);
      await sendResponse(ctx, response, ttsService, true);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Bot] Error procesando audio: ${errorMsg}`);
      await ctx.reply('❌ Error procesando tu audio. Intenta de nuevo.');
    }
  });

  return bot;
}

/**
 * Envía la respuesta al usuario, convirtiendo a voz si es necesario.
 */
async function sendResponse(ctx: any, response: string, ttsService: TTSService | null, triggerVoice: boolean): Promise<void> {
  if (triggerVoice && ttsService) {
    try {
      await ctx.replyWithChatAction('record_voice');

      const capText = response.length > 1000 ? response.substring(0, 1000) : response;
      const audioBuffer = await ttsService.synthesize(capText);

      await ctx.replyWithVoice(new InputFile(audioBuffer, 'voice.ogg'));
    } catch (error) {
      console.error('[Bot] Error en síntesis de voz ElevenLabs, usando fallback de texto:', error);
    }
  }

  // Always send text too
  await sendTextMessage(ctx, response);
}

/**
 * Envía la respuesta en formato texto, dividiendo si es muy larga.
 */
async function sendTextMessage(ctx: any, response: string): Promise<void> {
  if (response.length > 4096) {
    const chunks = splitMessage(response, 4096);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } else {
    await ctx.reply(response);
  }
}

/**
 * Divide un mensaje largo en chunks respetando el límite de Telegram.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt === -1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

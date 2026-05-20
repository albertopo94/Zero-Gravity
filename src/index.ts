import 'dotenv/config';
import { initDatabase, setupTables, closeDatabase } from './memory/database.js';
import { GroqService } from './services/groqService.js';
import { OpenRouterService } from './services/openrouterService.js';
import { CerebrasService } from './services/cerebrasService.js';
import { GeminiService } from './services/geminiService.js';
import { AIRouter } from './router/aiRouter.js';
import { createBot } from './bot/telegramBot.js';
import type { AIService, HealthStatus } from './types.js';

// ─── Validar variables de entorno ───────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ Variable de entorno requerida: ${key}`);
    process.exit(1);
  }
  return value;
}

// ─── Configuración ──────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = requireEnv('TELEGRAM_BOT_TOKEN');
const GROQ_API_KEY = requireEnv('GROQ_API_KEY');
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL;

const ALLOWED_USER_IDS = requireEnv('TELEGRAM_ALLOWED_USER_IDS')
  .split(',')
  .map((id) => parseInt(id.trim(), 10))
  .filter((id) => !isNaN(id));

const DB_PATH = process.env.DB_PATH ?? './memory.db';
const MAX_ITERATIONS = parseInt(process.env.AGENT_LOOP_MAX_ITER ?? '3', 10);

// ─── Arranque ───────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('  ⚡ ZeroGravity — Agente de IA Local');
  console.log('  ────────────────────────────────────');
  console.log('');

  // 1. Inicializar base de datos
  initDatabase(DB_PATH);
  await setupTables();

// 2. Configurar proveedores de IA
const providers: AIService[] = [new GroqService(GROQ_API_KEY)];

if (CEREBRAS_API_KEY) {
  providers.push(new CerebrasService(CEREBRAS_API_KEY));
  console.log('[Init] Cerebras añadido al round-robin.');
}

if (GEMINI_API_KEY) {
  providers.push(new GeminiService(GEMINI_API_KEY));
  console.log('[Init] Gemini añadido al round-robin.');
}

if (OPENROUTER_API_KEY) {
  providers.push(new OpenRouterService(OPENROUTER_API_KEY, OPENROUTER_MODEL));
  console.log('[Init] OpenRouter añadido al round-robin.');
}

const router = new AIRouter(providers);

// 3. Verificar salud de los proveedores
console.log('[Init] Verificando salud de los proveedores...');
const healthReport = await router.checkAllHealth();

console.log('  🔍 Estado de los proveedores:');
console.log('  ──────────────────────────────');
for (const [name, status] of Object.entries(healthReport)) {
  const symbol = status.up ? '🟢 UP  ' : '🔴 DOWN';
  const info = status.up 
    ? `Latencia: ${status.latency}ms` 
    : `Error: ${status.message}`;
  console.log(`  ${symbol} | ${name.padEnd(12)} | ${info}`);
}

const healthyCount = Object.values(healthReport).filter((s) => s.up).length;
if (healthyCount === 0) {
  console.error('❌ CRÍTICO: No hay proveedores de IA disponibles. El bot no podrá responder.');
} else {
  console.log(`✅ ${healthyCount} proveedores listos para operar.`);
}
console.log('');

// 4. Crear e iniciar bot
const bot = createBot(TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, router, MAX_ITERATIONS);

console.log(`[Init] Usuarios permitidos: ${ALLOWED_USER_IDS.join(', ')}`);
console.log(`[Init] Max iteraciones por mensaje: ${MAX_ITERATIONS}`);
console.log('');
console.log('  🟢 Bot iniciado. Esperando mensajes...');
console.log('');

bot.start({
  onStart: () => {
    console.log('[Bot] Long polling activo.');
  },
});

// ─── Graceful shutdown ──────────────────────────────────────

function shutdown() {
  console.log('\n[Shutdown] Cerrando ZeroGravity...');
  bot.stop();
  closeDatabase();
  console.log('[Shutdown] ¡Hasta la próxima! 🚀');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
}

// Iniciar aplicación
main().catch((err) => {
  console.error('❌ Error fatal durante el arranque:', err);
  process.exit(1);
});

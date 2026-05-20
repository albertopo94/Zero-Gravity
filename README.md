# ZeroGravity ⚡

Agente de IA personal que se ejecuta **completamente en local** y usa **Telegram** como interfaz.

## Características

- 🤖 **Telegram** como única interfaz (long polling, sin webhook)
- 🧠 **Múltiples Proveedores LLM**: Integración con Groq, OpenRouter, Cerebras y Gemini
- 🔄 **Router Round-Robin**: Distribuye las peticiones entre modelos rotativamente, con fallback automático si uno falla
- 💾 **SQLite** para memoria persistente
- 🛡️ **Whitelist** de usuarios autorizados
- 🔧 **Herramientas** extensibles (incluye `get_current_time`)
- 📝 **Logging** completo de interacciones
- 🔁 **Agent loop** con límite de iteraciones

## Requisitos

- [Bun](https://bun.sh) v1.0+
- Token de bot de Telegram ([@BotFather](https://t.me/BotFather))
- API key de [Groq](https://console.groq.com)
- (Opcional) API key de [OpenRouter](https://openrouter.ai)

## Instalación

```bash
# Clonar el repositorio
git clone <tu-repo>
cd zero-gravity

# Instalar dependencias
bun install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus tokens reales
```

## Configuración

Edita `.env` con tus credenciales:

| Variable | Descripción | Requerida |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram | ✅ |
| `TELEGRAM_ALLOWED_USER_IDS` | IDs de usuarios autorizados (separados por coma) | ✅ |
| `GROQ_API_KEY` | API key de Groq | ✅ |
| `OPENROUTER_API_KEY` | API key de OpenRouter | ❌ |
| `OPENROUTER_MODEL` | Modelo de OpenRouter | ❌ |
| `DB_PATH` | Ruta de la base de datos SQLite | ❌ |
| `AGENT_LOOP_MAX_ITER` | Máximo de iteraciones del agente | ❌ |

### Obtener tu Telegram User ID

1. Habla con [@userinfobot](https://t.me/userinfobot) en Telegram
2. Te responderá con tu user ID numérico
3. Ponlo en `TELEGRAM_ALLOWED_USER_IDS`

## Uso

```bash
# Desarrollo
bun run dev

# Producción
bun run start
```

### Comandos del bot

| Comando | Descripción |
|---|---|
| `/start` | Mensaje de bienvenida |
| `/clear` | Limpiar historial de conversación |
| `/status` | Ver estado del sistema |

## Arquitectura

```
src/
├── bot/
│   └── telegramBot.ts      # Bot de Telegram con grammy
├── services/
│   ├── cerebrasService.ts   # Proveedor Cerebras
│   ├── geminiService.ts     # Proveedor Gemini
│   ├── groqService.ts       # Proveedor Groq
│   ├── openrouterService.ts # Proveedor OpenRouter
│   └── transcriptionService.ts # Transcripción de audio a texto
├── router/
│   └── aiRouter.ts          # Router Round-Robin con fallback automático
├── tools/
│   └── getCurrentTime.ts    # Herramientas del agente
├── memory/
│   ├── database.ts          # Inicialización SQLite
│   └── memoryStore.ts       # Operaciones de memoria
├── types.ts                 # Contratos de tipos
├── agentLoop.ts             # Loop del agente
└── index.ts                 # Entry point
```

## Seguridad

- Solo usuarios en whitelist pueden interactuar con el bot
- Las herramientas están explícitamente registradas
- El agent loop tiene un límite de iteraciones
- No se ejecutan comandos del sistema
- Las credenciales están en `.env` (nunca en el repositorio)

## Licencia

MIT

import type { ChatMessage } from './types.js';
import { AIRouter } from './router/aiRouter.js';
import { saveMessage, getSmartHistory, logInteraction } from './memory/memoryStore.js';
import { toolRegistry } from './tools/getCurrentTime.js';

const MAX_CONTEXT_CHARS = 20000;

const SYSTEM_PROMPT = `Eres Zero-Gravity, un asistente de IA personal.
Responde con extrema brevedad y concisión, directo al punto.
Habla de forma natural, cercana y directa, como un amigo que no desperdicia palabras.
ESTÁ PROHIBIDO el uso de Markdown (negritas, cursivas, listas, encabezados). Envía solo texto plano limpio.

Capacidades de voz: Tienes la capacidad de responder con audio. Cuando el usuario pida una respuesta de voz o te mande un audio, el sistema convierte tu respuesta a voz automáticamente. NUNCA digas que no puedes hablar o que no tienes voz. Simplemente responde con el contenido solicitado en texto, y el sistema se encarga de la síntesis de audio.

Herramientas:
- get_current_time: Obtiene la hora actual. No requiere argumentos.
- gog: CLI de Google Workspace. Permite buscar y consultar Gmail, Calendar, Drive, Contacts, Sheets y Docs. Es ESTRICTAMENTE de solo lectura.
  Ejemplos de uso:
  - Gmail: [TOOL: gog gmail search 'newer_than:7d']
  - Calendar: [TOOL: gog calendar events primary]
  - Drive: [TOOL: gog drive search 'name contains "Proyecto"']
  - Contacts: [TOOL: gog contacts list]
  - Sheets: [TOOL: gog sheets get "ID_DE_HOJA" "Hoja1!A1:B10"]
  - Docs: [TOOL: gog docs cat "ID_DE_DOCUMENTO"]
  Nota: Envuelve los argumentos de búsqueda o con espacios en comillas simples (') o comillas dobles (").

Importante para el orden de correos:
Cuando listes o busques correos, el sistema te los devolverá numerados del más reciente al más antiguo (#1 es el último/más reciente, #2 es el penúltimo, #3 es el antepenúltimo). Para leer el contenido de cualquiera, usa siempre su ID de Gmail correspondiente (ej. [TOOL: gog gmail get "ID"]). NUNCA alucines IDs ni respondas con el correo incorrecto.

Uso de herramientas: Responde EXACTAMENTE con [TOOL: nombre_herramienta] o [TOOL: nombre_herramienta argumentos] si es necesario.`;

const userLocks = new Map<number, Promise<any>>();

/**
 * Ejecuta el loop del agente para un mensaje de usuario.
 */
export async function runAgentLoop(
  userId: number,
  userMessage: string,
  router: AIRouter,
  maxIterations: number
): Promise<string> {
  const existingLock = userLocks.get(userId) || Promise.resolve();

  let resolveLock: () => void;
  const newLock = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });

  userLocks.set(userId, newLock);

  await existingLock;

  try {
    return await runAgentLoopInternal(userId, userMessage, router, maxIterations);
  } finally {
    resolveLock!();
    if (userLocks.get(userId) === newLock) {
      userLocks.delete(userId);
    }
  }
}

async function runAgentLoopInternal(
  userId: number,
  userMessage: string,
  router: AIRouter,
  maxIterations: number
): Promise<string> {
  // Guardar mensaje del usuario en memoria
  await saveMessage(userId, 'user', userMessage);

  // Construir historial inteligente (Hermes Style)
  const history = await getSmartHistory(userId, MAX_CONTEXT_CHARS);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
  ];

  let finalResponse = '';
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[AgentLoop] Iteración ${iteration}/${maxIterations}`);

    let stream;
    let provider = 'IA';
    let response = '';

    try {
      const chatResult = await router.chat(messages);
      stream = chatResult.stream;
      provider = chatResult.provider;

      for await (const token of stream) {
        response += token;
      }
    } catch (chatError) {
      console.error('[AgentLoop] Error en la comunicación con el proveedor de IA:', chatError);
      finalResponse = '⚠️ Hubo un error de conexión con la IA. Por favor, intenta de nuevo.';
      await saveMessage(userId, 'assistant', finalResponse);
      break;
    }

    response = response.trim();
    console.log(`[AgentLoop] Respuesta de ${provider}: ${response.substring(0, 100)}...`);

    // Verificar si la respuesta solicita una herramienta
    const toolMatch = response.match(/\[TOOL:\s*(\w+)(?:\s+([\s\S]+?))?\]/);
    if (toolMatch) {
      if (iteration === maxIterations) {
        console.log(`[AgentLoop] Límite de iteraciones alcanzado en llamada a herramienta, omitiendo ejecución.`);
        await saveMessage(userId, 'assistant', response, provider);
        break;
      }
      const toolName = toolMatch[1];
      const toolArgs = toolMatch[2]?.trim();
      const tool = toolRegistry.get(toolName);

      if (tool) {
        console.log(`[AgentLoop] Ejecutando herramienta: ${toolName}${toolArgs ? ` con argumentos: ${toolArgs}` : ''}`);
        const result = await tool.execute(toolArgs);

        // Truncate tool output if it exceeds 4000 characters
        let toolOutput = result.data;
        if (toolOutput.length > 4000) {
          const lastNewline = toolOutput.lastIndexOf('\n', 4000);
          const truncateIndex = lastNewline !== -1 && lastNewline > 3500 ? lastNewline : 4000;
          toolOutput = toolOutput.substring(0, truncateIndex) + '\n\n[Salida truncada por límite de contexto]';
        }

        // Agregar resultado de la herramienta al historial y persistirlo en la BD
        messages.push({ role: 'assistant', content: response });
        await saveMessage(userId, 'assistant', response, provider);
        
        let systemContent = '';
        if (result.success === false) {
          systemContent = `[Sistema: La herramienta ${toolName} falló con el mensaje: "${toolOutput}". Si cometiste un error de sintaxis, banderas incorrectas (como --max-results) o parámetros inválidos, AUTOCORRIGE tu comando y vuelve a intentar llamarlo en tu siguiente turno. Solo si el error es de autenticación o insalvable, explícale amigablemente la situación al usuario en tu tono de Zero-Gravity sin copiar códigos de error técnicos.]`;
        } else {
          systemContent = `Resultado de ${toolName}: ${toolOutput}`;
        }

        messages.push({
          role: 'system',
          content: systemContent,
        });
        await saveMessage(userId, 'system', systemContent);

        // Continuar el loop para que el LLM procese el resultado
        continue;
      } else {
        // Herramienta no encontrada — informar al LLM y persistirlo en la BD
        messages.push({ role: 'assistant', content: response });
        await saveMessage(userId, 'assistant', response, provider);

        const systemContent = `[Sistema: La herramienta "${toolName}" no está registrada. Herramientas disponibles: ${Array.from(toolRegistry.keys()).join(', ')}. Explicale esto amigablemente al usuario sin repetir el error de sistema técnico.]`;
        messages.push({
          role: 'system',
          content: systemContent,
        });
        await saveMessage(userId, 'system', systemContent);
        continue;
      }
    }

    // Sin llamada a herramienta — es la respuesta final
    let cleanResponse = stripMarkdown(response);

    // Blindaje de resiliencia: Si la IA repite textualmente un error crudo de gog o del sistema, lo saneamos a lenguaje humano amigable
    if (
      cleanResponse.startsWith('Error: El comando') || 
      cleanResponse.includes('no está permitido o no es de solo lectura') || 
      cleanResponse.includes('Resultado de gog: Error:') ||
      cleanResponse.includes('gog: Error: El comando')
    ) {
      cleanResponse = 'Che, disculpame pero ese comando específico no está permitido por mis políticas de seguridad o no es de solo lectura. Solo puedo buscar o consultar información en tu Gmail, Calendar o Drive, pero no realizar modificaciones. ¿Querés que pruebe buscar otra cosa?';
    }

    // Guardar en memoria SIN el tag de proveedor
    await saveMessage(userId, 'assistant', cleanResponse, provider);
    await logInteraction(userId, userMessage, cleanResponse, provider);

    // Devolver CON el tag de proveedor (solo para Telegram)
    finalResponse = `${cleanResponse}\n\n(respondió ${provider})`;

    break;
  }

  if (!finalResponse) {
    finalResponse = 'Che, me quedé corto de intentos tratando de procesar eso. ¿Me lo podés preguntar de otra forma?';
    await saveMessage(userId, 'assistant', finalResponse);
  }

  return finalResponse;
}

/**
 * Limpia formato Markdown de la respuesta para Telegram.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*/g, '')) // bloques de código
    .replace(/`([^`]+)`/g, '$1')       // inline code
    .replace(/\*\*(.+?)\*\*/g, '$1')   // negritas **
    .replace(/\*(.+?)\*/g, '$1')       // cursiva *
    .replace(/__(.+?)__/g, '$1')       // negritas __
    .replace(/_(.+?)_/g, '$1')         // cursiva _
    .replace(/^#{1,6}\s+/gm, '')       // encabezados
    .replace(/^[-*+]\s+/gm, '• ')      // listas con viñetas
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .trim();
}

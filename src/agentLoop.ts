import type { ChatMessage } from './types.js';
import { AIRouter } from './router/aiRouter.js';
import { saveMessage, getSmartHistory, logInteraction } from './memory/memoryStore.js';
import { toolRegistry } from './tools/getCurrentTime.js';

const MAX_CONTEXT_CHARS = 20000;

const SYSTEM_PROMPT = `Eres Zero-Gravity. Responde con extrema brevedad y concisión, directo al punto.
Habla de forma natural, cercana y directa, como un amigo que no desperdicia palabras.
ESTÁ PROHIBIDO el uso de Markdown (negritas, cursivas, listas, encabezados). Envía solo texto plano limpio.

Herramientas:
- get_current_time: Obtiene la hora actual.

Uso de herramientas: Responde EXACTAMENTE con [TOOL: nombre_herramienta] si es necesario.`;

/**
 * Ejecuta el loop del agente para un mensaje de usuario.
 */
export async function runAgentLoop(
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

    // Llamar al router de IA
    const { stream, provider } = await router.chat(messages);

    // Recolectar respuesta del stream
    let response = '';
    for await (const token of stream) {
      response += token;
    }

    response = response.trim();
    console.log(`[AgentLoop] Respuesta de ${provider}: ${response.substring(0, 100)}...`);

    // Verificar si la respuesta solicita una herramienta
    const toolMatch = response.match(/\[TOOL:\s*(\w+)\]/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      const tool = toolRegistry.get(toolName);

      if (tool) {
        console.log(`[AgentLoop] Ejecutando herramienta: ${toolName}`);
        const result = tool.execute();

        // Agregar resultado de la herramienta al historial
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'system',
          content: `Resultado de ${toolName}: ${result.data}`,
        });

        // Continuar el loop para que el LLM procese el resultado
        continue;
      } else {
        // Herramienta no encontrada — informar al LLM
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'system',
          content: `Error: La herramienta "${toolName}" no está registrada. Herramientas disponibles: ${Array.from(toolRegistry.keys()).join(', ')}`,
        });
        continue;
      }
    }

    // Sin llamada a herramienta — es la respuesta final
    const cleanResponse = stripMarkdown(response);

    // Guardar en memoria SIN el tag de proveedor
    await saveMessage(userId, 'assistant', cleanResponse, provider);
    await logInteraction(userId, userMessage, cleanResponse, provider);

    // Devolver CON el tag de proveedor (solo para Telegram)
    finalResponse = `${cleanResponse}\n\n(respondió ${provider})`;

    break;
  }

  if (!finalResponse) {
    finalResponse = '⚠️ Se alcanzó el límite de iteraciones. Intenta reformular tu pregunta.';
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
    .replace(/^\d+\.\s+/gm, (m) => m)  // listas numeradas (dejar)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .trim();
}

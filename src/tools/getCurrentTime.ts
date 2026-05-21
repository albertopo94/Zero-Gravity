import type { Tool, ToolResult } from '../types.js';
import { gogTool } from './gog.js';

export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: 'Devuelve la fecha y hora actual en un formato humano y legible.',
  execute(args?: string): ToolResult {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Madrid' // Ajustado al contexto del usuario si es posible, o configurable
    }).format(now);

    return {
      success: true,
      data: formatted,
    };
  },
};

/**
 * Registro central de herramientas disponibles.
 * Solo las herramientas registradas aquí pueden ser ejecutadas.
 */
export const toolRegistry: Map<string, Tool> = new Map([
  [getCurrentTimeTool.name, getCurrentTimeTool],
  [gogTool.name, gogTool],
]);

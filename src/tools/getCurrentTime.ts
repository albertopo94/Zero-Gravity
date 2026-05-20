import type { Tool, ToolResult } from '../types.js';

export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: 'Devuelve la hora actual en formato ISO 8601.',
  execute(): ToolResult {
    return {
      success: true,
      data: new Date().toISOString(),
    };
  },
};

/**
 * Registro central de herramientas disponibles.
 * Solo las herramientas registradas aquí pueden ser ejecutadas.
 */
export const toolRegistry: Map<string, Tool> = new Map([
  [getCurrentTimeTool.name, getCurrentTimeTool],
]);

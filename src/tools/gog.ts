import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult } from '../types.js';

const execFilePromise = promisify(execFile);

/**
 * Parses a CLI command string into an array of arguments,
 * respecting single and double quotes to handle internal spaces correctly.
 */
export function parseArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];

    if (char === '\\') {
      const nextChar = argsStr[i + 1];
      if (nextChar === '\\' || nextChar === "'" || nextChar === '"') {
        current += nextChar;
        i++;
        continue;
      }
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "'" && !inDoubleQuote) {
      const isContraction = i > 0 && i < argsStr.length - 1 &&
        /[a-zA-Z0-9\xC0-\xFF]/.test(argsStr[i - 1]) && /[a-zA-Z0-9\xC0-\xFF]/.test(argsStr[i + 1]);
      if (isContraction) {
        current += char;
      } else {
        inSingleQuote = !inSingleQuote;
      }
    } else if (char === ' ' && !inDoubleQuote && !inSingleQuote) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    args.push(current);
  }
  return args;
}

/**
 * Validates whether the given command is strictly a read-only Google Workspace command.
 */
export function validateReadOnly(args: string[]): boolean {
  if (args.length === 0) return false;

  const service = args[0].toLowerCase();
  
  switch (service) {
    case 'gmail': {
      const action = args[1]?.toLowerCase();
      if (action === 'search' || action === 'get' || action === 'raw' || action === 'cat') return true;
      
      if (action === 'messages' || action === 'drafts') {
        const subAction = args[2]?.toLowerCase();
        if (subAction === 'search' || subAction === 'get' || subAction === 'raw' || subAction === 'cat') return true;
      }
      return false;
    }
    case 'calendar': {
      const action = args[1]?.toLowerCase();
      if (action === 'events' || action === 'colors') return true;
      return false;
    }
    case 'drive': {
      const action = args[1]?.toLowerCase();
      if (action === 'search' || action === 'ls' || action === 'list') return true;
      return false;
    }
    case 'contacts': {
      const action = args[1]?.toLowerCase();
      if (action === 'list') return true;
      return false;
    }
    case 'sheets': {
      const action = args[1]?.toLowerCase();
      if (action === 'get' || action === 'metadata') return true;
      return false;
    }
    case 'docs': {
      const action = args[1]?.toLowerCase();
      if (action === 'cat') return true;
      return false;
    }
    default:
      return false;
  }
}

/**
 * Simplifica y formatea la salida JSON de gog para que sea óptima, legible y barata en tokens para los LLMs.
 */
export function simplifyGogOutput(stdout: string, args: string[]): string {
  const service = args[0]?.toLowerCase();
  const action = args[1]?.toLowerCase();
  const subAction = args[2]?.toLowerCase();

  try {
    const json = JSON.parse(stdout);

    // 1. Gmail Search o Listado de Threads/Messages
    if (service === 'gmail' && (action === 'search' || subAction === 'search')) {
      const items = json.threads || json.messages;
      if (items && Array.isArray(items)) {
        if (items.length === 0) {
          return 'No se encontraron correos en la búsqueda de Gmail.';
        }
        let output = `[Mensajes encontrados en Gmail (ordenados del más reciente al más antiguo)]\n`;
        items.forEach((t: any, index: number) => {
          output += `#${index + 1} | ID: "${t.id}" | De: "${t.from || 'Desconocido'}" | Asunto: "${t.subject || '(Sin Asunto)'}" | Fecha: "${t.date || ''}"\n`;
        });
        output += `\nNota para el LLM sobre el orden cronológico:\n`;
        output += `- El correo #1 es el ÚLTIMO recibido (el más reciente de todos).\n`;
        output += `- El correo #2 es el penúltimo recibido.\n`;
        output += `- El correo #3 es el antepenúltimo recibido.\n`;
        output += `Importante: Para consultar el contenido de un correo específico, usa exactamente el ID indicado entre comillas (ejemplo: "19e49ce3b60fae92"). Copia el ID tal cual, carácter por carácter, sin cambiar letras ni números.`;
        return output;
      }
    }

    // 2. Gmail Get o Lectura de Correo Individual
    if (service === 'gmail' && (action === 'get' || subAction === 'get')) {
      if (json.error) {
        const errorDetail = typeof json.error === 'object' ? (json.error.message || JSON.stringify(json.error)) : json.error;
        return `Error al obtener el correo: ${errorDetail}`;
      }

      const id = json.id || json.threadId || '';
      const from = json.from || json.headers?.find((h: any) => h?.name?.toLowerCase() === 'from')?.value || 'Desconocido';
      const date = json.date || json.headers?.find((h: any) => h?.name?.toLowerCase() === 'date')?.value || '';
      const subject = json.subject || json.headers?.find((h: any) => h?.name?.toLowerCase() === 'subject')?.value || '(Sin Asunto)';
      const snippet = json.snippet || '';
      const body = json.body || '';

      let output = `[Detalles del Correo de Gmail]\n`;
      output += `ID: "${id}"\n`;
      output += `De: "${from}"\n`;
      output += `Fecha: "${date}"\n`;
      output += `Asunto: "${subject}"\n`;
      output += `\nContenido/Cuerpo:\n`;
      output += body ? body.trim() : (snippet ? snippet.trim() : '(Mensaje vacío)');
      
      return output;
    }

    // 3. Calendar Events
    if (service === 'calendar' && action === 'events') {
      if (json.items && Array.isArray(json.items)) {
        if (json.items.length === 0) {
          return 'No se encontraron eventos en el calendario.';
        }
        let output = `[Eventos de Calendario]\n`;
        json.items.forEach((item: any, index: number) => {
          const start = item.start?.dateTime || item.start?.date || '';
          const end = item.end?.dateTime || item.end?.date || '';
          output += `#${index + 1} | ID: "${item.id}" | Título: "${item.summary || '(Sin título)'}" | Inicio: "${start}" | Fin: "${end}" | Estado: "${item.status || ''}"\n`;
        });
        return output;
      }
    }

    // 4. Drive Search o List
    if (service === 'drive' && (action === 'search' || action === 'ls' || action === 'list')) {
      if (json.files && Array.isArray(json.files)) {
        if (json.files.length === 0) {
          return 'No se encontraron archivos en Google Drive.';
        }
        let output = `[Archivos encontrados en Google Drive]\n`;
        json.files.forEach((file: any, index: number) => {
          output += `#${index + 1} | ID: "${file.id}" | Nombre: "${file.name}" | MimeType: "${file.mimeType || ''}" | Modificado: "${file.modifiedTime || ''}"\n`;
        });
        return output;
      }
    }

  } catch (e) {
    // Si falla el parseo, devolvemos stdout original
  }

  return stdout;
}

export const gogTool: Tool = {
  name: 'gog',
  description: 'Ejecuta comandos de lectura y búsqueda en Google Workspace (Gmail, Calendar, Drive, Contacts, Sheets, Docs). Solo lectura.',
  async execute(argsStr?: string): Promise<ToolResult> {
    if (!argsStr) {
      return {
        success: false,
        data: 'Error: No se proporcionaron argumentos para el comando gog.'
      };
    }

    const args = parseArgs(argsStr);
    
    // Normalize 'cat' synonym to 'get' for Gmail service to tolerate LLM variance
    if (args[0]?.toLowerCase() === 'gmail') {
      if (args[1]?.toLowerCase() === 'cat') {
        args[1] = 'get';
      } else if ((args[1]?.toLowerCase() === 'messages' || args[1]?.toLowerCase() === 'drafts') && args[2]?.toLowerCase() === 'cat') {
        args[2] = 'get';
      }
    }
    
    if (!validateReadOnly(args)) {
      return {
        success: false,
        data: `Error: El comando "${args.join(' ')}" no está permitido o no es de solo lectura. Solo se permiten operaciones de lectura y búsqueda.`
      };
    }

    // Force json and non-interactive output
    const fullArgs = [...args, '--json', '--no-input'];

    try {
      const env: Record<string, string> = {};
      if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
      if (process.env.HOME !== undefined) env.HOME = process.env.HOME;
      if (process.env.GOG_ACCOUNT !== undefined) env.GOG_ACCOUNT = process.env.GOG_ACCOUNT;
      if (process.env.GOG_KEYRING_BACKEND !== undefined) env.GOG_KEYRING_BACKEND = process.env.GOG_KEYRING_BACKEND;
      if (process.env.GOG_KEYRING_PASSWORD !== undefined) env.GOG_KEYRING_PASSWORD = process.env.GOG_KEYRING_PASSWORD;

      // Execute gog directly without a shell wrapper to prevent command injection
      const { stdout, stderr } = await execFilePromise('gog', fullArgs, {
        env,
        maxBuffer: 2 * 1024 * 1024
      });
      
      if (stderr && stderr.trim().length > 0) {
        console.warn(`[gogTool] Warning/Stderr: ${stderr}`);
      }

      return {
        success: true,
        data: simplifyGogOutput(stdout.trim(), args),
      };
    } catch (error: any) {
      console.error('[gogTool] Error executing gog:', error);
      return {
        success: false,
        data: `Error al ejecutar gog: ${error.message || error}`
      };
    }
  }
};

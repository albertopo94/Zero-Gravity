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
        /[a-zA-Z0-9]/.test(argsStr[i - 1]) && /[a-zA-Z0-9]/.test(argsStr[i + 1]);
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
      if (args[1] === 'events' || args[1] === 'colors') return true;
      return false;
    }
    case 'drive': {
      const action = args[1]?.toLowerCase();
      if (action === 'search' || action === 'ls' || action === 'list' || action === 'download' || action === 'dl') return true;
      return false;
    }
    case 'contacts': {
      if (args[1] === 'list') return true;
      return false;
    }
    case 'sheets': {
      if (args[1] === 'get' || args[1] === 'metadata') return true;
      return false;
    }
    case 'docs': {
      if (args[1] === 'cat') return true;
      return false;
    }
    default:
      return false;
  }
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
        data: stdout.trim(),
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

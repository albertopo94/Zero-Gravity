import type { ChatMessage } from '../types.js';
import { getDatabase } from './database.js';

/**
 * Guarda un mensaje en el historial de conversación.
 */
export async function saveMessage(
  userId: number,
  role: ChatMessage['role'],
  content: string,
  provider?: string
): Promise<void> {
  const db = getDatabase();
  await db.execute({
    sql: `INSERT INTO messages (user_id, role, content, provider, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`,
    args: [userId, role, content, provider ?? null],
  });
}

/**
 * Obtiene el historial de conversación reciente de un usuario.
 * Por defecto devuelve los últimos 20 mensajes.
 */
export async function getHistory(userId: number, limit: number = 20): Promise<ChatMessage[]> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    args: [userId, limit],
  });

  // Los mensajes vienen en orden DESC, los invertimos para orden cronológico
  return result.rows.reverse().map((row) => ({
    role: row.role as ChatMessage['role'],
    content: row.content as string,
  }));
}

/**
 * Obtiene el historial de conversación inteligente basado en longitud de caracteres (Hermes Style).
 * Acumula mensajes desde el más reciente hasta que se alcanza el límite de caracteres.
 */
export async function getSmartHistory(userId: number, maxChars: number): Promise<ChatMessage[]> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `SELECT role, content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 100`,
    args: [userId],
  });

  const accumulatedMessages: ChatMessage[] = [];
  let currentChars = 0;

  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows[i];
    const role = row.role as string;
    let content = row.content as string;

    if (i === 0) {
      // Primer mensaje (el más reciente): se añade siempre
      const totalLen = role.length + content.length;
      if (totalLen > maxChars) {
        const suffix = ' [...]';
        const maxContentLen = Math.max(0, maxChars - role.length - suffix.length);
        content = content.substring(0, maxContentLen) + suffix;
      }
      accumulatedMessages.push({
        role: role as ChatMessage['role'],
        content: content,
      });
      currentChars = role.length + content.length;
    } else {
      // Mensajes siguientes: se añaden solo si caben
      const messageLen = role.length + content.length;
      if (currentChars + messageLen > maxChars) {
        break;
      }
      accumulatedMessages.push({
        role: role as ChatMessage['role'],
        content: content,
      });
      currentChars += messageLen;
    }
  }

  // Los mensajes se acumularon del más nuevo al más viejo, invertimos para orden cronológico
  return accumulatedMessages.reverse();
}

/**
 * Registra una interacción completa en la tabla de logs (auditoría).
 */
export async function logInteraction(
  userId: number,
  prompt: string,
  response: string,
  provider: string
): Promise<void> {
  const db = getDatabase();
  await db.execute({
    sql: `INSERT INTO logs (user_id, prompt, response, provider, timestamp) VALUES (?, ?, ?, ?, datetime('now'))`,
    args: [userId, prompt, response, provider],
  });
}

/**
 * Limpia el historial de un usuario (para comando /clear).
 */
export async function clearHistory(userId: number): Promise<number> {
  const db = getDatabase();
  const result = await db.execute({
    sql: `DELETE FROM messages WHERE user_id = ?`,
    args: [userId],
  });
  return result.rowsAffected;
}

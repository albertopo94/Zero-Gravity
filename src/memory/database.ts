import { createClient, type Client } from '@libsql/client';
import path from 'path';

let db: Client | null = null;

/**
 * Inicializa la base de datos.
 * Si hay credenciales de Turso, usa la nube.
 * Si no, usa SQLite local como fallback.
 */
export function initDatabase(dbPath: string): Client {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoToken) {
    // Modo nube: Turso
    db = createClient({
      url: tursoUrl,
      authToken: tursoToken,
    });
    console.log(`[DB] Conectado a Turso: ${tursoUrl}`);
  } else {
    // Modo local: SQLite
    const resolvedPath = path.resolve(dbPath);
    db = createClient({
      url: `file:${resolvedPath}`,
    });
    console.log(`[DB] Base de datos local: ${resolvedPath}`);
  }

  return db;
}

/**
 * Crea las tablas necesarias (llamar después de initDatabase).
 */
export async function setupTables(): Promise<void> {
  const database = getDatabase();

  await database.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      provider TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      provider TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await database.execute(`CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id)`);
  await database.execute(`CREATE INDEX IF NOT EXISTS idx_logs_user ON logs(user_id)`);

  console.log('[DB] Tablas verificadas.');
}

/**
 * Obtiene la instancia activa de la base de datos.
 */
export function getDatabase(): Client {
  if (!db) {
    throw new Error('[DB] La base de datos no ha sido inicializada. Llama a initDatabase() primero.');
  }
  return db;
}

/**
 * Cierra la conexión a la base de datos.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Conexión cerrada.');
  }
}

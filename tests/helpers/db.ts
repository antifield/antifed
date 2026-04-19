import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../src/db/schema";

// Spins up an in-memory libsql + applies the current schema so tests can run
// the real command handlers against real SQL. This avoids faking drizzle's
// internals (which is fragile and usually means the "mock passes, prod breaks"
// category of failure).
export async function createTestDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });

  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_idx ON users(discord_id)`,
      `CREATE TABLE IF NOT EXISTS infractions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        moderator_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS infractions_user_id_idx ON infractions(user_id)`,
      `CREATE INDEX IF NOT EXISTS infractions_type_idx ON infractions(type)`,
      `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id)`,
    ],
    "write",
  );

  return { db, client };
}

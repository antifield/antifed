import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { users } from "~/db/schema/users";

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at")
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (table) => [index("notes_user_id_idx").on(table.userId)],
);

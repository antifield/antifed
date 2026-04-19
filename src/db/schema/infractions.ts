import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { users } from "~/db/schema/users";

export const infractions = sqliteTable(
  "infractions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    moderatorId: text("moderator_id").notNull(),
    type: text("type", { enum: ["ban", "warn", "kick", "softban"] }).notNull(),
    reason: text("reason").notNull(),
    active: integer("active", { mode: "boolean" }).default(true).notNull(),
    createdAt: text("created_at")
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (table) => [
    index("infractions_user_id_idx").on(table.userId),
    index("infractions_type_idx").on(table.type),
  ],
);

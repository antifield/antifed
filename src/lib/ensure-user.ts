import { eq, sql } from "drizzle-orm";
import type { User } from "discord.js";
import { db } from "~/db";
import { users } from "~/db/schema";

export async function ensureUser(discordUser: User): Promise<typeof users.$inferSelect> {
  const existing = await db.select().from(users).where(eq(users.discordId, discordUser.id)).get();

  if (existing) {
    if (existing.username !== discordUser.username) {
      await db
        .update(users)
        .set({
          username: discordUser.username,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(users.id, existing.id));

      return { ...existing, username: discordUser.username };
    }
    return existing;
  }

  const [inserted] = await db
    .insert(users)
    .values({
      discordId: discordUser.id,
      username: discordUser.username,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return inserted;

  const racedRow = await db.select().from(users).where(eq(users.discordId, discordUser.id)).get();

  if (!racedRow) throw new Error(`ensureUser: failed to insert or fetch user ${discordUser.id}`);
  return racedRow;
}

import { Events, type GuildMember } from "discord.js";
import { count, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { infractions, notes, users } from "~/db/schema";
import { Colors } from "~/lib/constants";
import { Cooldown } from "~/lib/cooldown";
import { modEmbed } from "~/lib/embeds";
import { formatError } from "~/lib/errors";
import { INFRACTION_TYPES } from "~/lib/infractions";
import { log } from "~/lib/logger";
import { sendModLog } from "~/lib/mod-log";
import type { Event } from "~/types";

// Cap one alert per member per window: a member with a removed/kick/warn record
// (an active ban can't rejoin) could otherwise leave and rejoin on a standing
// invite repeatedly to flood the mod-log.
const alertCooldown = new Cooldown(10 * 60_000);

// Staff asked to be alerted when a member with any prior infraction history
// rejoins — including users who were banned and later unbanned (the row is kept
// with active=false), so the trigger counts removed infractions too. Notes are
// shown for context but do not trigger the alert on their own. Inert when the
// log channel is unset (sendModLog no-ops).
export default {
  name: Events.GuildMemberAdd,
  once: false,
  async execute(member: GuildMember) {
    if (member.user.bot) return;

    try {
      const dbUser = await db.select().from(users).where(eq(users.discordId, member.id)).get();
      if (!dbUser) return; // never recorded — nothing to flag

      const rows = await db
        .select()
        .from(infractions)
        .where(eq(infractions.userId, dbUser.id))
        .orderBy(desc(infractions.createdAt))
        .all();
      if (rows.length === 0) return; // recorded, but no infractions

      if (!alertCooldown.claim(member.id)) return;

      const noteCountRow = await db
        .select({ value: count() })
        .from(notes)
        .where(eq(notes.userId, dbUser.id))
        .get();
      const noteCount = noteCountRow?.value ?? 0;

      // Per-type tally, flagging how many of each were since removed so staff
      // can tell "actively carries a record" from "was actioned, since cleared".
      const summary = INFRACTION_TYPES.map((type) => {
        const ofType = rows.filter((r) => r.type === type);
        if (ofType.length === 0) return null;
        const removed = ofType.filter((r) => !r.active).length;
        const label = `${ofType.length} ${type}${ofType.length === 1 ? "" : "s"}`;
        return removed > 0 ? `${label} (${removed} removed)` : label;
      })
        .filter((s): s is string => s !== null)
        .join(" • ");

      const mostRecent = rows[0]!;
      const createdTs = Math.floor(member.user.createdAt.getTime() / 1000);
      const lastActionedTs = Math.floor(new Date(mostRecent.createdAt).getTime() / 1000);
      const noteSuffix = noteCount > 0 ? ` • ${noteCount} note${noteCount === 1 ? "" : "s"}` : "";

      await sendModLog(
        member.guild,
        modEmbed({
          title: "Flagged Member Rejoined",
          description: [
            `<@${member.id}> \`${member.id}\` rejoined — they have a prior record.`,
            "",
            `Account created <t:${createdTs}:R> • Last actioned <t:${lastActionedTs}:R>`,
            `**Record:** ${summary}${noteSuffix}`,
          ].join("\n"),
          color: Colors.Warn,
          target: member.user,
          fields: [{ name: `Most recent — ${mostRecent.type}`, value: mostRecent.reason || "—" }],
        }),
      );

      log.info({
        action: "rejoin-alert",
        status: "flagged",
        targetId: member.id,
        username: member.user.username,
        infractions: rows.length,
        notes: noteCount,
      });
    } catch (err) {
      log.error({
        action: "rejoin-alert",
        status: "failed",
        targetId: member.id,
        error: formatError(err),
      });
    }
  },
} satisfies Event<Events.GuildMemberAdd>;

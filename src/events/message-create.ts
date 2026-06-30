import {
  Events,
  type Guild,
  type GuildMember,
  type Message,
  PermissionFlagsBits,
} from "discord.js";
import { Colors, DM_FAILED_MESSAGE } from "~/lib/constants";
import { trySendDm } from "~/lib/dm";
import { dmEmbed, modEmbed } from "~/lib/embeds";
import { formatError } from "~/lib/errors";
import { canModerate } from "~/lib/hierarchy";
import { recordInfraction } from "~/lib/infractions";
import { log } from "~/lib/logger";
import { sendModLog } from "~/lib/mod-log";
import { memberHasStaffRole } from "~/lib/role-gates";
import { env } from "~/env";
import type { Event } from "~/types";

const BAN_REASON = "Suspected spam bot (posted in honeypot channel)";
const PURGE_SECONDS = 7 * 86400; // wipe the spammer's last 7 days of messages on ban
const AUDIT_FAILED_MESSAGE = "\n*Ban succeeded, but writing the audit record failed.*";

// Tracks authors currently being processed so a burst of messages from one
// spammer (which all arrive before the ban round-trips) results in a single
// ban, DM, and infraction row rather than one per message.
const inFlight = new Set<string>();

// Structural gate: a non-system, non-webhook message in the honeypot channel
// from a guild member who isn't us or the guild owner. Member-dependent
// exemptions (staff/admin/hierarchy) are checked separately in execute() once
// the member is resolved, since that can require an async fetch. The owner check
// lives here (by author id) so it holds even when the member object is uncached.
// The channel check is first because it runs on every message in the server.
function isHoneypotHit(message: Message, honeypotChannelId: string): message is Message<true> {
  if (message.channelId !== honeypotChannelId) return false;
  // inGuild() gates every message.guild access below — it is what makes the
  // Message<true> narrowing sound, so it must stay ahead of those reads.
  if (!message.inGuild() || message.system || message.webhookId) return false;
  if (message.author.id === message.client.user?.id) return false;
  if (message.author.id === message.guild.ownerId) return false;
  return true;
}

// Members the honeypot must never auto-ban: staff, admins, or anyone the bot
// couldn't ban anyway (role hierarchy). Mirrors the guards on /mod ban so the
// trap can't act on someone the manual command would itself refuse to touch.
function isPrivilegedMember(guild: Guild, member: GuildMember): boolean {
  if (memberHasStaffRole(member)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const me = guild.members.me;
  return me ? !canModerate(me, member) : false;
}

export default {
  name: Events.MessageCreate,
  once: false,
  async execute(message: Message) {
    const honeypotChannelId = env.HONEYPOT_CHANNEL_ID;
    if (!honeypotChannelId) return; // honeypot disabled
    if (!isHoneypotHit(message, honeypotChannelId)) return;
    if (inFlight.has(message.author.id)) return;

    const botUser = message.client.user;
    if (!botUser) return;

    // Claim the author synchronously, before any await, so a burst of messages
    // dedupes to a single ban even while the steps below are in flight.
    inFlight.add(message.author.id);
    try {
      // Resolve the member so the privilege exemptions run against real roles and
      // permissions. message.member is normally populated for guild messages but
      // can be null when uncached; fetch it then, and if even that fails, skip —
      // a permanent ban must never act on a member we couldn't verify.
      let fetchError: unknown;
      const member =
        message.member ??
        (await message.guild.members.fetch(message.author.id).catch((err: unknown) => {
          fetchError = err;
          return null;
        }));
      if (!member) {
        log.warn({
          action: "honeypot-ban",
          status: "member_unresolved",
          targetId: message.author.id,
          error: formatError(fetchError),
        });
        // Same visibility principle as the ban-failure path: a honeypot hit we
        // couldn't act on must not vanish silently. Tell staff it was skipped.
        await sendModLog(
          message.guild,
          modEmbed({
            title: "Auto-Ban Skipped",
            description: `**${message.author.username}** posted in the honeypot channel, but their member record couldn't be resolved — the auto-ban was **skipped**. Review manually.`,
            color: Colors.Warn,
            moderator: botUser,
            target: message.author,
            fields: [{ name: "Reason", value: BAN_REASON }],
          }),
        );
        return;
      }
      if (isPrivilegedMember(message.guild, member)) return;

      // DM before the ban so the user still shares a guild with us and the
      // message can actually be delivered. trySendDm logs any failure.
      const dmStatus = (await trySendDm(
        message.author,
        dmEmbed({
          title: "You have been banned",
          description: BAN_REASON,
          color: Colors.Ban,
          serverName: message.guild.name,
        }),
      ))
        ? "sent"
        : "failed";

      try {
        await message.guild.members.ban(message.author, {
          reason: BAN_REASON,
          deleteMessageSeconds: PURGE_SECONDS,
        });
      } catch (err) {
        log.error({
          action: "honeypot-ban",
          status: "ban_failed",
          targetId: message.author.id,
          dmStatus,
          error: formatError(err),
        });
        // Surface the failure where staff actually look. Without this the trap
        // silently no-ops on a permission/hierarchy/API error while the user has
        // already been told (via the DM above) that they were banned.
        const dmNote =
          dmStatus === "sent" ? "\n*The user was already DM'd that they were banned.*" : "";
        await sendModLog(
          message.guild,
          modEmbed({
            title: "Auto-Ban Failed",
            description: `**${message.author.username}** posted in the honeypot channel, but the auto-ban failed — **manual action needed**.${dmNote}`,
            color: Colors.Ban,
            moderator: botUser,
            target: message.author,
            fields: [
              { name: "Reason", value: BAN_REASON },
              {
                name: "Error",
                value: (err instanceof Error ? err.message : String(err)) || "unknown error",
              },
            ],
          }),
        );
        return;
      }

      const persisted = await recordInfraction({
        targetUser: message.author,
        moderatorId: botUser.id,
        type: "ban",
        reason: BAN_REASON,
      });

      const description = [`**${message.author.username}** was auto-banned (suspected spam bot).`];
      if (dmStatus === "failed") description.push(DM_FAILED_MESSAGE);
      if (!persisted) description.push(AUDIT_FAILED_MESSAGE);

      await sendModLog(
        message.guild,
        modEmbed({
          title: "User Auto-Banned",
          description: description.join(""),
          color: Colors.Ban,
          moderator: botUser,
          target: message.author,
          fields: [{ name: "Reason", value: BAN_REASON }],
        }),
      );

      log.info({
        action: "honeypot-ban",
        status: "banned",
        targetId: message.author.id,
        username: message.author.username,
        dmStatus,
        persisted,
      });
    } finally {
      inFlight.delete(message.author.id);
    }
  },
} satisfies Event<Events.MessageCreate>;

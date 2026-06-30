import { Events, type Message } from "discord.js";
import { Colors, DM_FAILED_MESSAGE } from "~/lib/constants";
import { trySendDm } from "~/lib/dm";
import { dmEmbed, modEmbed } from "~/lib/embeds";
import { formatError } from "~/lib/errors";
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

// A message worth banning for: a guild member posting in the honeypot channel
// who isn't us, a webhook, a system event, or staff. The channel check is first
// because it runs on every message in the server; the rest only on a hit.
function isHoneypotHit(message: Message, honeypotChannelId: string): message is Message<true> {
  if (message.channelId !== honeypotChannelId) return false;
  if (!message.inGuild() || message.system || message.webhookId) return false;
  if (message.author.id === message.client.user?.id) return false;
  return !memberHasStaffRole(message.member);
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

    inFlight.add(message.author.id);
    try {
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

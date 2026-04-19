import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type User,
} from "discord.js";
import { db } from "~/db";
import { infractions } from "~/db/schema";
import { Colors, DM_FAILED_MESSAGE } from "~/lib/constants";
import { dmEmbed, errorEmbed, modEmbed } from "~/lib/embeds";
import { ensureUser } from "~/lib/ensure-user";
import { canModerate, formatHierarchyError } from "~/lib/hierarchy";
import { useInteractionLog } from "~/lib/log-context";
import { log } from "~/lib/logger";
import { sendModLog } from "~/lib/mod-log";
import type { Command } from "~/types";

const SILENT_DESC = "Hide the confirmation from the channel (mod-log still fires)";
const AUDIT_FAILED_MESSAGE =
  "\n*Action completed, but writing the audit record failed — please tell a dev.*";

type InfractionType = "ban" | "warn" | "kick" | "softban";

export default {
  data: new SlashCommandBuilder()
    .setName("mod")
    .setDescription("Moderation actions.")
    .addSubcommand((sub) =>
      sub
        .setName("warn")
        .setDescription("Warn a user.")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to warn").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason for the warning").setRequired(true),
        )
        .addBooleanOption((o) => o.setName("silent").setDescription(SILENT_DESC)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("kick")
        .setDescription("Kick a user from the server.")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to kick").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason for the kick").setRequired(true),
        )
        .addBooleanOption((o) => o.setName("silent").setDescription(SILENT_DESC)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("softban")
        .setDescription("Ban and immediately unban to purge messages.")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to softban").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason for the softban").setRequired(true),
        )
        .addBooleanOption((o) => o.setName("silent").setDescription(SILENT_DESC)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ban")
        .setDescription("Permanently ban a user from the server.")
        .addUserOption((o) => o.setName("user").setDescription("The user to ban").setRequired(true))
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason for the ban").setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("delete_messages")
            .setDescription("Days of messages to delete (0-7)")
            .setMinValue(0)
            .setMaxValue(7),
        )
        .addBooleanOption((o) => o.setName("silent").setDescription(SILENT_DESC)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  requiredRole: "staff",

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    useInteractionLog()?.set({ subcommand: sub });

    if (sub === "warn") return handleWarn(interaction);
    if (sub === "kick") return handleKick(interaction);
    if (sub === "softban") return handleSoftban(interaction);
    if (sub === "ban") return handleBan(interaction);
  },
} satisfies Command;

async function trySendDm(user: User, embed: ReturnType<typeof dmEmbed>): Promise<boolean> {
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

function isOwnerWhenAbsent(guild: Guild, targetUser: User): boolean {
  return targetUser.id === guild.ownerId;
}

async function deferFor(interaction: ChatInputCommandInteraction, silent: boolean) {
  if (silent) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  else await interaction.deferReply();
}

async function recordInfraction(params: {
  targetUser: User;
  moderatorId: string;
  type: InfractionType;
  reason: string;
}): Promise<boolean> {
  try {
    const dbUser = await ensureUser(params.targetUser);
    await db.insert(infractions).values({
      userId: dbUser.id,
      moderatorId: params.moderatorId,
      type: params.type,
      reason: params.reason,
    });
    return true;
  } catch (err) {
    log.error({
      action: "infraction-insert",
      type: params.type,
      targetId: params.targetUser.id,
      moderatorId: params.moderatorId,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    useInteractionLog()?.set({ audit_persist: "failed" });
    return false;
  }
}

async function handleWarn(interaction: ChatInputCommandInteraction) {
  const silent = interaction.options.getBoolean("silent") ?? false;
  await deferFor(interaction, silent);

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const guild = interaction.guild!;

  useInteractionLog()?.set({
    target: { id: targetUser.id, username: targetUser.username },
    reason_length: reason.length,
  });

  // Warn has no Discord-side action, so DM and DB are the two writes; order them
  // so a DM failure doesn't skip the audit record, and a DB failure doesn't skip
  // the user-facing notification.
  const dmSent = await trySendDm(
    targetUser,
    dmEmbed({
      title: "You have been warned",
      description: reason,
      color: Colors.Warn,
      serverName: guild.name,
    }),
  );

  const persisted = await recordInfraction({
    targetUser,
    moderatorId: interaction.user.id,
    type: "warn",
    reason,
  });

  const description = [`**${targetUser.username}** has been warned.`];
  if (!dmSent) description.push(DM_FAILED_MESSAGE);
  if (!persisted) description.push(AUDIT_FAILED_MESSAGE);

  const baseOpts = {
    title: "User Warned",
    description: description.join(""),
    color: Colors.Warn,
    target: targetUser,
    fields: [{ name: "Reason", value: reason }],
  };

  const logEmbed = modEmbed({ ...baseOpts, moderator: interaction.user });
  const replyEmbed = silent ? logEmbed : modEmbed(baseOpts);

  await interaction.editReply({ embeds: [replyEmbed] });
  await sendModLog(guild, logEmbed);
}

async function handleKick(interaction: ChatInputCommandInteraction) {
  const silent = interaction.options.getBoolean("silent") ?? false;
  await deferFor(interaction, silent);

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);

  const guild = interaction.guild!;
  const moderator = await guild.members.fetch(interaction.user.id);
  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

  useInteractionLog()?.set({
    target: { id: targetUser.id, in_guild: targetMember !== null },
  });

  if (!targetMember) {
    await interaction.editReply({ embeds: [errorEmbed("User is not in the server.")] });
    return;
  }

  if (!canModerate(moderator, targetMember)) {
    await interaction.editReply({
      embeds: [errorEmbed(formatHierarchyError(targetMember))],
    });
    return;
  }

  try {
    await targetMember.kick(`${reason} | ${interaction.user.username}`);
  } catch (err) {
    log.error({
      action: "kick",
      targetId: targetUser.id,
      moderatorId: interaction.user.id,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    await interaction.editReply({
      embeds: [errorEmbed("Failed to kick. Check bot permissions and try again.")],
    });
    return;
  }

  // DM AFTER the action so we never falsely tell a user they've been kicked.
  const dmSent = await trySendDm(
    targetUser,
    dmEmbed({
      title: "You have been kicked",
      description: reason,
      color: Colors.Ban,
      serverName: guild.name,
    }),
  );

  const persisted = await recordInfraction({
    targetUser,
    moderatorId: interaction.user.id,
    type: "kick",
    reason,
  });

  const description = [`**${targetUser.username}** has been kicked.`];
  if (!dmSent) description.push(DM_FAILED_MESSAGE);
  if (!persisted) description.push(AUDIT_FAILED_MESSAGE);

  const baseOpts = {
    title: "User Kicked",
    description: description.join(""),
    color: Colors.Ban,
    target: targetUser,
    fields: [{ name: "Reason", value: reason }],
  };

  const logEmbed = modEmbed({ ...baseOpts, moderator: interaction.user });
  const replyEmbed = silent ? logEmbed : modEmbed(baseOpts);

  await interaction.editReply({ embeds: [replyEmbed] });
  await sendModLog(guild, logEmbed);
}

async function handleSoftban(interaction: ChatInputCommandInteraction) {
  const silent = interaction.options.getBoolean("silent") ?? false;
  await deferFor(interaction, silent);

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);

  const guild = interaction.guild!;
  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

  useInteractionLog()?.set({
    target: { id: targetUser.id, in_guild: targetMember !== null },
  });

  if (targetMember) {
    const moderator = await guild.members.fetch(interaction.user.id);
    if (!canModerate(moderator, targetMember)) {
      await interaction.editReply({
        embeds: [errorEmbed(formatHierarchyError(targetMember))],
      });
      return;
    }
  } else if (isOwnerWhenAbsent(guild, targetUser)) {
    await interaction.editReply({ embeds: [errorEmbed("Cannot softban the server owner.")] });
    return;
  }

  try {
    await guild.members.ban(targetUser, {
      reason: `Softban | ${reason} | ${interaction.user.username}`,
      deleteMessageSeconds: 7 * 86400,
    });
    await guild.members.unban(targetUser, "Softban - immediate unban");
  } catch (err) {
    log.error({
      action: "softban",
      targetId: targetUser.id,
      moderatorId: interaction.user.id,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    await interaction.editReply({
      embeds: [
        errorEmbed("Failed to softban. The user may still be banned — check the audit log."),
      ],
    });
    return;
  }

  const dmSent = await trySendDm(
    targetUser,
    dmEmbed({
      title: "You have been removed",
      description: reason,
      color: Colors.Ban,
      serverName: guild.name,
    }),
  );

  const persisted = await recordInfraction({
    targetUser,
    moderatorId: interaction.user.id,
    type: "softban",
    reason,
  });

  const description = [`**${targetUser.username}** has been softbanned (messages purged).`];
  if (!dmSent) description.push(DM_FAILED_MESSAGE);
  if (!persisted) description.push(AUDIT_FAILED_MESSAGE);

  const baseOpts = {
    title: "User Softbanned",
    description: description.join(""),
    color: Colors.Ban,
    target: targetUser,
    fields: [{ name: "Reason", value: reason }],
  };

  const logEmbed = modEmbed({ ...baseOpts, moderator: interaction.user });
  const replyEmbed = silent ? logEmbed : modEmbed(baseOpts);

  await interaction.editReply({ embeds: [replyEmbed] });
  await sendModLog(guild, logEmbed);
}

async function handleBan(interaction: ChatInputCommandInteraction) {
  const silent = interaction.options.getBoolean("silent") ?? false;
  await deferFor(interaction, silent);

  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const deleteMessages = interaction.options.getInteger("delete_messages") ?? 0;

  const guild = interaction.guild!;
  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

  useInteractionLog()?.set({
    target: { id: targetUser.id, in_guild: targetMember !== null },
    delete_messages_days: deleteMessages,
  });

  if (targetMember) {
    const moderator = await guild.members.fetch(interaction.user.id);
    if (!canModerate(moderator, targetMember)) {
      await interaction.editReply({
        embeds: [errorEmbed(formatHierarchyError(targetMember))],
      });
      return;
    }
  } else if (isOwnerWhenAbsent(guild, targetUser)) {
    await interaction.editReply({ embeds: [errorEmbed("Cannot ban the server owner.")] });
    return;
  }

  try {
    await guild.members.ban(targetUser, {
      reason: `${reason} | ${interaction.user.username}`,
      deleteMessageSeconds: deleteMessages * 86400,
    });
  } catch (err) {
    log.error({
      action: "ban",
      targetId: targetUser.id,
      moderatorId: interaction.user.id,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    await interaction.editReply({
      embeds: [errorEmbed("Failed to ban. Check bot permissions and try again.")],
    });
    return;
  }

  const dmSent = await trySendDm(
    targetUser,
    dmEmbed({
      title: "You have been banned",
      description: reason,
      color: Colors.Ban,
      serverName: guild.name,
    }),
  );

  const persisted = await recordInfraction({
    targetUser,
    moderatorId: interaction.user.id,
    type: "ban",
    reason,
  });

  const description = [`**${targetUser.username}** has been banned.`];
  if (!dmSent) description.push(DM_FAILED_MESSAGE);
  if (!persisted) description.push(AUDIT_FAILED_MESSAGE);

  const baseOpts = {
    title: "User Banned",
    description: description.join(""),
    color: Colors.Ban,
    target: targetUser,
    fields: [{ name: "Reason", value: reason }],
  };

  const logEmbed = modEmbed({ ...baseOpts, moderator: interaction.user });
  const replyEmbed = silent ? logEmbed : modEmbed(baseOpts);

  await interaction.editReply({ embeds: [replyEmbed] });
  await sendModLog(guild, logEmbed);
}

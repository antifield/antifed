import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { infractions, users } from "~/db/schema";
import { Colors } from "~/lib/constants";
import { errorEmbed, infoEmbed, modEmbed } from "~/lib/embeds";
import { useInteractionLog } from "~/lib/log-context";
import { log } from "~/lib/logger";
import { sendModLog } from "~/lib/mod-log";
import { sendPaginatedEmbeds } from "~/lib/pagination";
import { buildInfractionPages } from "~/lib/record-pages";
import { hasDevRole } from "~/lib/role-gates";
import type { Command } from "~/types";

const INFRACTION_TYPES = ["ban", "warn", "kick", "softban"] as const;
type InfractionType = (typeof INFRACTION_TYPES)[number];

// Discord API error code for "Unknown Ban" — user isn't currently banned.
// Treat this as success: something already unbanned them (manual action, another tool).
const DISCORD_UNKNOWN_BAN = 10026;

function isInfractionType(value: string): value is InfractionType {
  return (INFRACTION_TYPES as readonly string[]).includes(value);
}

function isUnknownBanError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && "code" in err && err.code === DISCORD_UNKNOWN_BAN
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName("infraction")
    .setDescription("View and manage infractions.")
    .addSubcommand((sub) =>
      sub
        .setName("check")
        .setDescription("View a user's infractions.")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to look up").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("type")
            .setDescription("Filter by type")
            .addChoices(
              { name: "All", value: "all" },
              { name: "Bans", value: "ban" },
              { name: "Warnings", value: "warn" },
              { name: "Kicks", value: "kick" },
              { name: "Softbans", value: "softban" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Deactivate an infraction.")
        .addIntegerOption((o) =>
          o
            .setName("id")
            .setDescription("The infraction ID (shown in /infraction check)")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Clear all infractions for a user. (Dev only)")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to clear").setRequired(true),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  requiredRole: "staff",

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    useInteractionLog()?.set({ subcommand: sub });

    if (sub === "check") return handleCheck(interaction);
    if (sub === "remove") return handleRemove(interaction);
    if (sub === "clear") return handleClear(interaction);
  },
} satisfies Command;

async function handleCheck(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("user", true);
  const typeFilter = interaction.options.getString("type") ?? "all";

  const dbUser = await db.select().from(users).where(eq(users.discordId, targetUser.id)).get();

  if (!dbUser) {
    await interaction.editReply({
      embeds: [infoEmbed(`No infractions found for **${targetUser.username}**.`)],
    });
    return;
  }

  const conditions = [eq(infractions.userId, dbUser.id)];
  if (typeFilter !== "all" && isInfractionType(typeFilter)) {
    conditions.push(eq(infractions.type, typeFilter));
  }

  const records = await db
    .select()
    .from(infractions)
    .where(and(...conditions))
    .orderBy(desc(infractions.createdAt))
    .all();

  if (records.length === 0) {
    await interaction.editReply({
      embeds: [
        infoEmbed(
          `No ${typeFilter === "all" ? "" : typeFilter + " "}infractions found for **${targetUser.username}**.`,
        ),
      ],
    });
    return;
  }

  const pages = buildInfractionPages(records, targetUser, { showFooter: true });
  await sendPaginatedEmbeds(interaction, pages);
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const id = interaction.options.getInteger("id", true);
  const record = await db.select().from(infractions).where(eq(infractions.id, id)).get();

  useInteractionLog()?.set({ infraction_id: id, infraction_found: record !== undefined });

  if (!record) {
    await interaction.editReply({ embeds: [errorEmbed(`Infraction \`#${id}\` not found.`)] });
    return;
  }

  if (!record.active) {
    await interaction.editReply({
      embeds: [errorEmbed(`Infraction \`#${id}\` is already inactive.`)],
    });
    return;
  }

  const user = await db.select().from(users).where(eq(users.id, record.userId)).get();

  // For bans, unban on Discord FIRST. Only mark the row inactive once Discord agrees —
  // otherwise a failed unban leaves the row claiming "Removed" while the user is still
  // banned. If Discord reports "Unknown Ban" (already unbanned externally), we treat
  // that as success and still clear the row.
  let unbanNote: string | null = null;
  if (record.type === "ban" && user) {
    try {
      await interaction.guild!.members.unban(
        user.discordId,
        `Infraction #${id} removed by ${interaction.user.username}`,
      );
      unbanNote = "User has been unbanned from the server.";
    } catch (err) {
      if (isUnknownBanError(err)) {
        unbanNote = "Note: user was not currently banned on Discord.";
      } else {
        const message = err instanceof Error ? err.message : String(err);
        log.error({
          action: "infraction-remove-unban",
          infractionId: id,
          targetDiscordId: user.discordId,
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
        await interaction.editReply({
          embeds: [
            errorEmbed(
              `Could not unban <@${user.discordId}>: ${message}\n\nInfraction \`#${id}\` was **not** removed. Resolve the Discord side, then retry.`,
            ),
          ],
        });
        return;
      }
    }
  }

  await db.update(infractions).set({ active: false }).where(eq(infractions.id, id));

  const lines = [
    `Infraction \`#${id}\` has been deactivated.`,
    "",
    `**User:** ${user ? `<@${user.discordId}>` : "Unknown"}`,
    `**Type:** ${record.type}`,
    `**Reason:** ${record.reason}`,
  ];
  if (unbanNote) lines.push("", unbanNote);

  const embed = modEmbed({
    title: "Infraction Removed",
    description: lines.join("\n"),
    color: Colors.Success,
    moderator: interaction.user,
  });

  await interaction.editReply({ embeds: [embed] });
  await sendModLog(interaction.guild!, embed);
}

async function handleClear(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!hasDevRole(interaction)) {
    await interaction.editReply({
      embeds: [errorEmbed("This subcommand is restricted to bot developers.")],
    });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const dbUser = await db.select().from(users).where(eq(users.discordId, targetUser.id)).get();

  if (!dbUser) {
    await interaction.editReply({
      embeds: [infoEmbed(`No infractions found for **${targetUser.username}**.`)],
    });
    return;
  }

  // Get active ban rows before we mark them inactive, so we can attempt to unban
  // the user on Discord. Clearing DB rows without unbanning leaves the live ban
  // in place, which confused staff before.
  const activeBans = await db
    .select()
    .from(infractions)
    .where(
      and(
        eq(infractions.userId, dbUser.id),
        eq(infractions.type, "ban"),
        eq(infractions.active, true),
      ),
    )
    .all();

  const updated = await db
    .update(infractions)
    .set({ active: false })
    .where(eq(infractions.userId, dbUser.id))
    .returning();

  const unbanResult =
    activeBans.length > 0 ? await tryUnban(interaction.guild!, targetUser.id) : null;

  const lines = [`Deactivated **${updated.length}** infractions for **${targetUser.username}**.`];
  if (unbanResult) lines.push("", unbanResult);

  const embed = modEmbed({
    title: "Infractions Cleared",
    description: lines.join("\n"),
    color: Colors.Success,
    moderator: interaction.user,
    target: targetUser,
  });

  await interaction.editReply({ embeds: [embed] });
  await sendModLog(interaction.guild!, embed);
}

async function tryUnban(guild: Guild, discordId: string): Promise<string> {
  try {
    await guild.members.unban(discordId, "Infractions cleared (dev)");
    return "User has been unbanned from the server.";
  } catch (err) {
    if (isUnknownBanError(err)) {
      return "Note: user was not currently banned on Discord.";
    }
    log.error({
      action: "infraction-clear-unban",
      targetDiscordId: discordId,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    return `\u26A0\uFE0F Could not unban <@${discordId}> — resolve manually.`;
  }
}

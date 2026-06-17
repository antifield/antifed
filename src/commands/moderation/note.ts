import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { desc, eq } from "drizzle-orm";
import { db } from "~/db";
import { notes, users } from "~/db/schema";
import { Colors } from "~/lib/constants";
import { errorEmbed, infoEmbed, modEmbed } from "~/lib/embeds";
import { ensureUser } from "~/lib/ensure-user";
import { formatError } from "~/lib/errors";
import { useInteractionLog } from "~/lib/log-context";
import { log } from "~/lib/logger";
import { replyAndLog } from "~/lib/mod-reply";
import { sendPaginatedEmbeds } from "~/lib/pagination";
import { buildNotePages } from "~/lib/record-pages";
import { hasDevRole } from "~/lib/role-gates";
import type { Command } from "~/types";

export default {
  data: new SlashCommandBuilder()
    .setName("note")
    .setDescription("View and manage staff notes.")
    .addSubcommand((sub) =>
      sub
        .setName("check")
        .setDescription("View staff notes for a user.")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to look up").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a staff note to a user's record.")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to add a note to").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("content").setDescription("The note content").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Delete a staff note.")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("The note ID (shown in /note check)").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Clear all notes for a user. (Dev only)")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to clear").setRequired(true),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  requiredRole: "staff",

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    useInteractionLog()?.set({ subcommand: sub });

    if (sub === "check") return handleCheck(interaction);
    if (sub === "add") return handleAdd(interaction);
    if (sub === "remove") return handleRemove(interaction);
    if (sub === "clear") return handleClear(interaction);
  },
} satisfies Command;

async function handleCheck(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("user", true);
  const dbUser = await db.select().from(users).where(eq(users.discordId, targetUser.id)).get();

  if (!dbUser) {
    await interaction.editReply({
      embeds: [infoEmbed(`No notes found for **${targetUser.username}**.`)],
    });
    return;
  }

  const records = await db
    .select()
    .from(notes)
    .where(eq(notes.userId, dbUser.id))
    .orderBy(desc(notes.createdAt))
    .all();

  if (records.length === 0) {
    await interaction.editReply({
      embeds: [infoEmbed(`No notes found for **${targetUser.username}**.`)],
    });
    return;
  }

  const pages = buildNotePages(records, targetUser, { showFooter: true });
  await sendPaginatedEmbeds(interaction, pages);
}

async function handleAdd(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("user", true);
  const content = interaction.options.getString("content", true);

  useInteractionLog()?.set({
    target: { id: targetUser.id, username: targetUser.username },
    content_length: content.length,
  });

  try {
    const dbUser = await ensureUser(targetUser);
    await db.insert(notes).values({
      userId: dbUser.id,
      authorId: interaction.user.id,
      content,
    });
  } catch (err) {
    log.error({
      action: "note-insert",
      targetId: targetUser.id,
      moderatorId: interaction.user.id,
      error: formatError(err),
    });
    await interaction.editReply({
      embeds: [errorEmbed("Failed to save the note. Try again; if it persists, tell a dev.")],
    });
    return;
  }

  const embed = modEmbed({
    title: "Note Added",
    description: `Added a note to **${targetUser.username}**'s record.`,
    color: Colors.Note,
    moderator: interaction.user,
    target: targetUser,
    fields: [{ name: "Content", value: content }],
  });

  await replyAndLog(interaction, interaction.guild!, { reply: embed });
}

async function handleRemove(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const id = interaction.options.getInteger("id", true);
  const record = await db.select().from(notes).where(eq(notes.id, id)).get();

  if (!record) {
    await interaction.editReply({ embeds: [errorEmbed(`Note \`#${id}\` not found.`)] });
    return;
  }

  await db.delete(notes).where(eq(notes.id, id));
  const user = await db.select().from(users).where(eq(users.id, record.userId)).get();

  const embed = modEmbed({
    title: "Note Removed",
    description: [
      `Note \`#${id}\` has been deleted.`,
      "",
      `**User:** ${user ? `<@${user.discordId}>` : "Unknown"}`,
      `**Content:** ${record.content}`,
    ].join("\n"),
    color: Colors.Success,
    moderator: interaction.user,
  });

  await replyAndLog(interaction, interaction.guild!, { reply: embed });
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
      embeds: [infoEmbed(`No notes found for **${targetUser.username}**.`)],
    });
    return;
  }

  const deleted = await db.delete(notes).where(eq(notes.userId, dbUser.id)).returning();

  const embed = modEmbed({
    title: "Notes Cleared",
    description: `Deleted **${deleted.length}** notes for **${targetUser.username}**.`,
    color: Colors.Success,
    moderator: interaction.user,
    target: targetUser,
  });

  await replyAndLog(interaction, interaction.guild!, { reply: embed });
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { count, desc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { infractions, notes, users } from "~/db/schema";
import { chunk } from "~/lib/chunk";
import { Colors, INFRACTIONS_PER_PAGE } from "~/lib/constants";
import { infoEmbed } from "~/lib/embeds";
import { useInteractionLog } from "~/lib/log-context";
import { sendPaginatedEmbeds } from "~/lib/pagination";
import { buildInfractionPages, buildNotePages } from "~/lib/record-pages";
import type { Command } from "~/types";

export default {
  data: new SlashCommandBuilder()
    .setName("user")
    .setDescription("User lookups and audit.")
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("View an overview of a user's record.")
        .addUserOption((o) =>
          o.setName("user").setDescription("The user to look up").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("audit")
        .setDescription("View a staff member's moderation actions.")
        .addUserOption((o) =>
          o.setName("staff").setDescription("The staff member to audit").setRequired(true),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  requiredRole: "staff",

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    useInteractionLog()?.set({ subcommand: sub });

    if (sub === "info") return handleInfo(interaction);
    if (sub === "audit") return handleAudit(interaction);
  },
} satisfies Command;

async function handleInfo(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("user", true);
  const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);

  const dbUser = await db.select().from(users).where(eq(users.discordId, targetUser.id)).get();

  let bans = 0;
  let warns = 0;
  let kicks = 0;
  let softbans = 0;
  let noteCount = 0;
  let totalInfractions = 0;

  if (dbUser) {
    // The per-type counts below reflect currently-active infractions only — a user
    // whose infractions were `/infraction remove`d shows 0 and the color drops back
    // to Info, so removed actions don't permanently mark the profile. The button +
    // drill-down, however, cover the whole record (every type, active or removed),
    // so `totalInfractions` counts all rows.
    const [infractionRows, noteRow] = await Promise.all([
      db
        .select({ type: infractions.type, active: infractions.active })
        .from(infractions)
        .where(eq(infractions.userId, dbUser.id)),
      db.select({ value: count() }).from(notes).where(eq(notes.userId, dbUser.id)),
    ]);
    totalInfractions = infractionRows.length;
    const activeOfType = (type: "ban" | "warn" | "kick" | "softban") =>
      infractionRows.filter((r) => r.type === type && r.active).length;
    bans = activeOfType("ban");
    warns = activeOfType("warn");
    kicks = activeOfType("kick");
    softbans = activeOfType("softban");
    noteCount = noteRow[0]?.value ?? 0;
  }

  const createdTs = Math.floor(targetUser.createdAt.getTime() / 1000);
  const joinedTs = member?.joinedAt ? Math.floor(member.joinedAt.getTime() / 1000) : null;

  const lines = [
    `<@${targetUser.id}> \`${targetUser.id}\``,
    "",
    `Created <t:${createdTs}:R> \u2022 Joined ${joinedTs ? `<t:${joinedTs}:R>` : "N/A"}`,
    "",
    `**${bans}** bans \u2022 **${warns}** warnings \u2022 **${kicks}** kicks \u2022 **${softbans}** softbans \u2022 **${noteCount}** notes`,
  ];

  const embed = new EmbedBuilder()
    .setAuthor({
      name: targetUser.username,
      iconURL: targetUser.displayAvatarURL(),
    })
    .setThumbnail(targetUser.displayAvatarURL())
    .setColor(
      bans > 0 || softbans > 0 ? Colors.Ban : warns > 0 || kicks > 0 ? Colors.Warn : Colors.Info,
    )
    .setDescription(lines.join("\n"))
    .setTimestamp();

  const nonce = `info_${interaction.id}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${nonce}_infractions`)
      .setLabel(`Infractions (${totalInfractions})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalInfractions === 0),
    new ButtonBuilder()
      .setCustomId(`${nonce}_notes`)
      .setLabel(`Notes (${noteCount})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(noteCount === 0),
  );

  const message = await interaction.editReply({ embeds: [embed], components: [row] });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.customId.startsWith(nonce) && i.user.id === interaction.user.id,
    time: 120_000,
  });

  let drilledDown = false;

  collector.on("collect", async (i) => {
    const action = i.customId.replace(`${nonce}_`, "");
    if (!dbUser) {
      await i.update({});
      return;
    }

    if (action === "infractions") {
      const records = await db
        .select()
        .from(infractions)
        .where(eq(infractions.userId, dbUser.id))
        .orderBy(desc(infractions.createdAt))
        .all();

      if (records.length === 0) {
        await i.update({
          embeds: [infoEmbed(`No infractions found for **${targetUser.username}**.`)],
          components: [],
        });
        return;
      }

      const pages = buildInfractionPages(records, targetUser);
      drilledDown = true;
      collector.stop();
      if (pages.length <= 1) {
        await i.update({ embeds: [pages[0]!], components: [] });
      } else {
        await i.deferUpdate();
        await sendPaginatedEmbeds(interaction, pages);
      }
      return;
    }

    if (action === "notes") {
      const records = await db
        .select()
        .from(notes)
        .where(eq(notes.userId, dbUser.id))
        .orderBy(desc(notes.createdAt))
        .all();

      if (records.length === 0) {
        await i.update({
          embeds: [infoEmbed(`No notes found for **${targetUser.username}**.`)],
          components: [],
        });
        return;
      }

      const pages = buildNotePages(records, targetUser);
      drilledDown = true;
      collector.stop();
      if (pages.length <= 1) {
        await i.update({ embeds: [pages[0]!], components: [] });
      } else {
        await i.deferUpdate();
        await sendPaginatedEmbeds(interaction, pages);
      }
      return;
    }
  });

  collector.on("end", async () => {
    if (drilledDown) return;
    try {
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        row.components.map((b) => ButtonBuilder.from(b.toJSON()).setDisabled(true)),
      );
      await message.edit({ components: [disabledRow] });
    } catch {}
  });
}

async function handleAudit(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const staffUser = interaction.options.getUser("staff", true);

  const [infractionRows, noteRows] = await Promise.all([
    db
      .select()
      .from(infractions)
      .where(eq(infractions.moderatorId, staffUser.id))
      .orderBy(desc(infractions.createdAt))
      .all(),
    db
      .select()
      .from(notes)
      .where(eq(notes.authorId, staffUser.id))
      .orderBy(desc(notes.createdAt))
      .all(),
  ]);

  const totalActions = infractionRows.length + noteRows.length;

  if (totalActions === 0) {
    await interaction.editReply({
      embeds: [infoEmbed(`No moderation actions found for **${staffUser.username}**.`)],
    });
    return;
  }

  const targetUserIds = Array.from(
    new Set([...infractionRows.map((r) => r.userId), ...noteRows.map((n) => n.userId)]),
  );

  const userRows =
    targetUserIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, targetUserIds)).all()
      : [];
  const discordIdById = new Map(userRows.map((u) => [u.id, u.discordId] as const));
  const resolveDiscordId = (userId: number): string => discordIdById.get(userId) ?? "unknown";

  type AuditEntry = {
    type: string;
    targetDiscordId: string;
    detail: string;
    createdAt: string;
  };

  const entries: AuditEntry[] = [];

  for (const r of infractionRows) {
    entries.push({
      type: r.type,
      targetDiscordId: resolveDiscordId(r.userId),
      detail: r.reason.length > 80 ? `${r.reason.slice(0, 80)}...` : r.reason,
      createdAt: r.createdAt,
    });
  }

  for (const n of noteRows) {
    entries.push({
      type: "note",
      targetDiscordId: resolveDiscordId(n.userId),
      detail: n.content.length > 80 ? `${n.content.slice(0, 80)}...` : n.content,
      createdAt: n.createdAt,
    });
  }

  entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const summary = `**${infractionRows.length}** infractions issued \u2022 **${noteRows.length}** notes written`;

  const pages: EmbedBuilder[] = [];
  for (const group of chunk(entries, INFRACTIONS_PER_PAGE)) {
    const description = group
      .map((e) => {
        const ts = Math.floor(new Date(e.createdAt).getTime() / 1000);
        return `**${e.type.toUpperCase()}** <@${e.targetDiscordId}> - <t:${ts}:R>\n> ${e.detail}`;
      })
      .join("\n\n");

    pages.push(
      new EmbedBuilder()
        .setAuthor({
          name: `Staff Audit - ${staffUser.username}`,
          iconURL: staffUser.displayAvatarURL(),
        })
        .setDescription(`${summary}\n\n${description}`)
        .setColor(Colors.Info)
        .setThumbnail(staffUser.displayAvatarURL())
        .setTimestamp(),
    );
  }

  await sendPaginatedEmbeds(interaction, pages);
}

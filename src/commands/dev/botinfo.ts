import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  version as djsVersion,
} from "discord.js";
import { count } from "drizzle-orm";
import { db } from "~/db";
import { infractions, notes, users } from "~/db/schema";
import { env } from "~/env";
import { Colors } from "~/lib/constants";
import type { Command } from "~/types";

const startedAt = Date.now();

export default {
  data: new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("View bot diagnostics and statistics. (Dev only)"),

  requiredRole: "dev",

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [userRow, infractionRow, noteRow] = await Promise.all([
      db.select({ value: count() }).from(users),
      db.select({ value: count() }).from(infractions),
      db.select({ value: count() }).from(notes),
    ]);

    const uptimeMs = Date.now() - startedAt;
    const memUsage = process.memoryUsage();
    const heapMb = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
    const rssMb = (memUsage.rss / 1024 / 1024).toFixed(1);
    const client = interaction.client;

    const lines = [
      "**Runtime**",
      `Uptime \`${formatUptime(uptimeMs)}\` \u2022 Ping \`${client.ws.ping}ms\` \u2022 Guilds \`${client.guilds.cache.size}\``,
      `Heap \`${heapMb} MB\` \u2022 RSS \`${rssMb} MB\``,
      "",
      "**Versions**",
      `Bun \`${Bun.version}\` \u2022 discord.js \`${djsVersion}\` \u2022 ENV \`${env.NODE_ENV}\``,
      "",
      "**Database**",
      `\`${userRow[0]?.value ?? 0}\` users \u2022 \`${infractionRow[0]?.value ?? 0}\` infractions \u2022 \`${noteRow[0]?.value ?? 0}\` notes`,
    ];

    const embed = new EmbedBuilder()
      .setAuthor({
        name: "antifed",
        iconURL: client.user?.displayAvatarURL(),
      })
      .setDescription(lines.join("\n"))
      .setColor(Colors.Info)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
} satisfies Command;

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000) % 24;
  const d = Math.floor(ms / 86400000);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

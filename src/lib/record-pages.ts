import { EmbedBuilder, type User } from "discord.js";
import { chunk } from "~/lib/chunk";
import { Colors, INFRACTIONS_PER_PAGE } from "~/lib/constants";

type InfractionRecord = {
  id: number;
  type: string;
  reason: string;
  moderatorId: string;
  active: boolean;
  createdAt: string;
};

type NoteRecord = {
  id: number;
  authorId: string;
  content: string;
  createdAt: string;
};

export function buildInfractionPages(
  records: InfractionRecord[],
  targetUser: User,
  options?: { showFooter?: boolean },
): EmbedBuilder[] {
  const pages: EmbedBuilder[] = [];
  for (const group of chunk(records, INFRACTIONS_PER_PAGE)) {
    const description = group.map(renderInfractionLine).join("\n\n");

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `Infractions - ${targetUser.username}`,
        iconURL: targetUser.displayAvatarURL(),
      })
      .setDescription(description)
      .setColor(Colors.Info)
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp();

    if (options?.showFooter) {
      embed.setFooter({ text: `${records.length} infractions` });
    }

    pages.push(embed);
  }
  return pages;
}

export function buildNotePages(
  records: NoteRecord[],
  targetUser: User,
  options?: { showFooter?: boolean },
): EmbedBuilder[] {
  const pages: EmbedBuilder[] = [];
  for (const group of chunk(records, INFRACTIONS_PER_PAGE)) {
    const description = group
      .map((r) => {
        const ts = Math.floor(new Date(r.createdAt).getTime() / 1000);
        return `\`#${r.id}\` <t:${ts}:R> by <@${r.authorId}>\n> ${r.content}`;
      })
      .join("\n\n");

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `Staff Notes - ${targetUser.username}`,
        iconURL: targetUser.displayAvatarURL(),
      })
      .setDescription(description)
      .setColor(Colors.Note)
      .setThumbnail(targetUser.displayAvatarURL())
      .setTimestamp();

    if (options?.showFooter) {
      embed.setFooter({ text: `${records.length} notes` });
    }

    pages.push(embed);
  }
  return pages;
}

function renderInfractionLine(r: InfractionRecord): string {
  const ts = Math.floor(new Date(r.createdAt).getTime() / 1000);
  return [
    `\`#${r.id}\` **${r.type.toUpperCase()}** - <t:${ts}:R>`,
    `> ${r.reason}`,
    `> Mod: <@${r.moderatorId}> | ${r.active ? "Active" : "Removed"}`,
  ].join("\n");
}

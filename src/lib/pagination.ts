import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  type EmbedBuilder,
} from "discord.js";

const TIMEOUT_MS = 120_000;

export async function sendPaginatedEmbeds(
  interaction: ChatInputCommandInteraction,
  pages: EmbedBuilder[],
  options?: { timeout?: number },
): Promise<void> {
  if (pages.length === 0) return;

  if (pages.length === 1) {
    await interaction.editReply({ embeds: [pages[0]!] });
    return;
  }

  let currentPage = 0;
  const timeout = options?.timeout ?? TIMEOUT_MS;
  const nonce = `page_${interaction.id}`;

  const buildRow = (disabled = false) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${nonce}_first`)
        .setEmoji("⏮")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`${nonce}_prev`)
        .setEmoji("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`${nonce}_indicator`)
        .setLabel(`${currentPage + 1}/${pages.length}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`${nonce}_next`)
        .setEmoji("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || currentPage === pages.length - 1),
      new ButtonBuilder()
        .setCustomId(`${nonce}_last`)
        .setEmoji("⏭")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || currentPage === pages.length - 1),
    );

  const message = await interaction.editReply({
    embeds: [pages[currentPage]!],
    components: [buildRow()],
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.customId.startsWith(nonce) && i.user.id === interaction.user.id,
    time: timeout,
  });

  collector.on("collect", async (i) => {
    const action = i.customId.replace(`${nonce}_`, "");

    switch (action) {
      case "first":
        currentPage = 0;
        break;
      case "prev":
        currentPage = Math.max(0, currentPage - 1);
        break;
      case "next":
        currentPage = Math.min(pages.length - 1, currentPage + 1);
        break;
      case "last":
        currentPage = pages.length - 1;
        break;
    }

    await i.update({
      embeds: [pages[currentPage]!],
      components: [buildRow()],
    });
  });

  collector.on("end", async () => {
    try {
      await message.edit({ components: [buildRow(true)] });
    } catch {}
  });
}

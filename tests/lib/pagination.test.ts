import { describe, expect, mock, test } from "bun:test";
import { EmbedBuilder } from "discord.js";
import { sendPaginatedEmbeds } from "../../src/lib/pagination";

function mockInteraction(overrides = {}) {
  return {
    id: "test-interaction-123",
    user: { id: "user-123" },
    editReply: mock(() => ({
      createMessageComponentCollector: mock(() => ({
        on: mock(() => {}),
      })),
    })),
    ...overrides,
  } as any;
}

describe("sendPaginatedEmbeds", () => {
  test("does nothing for empty pages array", async () => {
    const interaction = mockInteraction();
    await sendPaginatedEmbeds(interaction, []);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  test("sends single page without buttons", async () => {
    const interaction = mockInteraction();
    const pages = [new EmbedBuilder().setDescription("Page 1")];

    await sendPaginatedEmbeds(interaction, pages);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const call = interaction.editReply.mock.calls[0]![0];
    expect(call.embeds).toHaveLength(1);
    expect(call.components).toBeUndefined();
  });

  test("sends multi-page with buttons and collector", async () => {
    const collectorOn = mock((_event: string, _handler: (...args: unknown[]) => unknown) => {});
    const interaction = mockInteraction({
      editReply: mock(() => ({
        createMessageComponentCollector: mock(() => ({
          on: collectorOn,
        })),
      })),
    });

    const pages = [
      new EmbedBuilder().setDescription("Page 1"),
      new EmbedBuilder().setDescription("Page 2"),
      new EmbedBuilder().setDescription("Page 3"),
    ];

    await sendPaginatedEmbeds(interaction, pages);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const call = interaction.editReply.mock.calls[0]![0];
    expect(call.embeds).toHaveLength(1);
    expect(call.components).toHaveLength(1);
    expect(call.components[0].components).toHaveLength(5);

    expect(collectorOn).toHaveBeenCalledTimes(2);
    expect(collectorOn.mock.calls[0]![0]).toBe("collect");
    expect(collectorOn.mock.calls[1]![0]).toBe("end");
  });
});

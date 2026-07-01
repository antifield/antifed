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

// Runs sendPaginatedEmbeds while capturing the real collector handlers so tests
// can actually invoke the first/prev/next/last navigation instead of only
// asserting the handlers were registered.
async function sendAndCapture(pageCount: number) {
  const handlers: Record<string, (...args: any[]) => any> = {};
  const message = {
    createMessageComponentCollector: mock(() => ({
      on: mock((event: string, handler: (...args: any[]) => any) => {
        handlers[event] = handler;
      }),
    })),
    edit: mock(async (_payload: any) => undefined),
  };
  const interaction = {
    id: "test-interaction-123",
    user: { id: "user-123" },
    editReply: mock(async () => message),
  } as any;
  const pages = Array.from({ length: pageCount }, (_, i) =>
    new EmbedBuilder().setDescription(`Page ${i + 1}`),
  );

  await sendPaginatedEmbeds(interaction, pages);
  return { interaction, message, handlers };
}

// A fake button interaction the captured `collect` handler operates on.
function clickButton(action: string) {
  const update = mock(async (_payload: any) => undefined);
  return { customId: `page_test-interaction-123_${action}`, update, user: { id: "user-123" } };
}

function updatedPageDescription(update: ReturnType<typeof clickButton>["update"]) {
  return update.mock.calls.at(-1)![0].embeds[0].data.description;
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

  test("next advances to the following page", async () => {
    const { handlers } = await sendAndCapture(3);
    const button = clickButton("next");

    await handlers.collect!(button);

    expect(button.update).toHaveBeenCalledTimes(1);
    expect(updatedPageDescription(button.update)).toBe("Page 2");
  });

  test("prev clamps at the first page", async () => {
    const { handlers } = await sendAndCapture(3);

    // Already on page 0; prev must not underflow.
    const button = clickButton("prev");
    await handlers.collect!(button);

    expect(updatedPageDescription(button.update)).toBe("Page 1");
  });

  test("last jumps to the final page, first returns to the start", async () => {
    const { handlers } = await sendAndCapture(3);

    const last = clickButton("last");
    await handlers.collect!(last);
    expect(updatedPageDescription(last.update)).toBe("Page 3");

    // currentPage is closure state, so a subsequent first click resets it.
    const first = clickButton("first");
    await handlers.collect!(first);
    expect(updatedPageDescription(first.update)).toBe("Page 1");
  });

  test("next clamps at the last page", async () => {
    const { handlers } = await sendAndCapture(2);

    await handlers.collect!(clickButton("next")); // -> page 2 (last)
    const beyond = clickButton("next");
    await handlers.collect!(beyond); // must stay on page 2
    expect(updatedPageDescription(beyond.update)).toBe("Page 2");
  });

  test("end disables every button on the message", async () => {
    const { message, handlers } = await sendAndCapture(3);

    await handlers.end!();

    expect(message.edit).toHaveBeenCalledTimes(1);
    const row = message.edit.mock.calls.at(-1)![0].components[0];
    expect(row.components).toHaveLength(5);
    expect(row.components.every((b: any) => b.data.disabled === true)).toBe(true);
  });
});

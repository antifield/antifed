import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const sendModLog = mock(async (_guild: unknown, _embed: unknown) => undefined);
await mock.module("~/lib/mod-log", () => ({ sendModLog }));

const { replyAndLog } = await import("../../src/lib/mod-reply");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  sendModLog.mockClear();
});

const guild = { id: "g-1" } as any;
const reply = { kind: "reply" } as any;
const log = { kind: "log" } as any;

function fakeInteraction(editReplyImpl: () => Promise<unknown>): any {
  return { editReply: mock(editReplyImpl) };
}

describe("replyAndLog", () => {
  test("replies then logs, using the distinct log embed when provided", async () => {
    const interaction = fakeInteraction(async () => undefined);

    await replyAndLog(interaction, guild, { reply, log });

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply.mock.calls[0]![0]).toEqual({ embeds: [reply] });
    expect(sendModLog).toHaveBeenCalledTimes(1);
    expect(sendModLog.mock.calls[0]![1]).toBe(log);
  });

  test("logs the reply embed when no distinct log embed is given", async () => {
    const interaction = fakeInteraction(async () => undefined);

    await replyAndLog(interaction, guild, { reply });

    expect(sendModLog).toHaveBeenCalledTimes(1);
    expect(sendModLog.mock.calls[0]![1]).toBe(reply);
  });

  test("still logs and re-throws when the reply fails", async () => {
    const boom = new Error("Unknown interaction");
    const interaction = fakeInteraction(async () => {
      throw boom;
    });

    await expect(replyAndLog(interaction, guild, { reply, log })).rejects.toBe(boom);

    expect(sendModLog).toHaveBeenCalledTimes(1);
    expect(sendModLog.mock.calls[0]![1]).toBe(log);
  });
});

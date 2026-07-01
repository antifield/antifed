import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const warn = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn, error: mock(() => undefined) },
}));

// A LOG_CHANNEL_ID is required to get past sendModLog's disabled guard. In the
// full suite mod-log.ts is already cached with the real env, so CI sets a dummy
// LOG_CHANNEL_ID; this mock covers isolated single-file runs. Restored in
// afterAll so it can't leak into suites that read env directly.
await mock.module("~/env", () => ({
  env: {
    DISCORD_TOKEN: "t",
    DISCORD_CLIENT_ID: "c",
    DISCORD_GUILD_ID: "g",
    BOT_DEVELOPER_ROLE_ID: "dev-role",
    DATABASE_URL: "db",
    NODE_ENV: "test",
    LOG_CHANNEL_ID: "log-chan",
  },
}));

const { sendModLog } = await import("../../src/lib/mod-log");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  warn.mockClear();
});

const embed = {} as any;

function fakeGuild(fetchImpl: () => Promise<unknown>) {
  return { channels: { fetch: mock(fetchImpl) } } as any;
}

describe("sendModLog channel selection", () => {
  test("warns channel_not_text when the resolved channel is not a text channel", async () => {
    await sendModLog(fakeGuild(async () => ({ type: 2 })), embed);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({
      status: "channel_not_text",
      resolved_type: 2,
    });
  });

  test("warns fetch_failed when the channel fetch throws", async () => {
    await sendModLog(
      fakeGuild(async () => {
        throw new Error("boom");
      }),
      embed,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ status: "fetch_failed" });
  });
});

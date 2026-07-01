import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const warn = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn, error: mock(() => undefined) },
}));

// Mutable so one test can null out LOG_CHANNEL_ID; restored in afterAll so this
// env mock can't leak into suites that read env directly (see harness notes).
const fakeEnv: Record<string, string | undefined> = {
  DISCORD_TOKEN: "t",
  DISCORD_CLIENT_ID: "c",
  DISCORD_GUILD_ID: "g",
  BOT_DEVELOPER_ROLE_ID: "dev-role",
  DATABASE_URL: "db",
  NODE_ENV: "test",
  LOG_CHANNEL_ID: "log-chan",
};
await mock.module("~/env", () => ({ env: fakeEnv }));

const { sendModLog } = await import("../../src/lib/mod-log");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  warn.mockClear();
  fakeEnv.LOG_CHANNEL_ID = "log-chan";
});

const embed = {} as any;

function fakeGuild(fetchImpl: () => Promise<unknown>) {
  const fetch = mock(fetchImpl);
  return { guild: { channels: { fetch } } as any, fetch };
}

describe("sendModLog channel selection", () => {
  test("no-ops without fetching when LOG_CHANNEL_ID is unset", async () => {
    fakeEnv.LOG_CHANNEL_ID = undefined;
    const { guild, fetch } = fakeGuild(async () => ({}));

    await sendModLog(guild, embed);

    expect(fetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test("warns channel_not_text when the resolved channel is not a text channel", async () => {
    const { guild } = fakeGuild(async () => ({ type: 2 }));

    await sendModLog(guild, embed);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({
      status: "channel_not_text",
      resolved_type: 2,
    });
  });

  test("warns fetch_failed when the channel fetch throws", async () => {
    const { guild } = fakeGuild(async () => {
      throw new Error("boom");
    });

    await sendModLog(guild, embed);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ status: "fetch_failed" });
  });
});

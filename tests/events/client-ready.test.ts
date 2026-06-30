import { afterAll, describe, expect, mock, test } from "bun:test";
import { ActivityType } from "discord.js";

const logWarn = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn: logWarn, error: mock(() => undefined) },
}));

const { setMemberCountPresence } = await import("../../src/events/client-ready");

afterAll(() => {
  mock.restore();
});

// The client's guilds.cache.get ignores the id and returns the given guild, so
// the test doesn't depend on env.DISCORD_GUILD_ID.
function makeClient(guild: { memberCount: number } | undefined) {
  const setActivity = mock((_name: string, _opts?: unknown) => undefined);
  const client = {
    guilds: { cache: { get: () => guild } },
    user: { setActivity },
  };
  return { client, setActivity };
}

describe("client-ready presence", () => {
  test("sets a Watching member-count activity", () => {
    const { client, setActivity } = makeClient({ memberCount: 6700 });
    setMemberCountPresence(client as any);
    expect(setActivity).toHaveBeenCalledWith("6,700 members", { type: ActivityType.Watching });
  });

  test("formats large counts with thousands separators", () => {
    const { client, setActivity } = makeClient({ memberCount: 1234567 });
    setMemberCountPresence(client as any);
    expect(setActivity).toHaveBeenCalledWith("1,234,567 members", { type: ActivityType.Watching });
  });

  test("skips and warns when the guild is not cached", () => {
    const { client, setActivity } = makeClient(undefined);
    setMemberCountPresence(client as any);
    expect(setActivity).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "presence", status: "guild_uncached" }),
    );
  });
});

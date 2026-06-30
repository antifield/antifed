import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { ActivityType } from "discord.js";

const logWarn = mock((_entry: unknown) => undefined);
const logError = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn: logWarn, error: logError },
}));

// Capture interval callbacks instead of scheduling a real timer.
const intervalCallbacks: Array<() => void> = [];
const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = ((cb: () => void) => {
  intervalCallbacks.push(cb);
  return 0;
}) as unknown as typeof setInterval;

const { default: clientReady, setMemberCountPresence } =
  await import("../../src/events/client-ready");

afterAll(() => {
  globalThis.setInterval = originalSetInterval;
  mock.restore();
});

beforeEach(() => {
  logError.mockClear();
  intervalCallbacks.length = 0;
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
    expect(setActivity).toHaveBeenCalledWith("👀 6,700 members", { type: ActivityType.Watching });
  });

  test("formats large counts with thousands separators", () => {
    const { client, setActivity } = makeClient({ memberCount: 1234567 });
    setMemberCountPresence(client as any);
    expect(setActivity).toHaveBeenCalledWith("👀 1,234,567 members", {
      type: ActivityType.Watching,
    });
  });

  test("skips and warns when the guild is not cached", () => {
    const { client, setActivity } = makeClient(undefined);
    setMemberCountPresence(client as any);
    expect(setActivity).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "presence", status: "guild_uncached" }),
    );
  });

  test("execute sets the presence immediately and schedules a refresh", () => {
    const { client, setActivity } = makeClient({ memberCount: 42 });
    clientReady.execute(client as any);
    expect(setActivity).toHaveBeenCalledTimes(1);
    expect(intervalCallbacks).toHaveLength(1);
    intervalCallbacks[0]!(); // the scheduled refresh re-sets the presence
    expect(setActivity).toHaveBeenCalledTimes(2);
  });

  test("execute swallows a presence failure instead of crashing the bot", () => {
    const client = {
      guilds: {
        cache: {
          get: () => {
            throw new Error("cache exploded");
          },
        },
      },
      user: { setActivity: mock(() => undefined) },
    };
    expect(() => clientReady.execute(client as any)).not.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ action: "presence", status: "refresh_failed" }),
    );
  });
});

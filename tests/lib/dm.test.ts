import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const logWarn = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn: logWarn, error: mock(() => undefined) },
}));

const { trySendDm } = await import("../../src/lib/dm");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  logWarn.mockClear();
});

function fakeUser(sendImpl: () => Promise<void>): any {
  return { id: "u-1", send: mock(sendImpl) };
}

const embed = {} as any;

describe("trySendDm", () => {
  test("returns true and sends when the DM succeeds", async () => {
    const user = fakeUser(async () => undefined);
    const ok = await trySendDm(user, embed);
    expect(ok).toBe(true);
    expect(user.send).toHaveBeenCalledTimes(1);
    expect(logWarn).not.toHaveBeenCalled();
  });

  test("returns false and logs when the DM throws (closed DMs)", async () => {
    const user = fakeUser(async () => {
      throw new Error("Cannot send messages to this user");
    });
    const ok = await trySendDm(user, embed);
    expect(ok).toBe(false);
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dm", status: "failed", targetId: "u-1" }),
    );
  });
});

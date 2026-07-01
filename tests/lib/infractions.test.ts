import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createTestDb } from "../helpers/db";

const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));

const logError = mock((_entry: unknown) => undefined);
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn: mock(() => undefined), error: logError },
}));

const { infractions, users } = await import("../../src/db/schema");
const { recordInfraction } = await import("../../src/lib/infractions");

afterAll(() => {
  mock.restore();
  testEnv.client.close();
});

beforeEach(async () => {
  await testEnv.client.batch(["DELETE FROM infractions", "DELETE FROM users"], "write");
  logError.mockClear();
});

function fakeUser(id: string, username: string | undefined) {
  return { id, username, displayAvatarURL: () => "x" } as any;
}

describe("recordInfraction", () => {
  test("ensures the user, inserts the infraction, and returns true", async () => {
    const ok = await recordInfraction({
      targetUser: fakeUser("u-1", "spammer"),
      moderatorId: "mod-1",
      type: "ban",
      reason: "spam",
    });

    expect(ok).toBe(true);
    const rows = await testEnv.db.select().from(infractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      moderatorId: "mod-1",
      type: "ban",
      reason: "spam",
      active: true,
    });
    expect(await testEnv.db.select().from(users).all()).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
  });

  test("returns false and logs when the write fails, leaving no row", async () => {
    // A missing username violates the NOT NULL users.username column, so the
    // ensureUser insert inside recordInfraction throws and is caught.
    const ok = await recordInfraction({
      targetUser: fakeUser("u-2", undefined),
      moderatorId: "mod-1",
      type: "warn",
      reason: "x",
    });

    expect(ok).toBe(false);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toMatchObject({ action: "infraction-insert", type: "warn" });
    expect(await testEnv.db.select().from(infractions).all()).toHaveLength(0);
  });
});

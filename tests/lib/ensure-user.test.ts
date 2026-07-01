import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";

const testEnv = await createTestDb();
await mock.module("~/db", () => ({ db: testEnv.db }));

const { users } = await import("../../src/db/schema");
const { ensureUser } = await import("../../src/lib/ensure-user");

afterAll(() => {
  testEnv.client.close();
});

beforeEach(async () => {
  await testEnv.client.batch(["DELETE FROM users"], "write");
});

function fakeUser(id: string, username: string) {
  return { id, username, displayAvatarURL: () => "x" } as any;
}

describe("ensureUser", () => {
  test("inserts a row for a new user", async () => {
    const row = await ensureUser(fakeUser("d-1", "alice"));
    expect(row).toMatchObject({ discordId: "d-1", username: "alice" });
    expect(await testEnv.db.select().from(users).all()).toHaveLength(1);
  });

  test("returns the existing row without duplicating it", async () => {
    const first = await ensureUser(fakeUser("d-1", "alice"));
    const second = await ensureUser(fakeUser("d-1", "alice"));
    expect(second.id).toBe(first.id);
    expect(await testEnv.db.select().from(users).all()).toHaveLength(1);
  });

  test("updates the stored username when it changed", async () => {
    const first = await ensureUser(fakeUser("d-1", "alice"));
    const updated = await ensureUser(fakeUser("d-1", "alice-renamed"));

    expect(updated.id).toBe(first.id);
    expect(updated.username).toBe("alice-renamed");

    const stored = await testEnv.db.select().from(users).where(eq(users.id, first.id)).get();
    expect(stored!.username).toBe("alice-renamed");
    expect(await testEnv.db.select().from(users).all()).toHaveLength(1);
  });
});

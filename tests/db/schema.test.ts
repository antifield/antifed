import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { infractions, notes, users } from "../../src/db/schema";

describe("database schema", () => {
  test("users table exists with correct name", () => {
    expect(getTableName(users)).toBe("users");
  });

  test("infractions table exists with correct name", () => {
    expect(getTableName(infractions)).toBe("infractions");
  });

  test("notes table exists with correct name", () => {
    expect(getTableName(notes)).toBe("notes");
  });

  test("users table has expected columns", () => {
    const columns = Object.keys(users);
    expect(columns).toContain("id");
    expect(columns).toContain("discordId");
    expect(columns).toContain("username");
    expect(columns).toContain("createdAt");
    expect(columns).toContain("updatedAt");
  });

  test("infractions table has expected columns", () => {
    const columns = Object.keys(infractions);
    expect(columns).toContain("id");
    expect(columns).toContain("userId");
    expect(columns).toContain("moderatorId");
    expect(columns).toContain("type");
    expect(columns).toContain("reason");
    expect(columns).toContain("active");
    expect(columns).toContain("createdAt");
  });

  test("infractions table has no duration columns (bans are permanent)", () => {
    const columns = Object.keys(infractions);
    expect(columns).not.toContain("duration");
    expect(columns).not.toContain("expiresAt");
  });

  test("notes table has expected columns", () => {
    const columns = Object.keys(notes);
    expect(columns).toContain("id");
    expect(columns).toContain("userId");
    expect(columns).toContain("authorId");
    expect(columns).toContain("content");
    expect(columns).toContain("createdAt");
  });
});

import { describe, expect, test } from "bun:test";
import { canModerate, formatHierarchyError } from "../../src/lib/hierarchy";
import type { GuildMember, Role } from "discord.js";

function mockMember(
  id: string,
  highestRolePosition: number,
  ownerId = "owner-id",
  botId = "bot-id",
): GuildMember {
  return {
    id,
    roles: { highest: { position: highestRolePosition } as Role },
    guild: { ownerId, members: { me: { id: botId } } },
    user: { username: `user-${id}` },
  } as unknown as GuildMember;
}

describe("canModerate", () => {
  test("allows moderating lower-ranked members", () => {
    const mod = mockMember("mod", 10);
    const target = mockMember("target", 5);
    expect(canModerate(mod, target)).toBe(true);
  });

  test("denies moderating same-ranked members", () => {
    const mod = mockMember("mod", 5);
    const target = mockMember("target", 5);
    expect(canModerate(mod, target)).toBe(false);
  });

  test("denies moderating higher-ranked members", () => {
    const mod = mockMember("mod", 5);
    const target = mockMember("target", 10);
    expect(canModerate(mod, target)).toBe(false);
  });

  test("denies moderating self", () => {
    const mod = mockMember("same-id", 10);
    const target = mockMember("same-id", 5);
    expect(canModerate(mod, target)).toBe(false);
  });

  test("denies moderating the guild owner", () => {
    const mod = mockMember("mod", 100, "owner-id");
    const target = mockMember("owner-id", 1, "owner-id");
    expect(canModerate(mod, target)).toBe(false);
  });

  test("denies moderating the bot itself", () => {
    const mod = mockMember("mod", 100, "owner-id", "bot-id");
    const target = mockMember("bot-id", 1, "owner-id", "bot-id");
    expect(canModerate(mod, target)).toBe(false);
  });
});

describe("formatHierarchyError", () => {
  test("includes the target username", () => {
    const member = mockMember("target", 5);
    const result = formatHierarchyError(member);
    expect(result).toContain("user-target");
    expect(result).toContain("equal to or higher");
  });
});

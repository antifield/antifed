import { describe, expect, test } from "bun:test";
import { Collection } from "discord.js";
import { env } from "../../src/env";
import {
  hasDevRole,
  hasModRole,
  hasPageRole,
  hasStaffRole,
  memberHasStaffRole,
  roleCheckers,
} from "../../src/lib/role-gates";

const DEV_ROLE = env.BOT_DEVELOPER_ROLE_ID;
const MOD_ROLE = env.MODERATOR_ROLE_ID;
const PAGE_ROLE = env.PAGE_ROLE_ID;

function interactionWith(roleIds: string[]): any {
  return {
    member: {
      roles: {
        cache: new Collection(roleIds.map((id) => [id, { id }])),
      },
    },
  };
}

describe("role gates", () => {
  test("hasDevRole true when dev role present", () => {
    expect(hasDevRole(interactionWith([DEV_ROLE]))).toBe(true);
  });

  test("hasDevRole false when dev role absent", () => {
    expect(hasDevRole(interactionWith(["unrelated-role"]))).toBe(false);
  });

  test("hasStaffRole true for dev role", () => {
    expect(hasStaffRole(interactionWith([DEV_ROLE]))).toBe(true);
  });

  test("hasStaffRole true for moderator role (when configured)", () => {
    if (!MOD_ROLE) return;
    expect(hasStaffRole(interactionWith([MOD_ROLE]))).toBe(true);
    expect(hasModRole(interactionWith([MOD_ROLE]))).toBe(true);
  });

  test("hasStaffRole false when only page role present", () => {
    // Skip if PAGE_ROLE collides with dev/mod (local .env dual-purposes IDs).
    if (!PAGE_ROLE || PAGE_ROLE === DEV_ROLE || PAGE_ROLE === MOD_ROLE) return;
    expect(hasStaffRole(interactionWith([PAGE_ROLE]))).toBe(false);
  });

  test("hasPageRole true for the page role (when configured)", () => {
    if (!PAGE_ROLE) return;
    expect(hasPageRole(interactionWith([PAGE_ROLE]))).toBe(true);
  });

  test("hasPageRole false when only a non-page role is present", () => {
    if (!PAGE_ROLE || PAGE_ROLE === DEV_ROLE) return;
    expect(hasPageRole(interactionWith([DEV_ROLE]))).toBe(false);
  });

  test("hasDevRole false when member is null (DM interactions)", () => {
    expect(hasDevRole({ member: null } as any)).toBe(false);
  });

  test("hasDevRole false when member.roles is a string array (uncached)", () => {
    const interaction = { member: { roles: [DEV_ROLE] } } as any;
    expect(hasDevRole(interaction)).toBe(false);
  });

  test("roleCheckers map routes to the right checker", () => {
    expect(roleCheckers.dev(interactionWith([DEV_ROLE]))).toBe(true);
    expect(roleCheckers.staff(interactionWith([DEV_ROLE]))).toBe(true);
  });
});

function memberWith(roleIds: string[]): any {
  return {
    roles: {
      cache: new Collection(roleIds.map((id) => [id, { id }])),
    },
  };
}

describe("memberHasStaffRole", () => {
  test("true for the dev role", () => {
    expect(memberHasStaffRole(memberWith([DEV_ROLE]))).toBe(true);
  });

  test("true for the moderator role (when configured)", () => {
    if (!MOD_ROLE) return;
    expect(memberHasStaffRole(memberWith([MOD_ROLE]))).toBe(true);
  });

  test("false when only an unrelated role is present", () => {
    expect(memberHasStaffRole(memberWith(["unrelated-role"]))).toBe(false);
  });

  test("false for a null member (uncached)", () => {
    expect(memberHasStaffRole(null)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";

type RawOpt = { name: string; required?: boolean; options?: RawOpt[] };

const { default: modCommand } = await import("../../src/commands/moderation/mod");

describe("/mod command", () => {
  test("has correct name", () => {
    const json = modCommand.data.toJSON();
    expect(json.name).toBe("mod");
  });

  test("has warn, kick, softban and ban subcommands", () => {
    const json = modCommand.data.toJSON();
    const subNames = (json.options as RawOpt[] | undefined)?.map((o) => o.name);
    expect(subNames).toEqual(["warn", "kick", "softban", "ban"]);
  });

  test("warn subcommand requires user and reason", () => {
    const warn = findSub(modCommand.data.toJSON(), "warn");
    const required = (warn.options ?? []).filter((o) => o.required);
    expect(required.map((o) => o.name)).toEqual(["user", "reason"]);
  });

  test("kick subcommand requires user and reason", () => {
    const kick = findSub(modCommand.data.toJSON(), "kick");
    const required = (kick.options ?? []).filter((o) => o.required);
    expect(required.map((o) => o.name)).toEqual(["user", "reason"]);
  });

  test("softban subcommand requires user and reason", () => {
    const softban = findSub(modCommand.data.toJSON(), "softban");
    const required = (softban.options ?? []).filter((o) => o.required);
    expect(required.map((o) => o.name)).toEqual(["user", "reason"]);
  });

  test("ban subcommand requires user and reason", () => {
    const ban = findSub(modCommand.data.toJSON(), "ban");
    const required = (ban.options ?? []).filter((o) => o.required);
    expect(required.map((o) => o.name)).toEqual(["user", "reason"]);
  });

  test("ban subcommand has delete_messages option (but no duration — bans are permanent)", () => {
    const ban = findSub(modCommand.data.toJSON(), "ban");
    const names = (ban.options ?? []).map((o) => o.name);
    expect(names).toContain("delete_messages");
    expect(names).not.toContain("duration");
  });

  test("every subcommand exposes an optional silent flag", () => {
    for (const name of ["warn", "kick", "softban", "ban"]) {
      const sub = findSub(modCommand.data.toJSON(), name);
      const silent = (sub.options ?? []).find((o) => o.name === "silent");
      expect(silent).toBeDefined();
      expect(silent?.required).toBeFalsy();
    }
  });
});

function findSub(json: ReturnType<typeof modCommand.data.toJSON>, name: string): RawOpt {
  const sub = (json.options as RawOpt[] | undefined)?.find((o) => o.name === name);
  if (!sub) throw new Error(`subcommand ${name} not found`);
  return sub;
}

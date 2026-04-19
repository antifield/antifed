import { describe, expect, test } from "bun:test";

type RawOpt = { name: string; required?: boolean; options?: RawOpt[] };

const { default: cmd } = await import("../../src/commands/moderation/infraction");

describe("/infraction command", () => {
  test("has correct name", () => {
    const json = cmd.data.toJSON();
    expect(json.name).toBe("infraction");
  });

  test("has check, remove, and clear subcommands", () => {
    const json = cmd.data.toJSON();
    const subNames = (json.options as RawOpt[] | undefined)?.map((o) => o.name);
    expect(subNames).toEqual(["check", "remove", "clear"]);
  });

  test("check subcommand requires user", () => {
    const sub = findSub("check");
    const required = (sub.options ?? []).filter((o) => o.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.name).toBe("user");
  });

  test("remove subcommand requires id", () => {
    const sub = findSub("remove");
    const required = (sub.options ?? []).filter((o) => o.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.name).toBe("id");
  });

  test("clear subcommand requires user", () => {
    const sub = findSub("clear");
    const required = (sub.options ?? []).filter((o) => o.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.name).toBe("user");
  });
});

function findSub(name: string): RawOpt {
  const sub = (cmd.data.toJSON().options as RawOpt[] | undefined)?.find((o) => o.name === name);
  if (!sub) throw new Error(`subcommand ${name} not found`);
  return sub;
}

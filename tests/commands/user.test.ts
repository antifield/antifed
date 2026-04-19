import { describe, expect, test } from "bun:test";

type RawOpt = { name: string; required?: boolean; options?: RawOpt[] };

const { default: cmd } = await import("../../src/commands/moderation/user");

describe("/user command", () => {
  test("has correct name", () => {
    const json = cmd.data.toJSON();
    expect(json.name).toBe("user");
  });

  test("has info and audit subcommands", () => {
    const json = cmd.data.toJSON();
    const subNames = (json.options as RawOpt[] | undefined)?.map((o) => o.name);
    expect(subNames).toEqual(["info", "audit"]);
  });

  test("info subcommand requires user", () => {
    const sub = findSub("info");
    const required = (sub.options ?? []).filter((o) => o.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.name).toBe("user");
  });

  test("audit subcommand requires staff", () => {
    const sub = findSub("audit");
    const required = (sub.options ?? []).filter((o) => o.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.name).toBe("staff");
  });
});

function findSub(name: string): RawOpt {
  const sub = (cmd.data.toJSON().options as RawOpt[] | undefined)?.find((o) => o.name === name);
  if (!sub) throw new Error(`subcommand ${name} not found`);
  return sub;
}

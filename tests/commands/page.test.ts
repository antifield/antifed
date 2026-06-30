import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type RawOpt = { name: string; required?: boolean; type?: number };

// Configure Better Stack so execute() gets past the "not configured" guard, and
// stub the side-effect modules so we can drive the command in isolation.
const pageEnv = {
  BETTERSTACK_API_TOKEN: "token",
  BETTERSTACK_REQUESTER_EMAIL: "oncall@example.com",
};
await mock.module("~/env", () => ({ env: pageEnv }));
await mock.module("~/lib/mod-log", () => ({ sendModLog: mock(async () => undefined) }));
await mock.module("~/lib/logger", () => ({
  log: { info: mock(() => undefined), warn: mock(() => undefined), error: mock(() => undefined) },
}));
await mock.module("~/lib/log-context", () => ({ useInteractionLog: () => undefined }));

const { default: pageCommand } = await import("../../src/commands/utility/page");

// Controllable fetch: each test sets fetchImpl; default is a successful page.
let fetchImpl: () => Promise<Response> = async () => new Response(null, { status: 201 });
let fetchCalls = 0;
const originalFetch = global.fetch;
// @ts-expect-error — minimal stand-in for the global fetch used by /page
global.fetch = async () => {
  fetchCalls++;
  return fetchImpl();
};

afterAll(() => {
  global.fetch = originalFetch;
  mock.restore();
});

beforeEach(() => {
  fetchCalls = 0;
  fetchImpl = async () => new Response(null, { status: 201 });
});

type ReplyPayload = { embeds?: { data?: { description?: string } }[] };

function makeInteraction(userId: string, reason = "prod is down") {
  const replies: ReplyPayload[] = [];
  const interaction = {
    user: { id: userId, username: "pager", displayAvatarURL: () => "https://example.com/p.png" },
    guild: null,
    guildId: null,
    channelId: null,
    deferReply: mock(async () => undefined),
    editReply: mock(async (payload: ReplyPayload) => {
      replies.push(payload);
      return undefined;
    }),
    options: {
      getString: (_name: string, _required?: boolean) => reason,
      getBoolean: (_name: string) => null,
    },
  };
  return { interaction, replies };
}

const lastDescription = (replies: ReplyPayload[]): string =>
  replies.at(-1)?.embeds?.[0]?.data?.description ?? "";

describe("/page command metadata", () => {
  test("has correct command metadata", () => {
    const json = pageCommand.data.toJSON();
    expect(json.name).toBe("page");
    expect(json.description).toContain("Better Stack");
  });

  test("requires reason option", () => {
    const json = pageCommand.data.toJSON();
    const opts = (json.options as RawOpt[] | undefined) ?? [];
    const required = opts.filter((o) => o.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.name).toBe("reason");
  });

  test("has optional critical boolean", () => {
    const json = pageCommand.data.toJSON();
    const opts = (json.options as RawOpt[] | undefined) ?? [];
    const critical = opts.find((o) => o.name === "critical");
    expect(critical).toBeDefined();
    expect(critical?.required).toBeFalsy();
  });

  test("caps the reason length so the success embed can't overflow", () => {
    const json = pageCommand.data.toJSON();
    const opts = (json.options as (RawOpt & { max_length?: number })[] | undefined) ?? [];
    const reason = opts.find((o) => o.name === "reason");
    expect(reason?.max_length).toBe(1000);
  });
});

describe("/page cooldown", () => {
  test("claims the cooldown before the fetch so concurrent pages don't double-fire", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchImpl = async () => {
      await gate; // hold the first page open while the second one runs
      return new Response(null, { status: 201 });
    };

    const first = makeInteraction("race-1");
    const second = makeInteraction("race-1");
    const p1 = pageCommand.execute(first.interaction as any);
    const p2 = pageCommand.execute(second.interaction as any);

    // Let both calls progress past deferReply; the second should hit the cooldown.
    await new Promise((resolve) => setTimeout(resolve, 0));

    release();
    await Promise.all([p1, p2]);

    expect(fetchCalls).toBe(1);
    expect(lastDescription(second.replies)).toContain("cooldown");
  });

  test("a successful page puts the user on cooldown", async () => {
    const first = makeInteraction("cd-1");
    await pageCommand.execute(first.interaction as any);
    expect(lastDescription(first.replies)).toContain("paged");

    const second = makeInteraction("cd-1");
    await pageCommand.execute(second.interaction as any);
    expect(lastDescription(second.replies)).toContain("cooldown");
  });

  test("clears the cooldown when the page fails so a retry is allowed", async () => {
    fetchImpl = async () => new Response("upstream error", { status: 500 });
    const first = makeInteraction("fail-1");
    await pageCommand.execute(first.interaction as any);
    expect(lastDescription(first.replies)).toContain("Failed to page");

    // The failed page must not have consumed the cooldown — a retry can proceed.
    fetchImpl = async () => new Response(null, { status: 201 });
    const second = makeInteraction("fail-1");
    await pageCommand.execute(second.interaction as any);
    expect(lastDescription(second.replies)).toContain("paged");
  });

  test("keeps the cooldown when the reply fails after the page already went out", async () => {
    fetchImpl = async () => new Response(null, { status: 201 }); // page succeeds
    const first = makeInteraction("post-1");
    let editCalls = 0;
    first.interaction.editReply = mock(async (payload: ReplyPayload) => {
      editCalls++;
      if (editCalls === 1) throw new Error("Invalid Form Body: embed too long");
      first.replies.push(payload);
      return undefined;
    });

    await pageCommand.execute(first.interaction as any);

    // The page went out, so a retry must still be blocked despite the reply failure.
    const second = makeInteraction("post-1");
    await pageCommand.execute(second.interaction as any);
    expect(lastDescription(second.replies)).toContain("cooldown");
  });
});

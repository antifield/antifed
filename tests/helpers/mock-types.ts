// Shared types + accessors for mock payloads in tests.
//
// Bun's `mock()` without a typed signature infers `calls` as `[][]`, which
// then fights `noUncheckedIndexedAccess` (TS2493: "Tuple type [] of length 0
// has no element at index 0"). Typing the mock's parameters fixes the tuple
// chain. `lastReplyDescription` wraps the common "what description was the
// user shown?" extraction in one place instead of chains of `!` + optional
// chaining at every call site.

import type { EmbedBuilder } from "discord.js";

export type ReplyEmbed = EmbedBuilder | { data?: { description?: string } };

export type ReplyPayload = {
  embeds?: ReplyEmbed[];
  components?: unknown[];
};

type ReplyMock = { mock: { calls: ReplyPayload[][] } };

export function lastReply(m: ReplyMock): ReplyPayload {
  const call = m.mock.calls.at(-1);
  if (!call || call.length === 0) throw new Error("expected editReply to have been called");
  const payload = call[0];
  if (!payload) throw new Error("editReply called with no payload");
  return payload;
}

export function lastReplyDescription(m: ReplyMock): string {
  const payload = lastReply(m);
  const embed = payload.embeds?.[0];
  if (!embed) throw new Error("reply had no embeds");
  const description = "data" in embed ? embed.data?.description : undefined;
  return description ?? "";
}

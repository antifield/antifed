import type { User } from "discord.js";
import { db } from "~/db";
import { infractions } from "~/db/schema";
import { ensureUser } from "~/lib/ensure-user";
import { formatError } from "~/lib/errors";
import { log } from "~/lib/logger";

export type InfractionType = "ban" | "warn" | "kick" | "softban";

// Resolves (or creates) the target's user row and writes an infraction record.
// Returns false and logs on failure so callers can surface an "action done,
// audit failed" note instead of letting the whole command throw.
export async function recordInfraction(params: {
  targetUser: User;
  moderatorId: string;
  type: InfractionType;
  reason: string;
}): Promise<boolean> {
  try {
    const dbUser = await ensureUser(params.targetUser);
    await db.insert(infractions).values({
      userId: dbUser.id,
      moderatorId: params.moderatorId,
      type: params.type,
      reason: params.reason,
    });
    return true;
  } catch (err) {
    log.error({
      action: "infraction-insert",
      type: params.type,
      targetId: params.targetUser.id,
      moderatorId: params.moderatorId,
      error: formatError(err),
    });
    return false;
  }
}

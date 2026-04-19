import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: z.string().min(1),
    DISCORD_GUILD_ID: z.string().min(1),

    BOT_DEVELOPER_ROLE_ID: z.string().min(1),
    MODERATOR_ROLE_ID: z.string().optional(),
    PAGE_ROLE_ID: z.string().optional(),

    LOG_CHANNEL_ID: z.string().optional(),

    DATABASE_URL: z.string().min(1),
    DATABASE_AUTH_TOKEN: z.string().optional(),

    BETTERSTACK_API_TOKEN: z.string().optional(),
    BETTERSTACK_REQUESTER_EMAIL: z.string().email().optional(),

    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

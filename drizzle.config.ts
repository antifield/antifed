import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema",
  out: "./src/db/migrations",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL || "http://localhost:9120",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});

import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  tablesFilter: ["*", "!legacy_*"],
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});

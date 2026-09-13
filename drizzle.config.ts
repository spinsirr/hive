import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL_DIRECT;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL_DIRECT is required to run database migrations."
  );
}

const verifiedDatabaseUrl = new URL(databaseUrl);
if (verifiedDatabaseUrl.searchParams.get("sslmode") === "require") {
  verifiedDatabaseUrl.searchParams.set("sslmode", "verify-full");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: verifiedDatabaseUrl.toString(),
  },
  strict: true,
  verbose: true,
});

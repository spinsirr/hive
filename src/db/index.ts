import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";

type GlobalWithDatabasePool = typeof globalThis & {
  __hiveDatabasePool?: Pool;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run Hive.");
}

const verifiedConnectionString = new URL(connectionString);
if (verifiedConnectionString.searchParams.get("sslmode") === "require") {
  verifiedConnectionString.searchParams.set("sslmode", "verify-full");
}

const globalWithDatabasePool = globalThis as GlobalWithDatabasePool;
const pool =
  globalWithDatabasePool.__hiveDatabasePool ??
  new Pool({
    connectionString: verifiedConnectionString.toString(),
    max: 5,
  });

if (!globalWithDatabasePool.__hiveDatabasePool) {
  globalWithDatabasePool.__hiveDatabasePool = pool;

  if (process.env.VERCEL) {
    attachDatabasePool(pool);
  }
}

export const db = drizzle(pool, { schema });

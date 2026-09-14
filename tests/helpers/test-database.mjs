import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createFixturePool } from "./fixture-pool.mjs";

/** Every fixture owns one uniquely named loopback database and its complete teardown. */
export function createTestDatabase(configured, prefix) {
  const url = new URL(configured || "invalid:");
  assert.ok(
    ["postgres:", "postgresql:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.search,
    "Set this test's database URL to disposable loopback Postgres, never production."
  );
  assert.match(prefix, /^hive_[a-z_]+_test$/);
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  url.pathname = `/${name}`;
  const previous = {
    url: process.env.DATABASE_URL,
    direct: process.env.DATABASE_URL_DIRECT,
    pool: globalThis.__hiveDatabasePool,
  };
  process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT = url.toString();
  const { pool, closePool } = createFixturePool({
    connectionString: url.toString(),
    max: 5,
  });
  globalThis.__hiveDatabasePool = pool;
  let created = false;
  return {
    pool,
    url,
    async start() {
      await admin.connect();
      await admin.query(`CREATE DATABASE "${name}"`);
      created = true;
      await migrate(drizzle(pool), {
        migrationsFolder: fileURLToPath(
          new URL("../../drizzle", import.meta.url)
        ),
      });
    },
    async close() {
      try {
        // Wait for client sockets as well as pool.end(); never FORCE-drop other clients.
        await closePool();
        if (created) {
          await admin.query(`DROP DATABASE "${name}"`);
          assert.equal(
            (
              await admin.query(
                "SELECT 1 FROM pg_database WHERE datname = $1",
                [name]
              )
            ).rowCount,
            0
          );
        }
      } finally {
        await admin.end();
        if (previous.url === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previous.url;
        if (previous.direct === undefined)
          delete process.env.DATABASE_URL_DIRECT;
        else process.env.DATABASE_URL_DIRECT = previous.direct;
        globalThis.__hiveDatabasePool = previous.pool;
      }
    },
  };
}

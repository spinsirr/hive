import assert from "node:assert/strict";
import { createFixturePool } from "./fixture-pool.mjs";

const url = new URL(process.env.HIVE_AUTH_TEST_DATABASE_URL || "invalid:");
assert.ok(
  ["postgres:", "postgresql:"].includes(url.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    !url.search,
  "Set HIVE_AUTH_TEST_DATABASE_URL to disposable loopback Postgres, never Neon."
);
const { pool, closePool } = createFixturePool({
  connectionString: url.toString(),
  max: 2,
});
const openClients = new Set();
pool.on("connect", (client) => {
  openClients.add(client);
  client.once("end", () => openClients.delete(client));
});
const clients = [];
try {
  clients.push(await pool.connect());
  clients.push(await pool.connect());
  assert.equal(openClients.size, 2);
  await Promise.all(clients.map((client) => client.query("select 1")));
} finally {
  clients.forEach((client) => client.release());
  await closePool();
}
assert.equal(
  openClients.size,
  0,
  "All client connections must end before the fixture database is dropped"
);
console.log(
  "PASS: fixture cleanup waits for every real Postgres client to end, not just pool bookkeeping."
);

import { once } from "node:events";
import { Pool } from "pg";

export function createFixturePool(options) {
  const pool = new Pool(options);
  const clients = new Set();
  pool.on("connect", (client) => {
    clients.add(client);
    client.once("end", () => clients.delete(client));
  });
  return {
    pool,
    async closePool() {
      // pg-pool 3.14 can resolve end() before client end events. The September 10
      // Linux CI teardown then killed closing sockets with DROP DATABASE FORCE.
      const ended = [...clients].map((client) =>
        once(client, "end", { signal: AbortSignal.timeout(5000) })
      );
      await Promise.all([pool.end(), ...ended]);
    },
  };
}

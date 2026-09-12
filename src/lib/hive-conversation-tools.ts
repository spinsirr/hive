import { dynamicTool, jsonSchema } from "ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type HiveToolConnection = { url: string; token: string };

/** Gateway planning uses the very same MCP definitions and saved receipts as
 * native Codex/Claude. No separate question schema, store or answer lifecycle. */
export async function connectHiveConversationTools(connection: HiveToolConnection) {
  const client = new Client({ name: "hive-planning", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.url), {
      requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
    }));
    const { tools } = await client.listTools();
    return {
      tools: Object.fromEntries(tools.filter(({ name }) => ["get_context", "request_input", "reply_to_thread"].includes(name)).map(({ name, description, inputSchema }) => [name, dynamicTool({
        description, inputSchema: jsonSchema(inputSchema),
        execute: async (input, { abortSignal }) => {
          const result = await client.callTool({ name, arguments: input as Record<string, unknown> }, undefined, { signal: abortSignal, timeout: 15_000 });
          if (result.isError) throw new Error("The collaboration tool could not complete. Do not claim the question or reply was sent.");
          return result.content;
        },
      })])),
      close: () => client.close(),
    };
  } catch (error) { await client.close(); throw error; }
}

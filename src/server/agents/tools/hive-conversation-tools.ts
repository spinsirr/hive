import { createMCPClient } from "@ai-sdk/mcp";

export type HiveToolConnection = { url: string; token: string };

/** Gateway planning uses the very same MCP definitions and saved receipts as
 * native Codex/Claude. No separate question schema, store or answer lifecycle. */
export async function connectHiveConversationTools(
  connection: HiveToolConnection
) {
  const client = await createMCPClient({
    clientName: "hive-planning",
    version: "1",
    // Hive's MCP server uses the legacy initialize handshake.
    protocolVersionDiscovery: false,
    initializationOptions: { timeout: 15_000 },
    maxRetries: 0,
    transport: {
      type: "http",
      url: connection.url,
      headers: { Authorization: `Bearer ${connection.token}` },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(15_000),
          ]),
        }),
    },
  });
  try {
    const tools = await client.tools();
    return {
      tools: Object.fromEntries(
        Object.entries(tools).filter(([name]) =>
          [
            "get_context",
            "get_presence",
            "read_thread",
            "request_input",
            "reply_to_thread",
          ].includes(name)
        )
      ),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

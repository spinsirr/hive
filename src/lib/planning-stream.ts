import { z } from "zod";
import { consumeAgentText } from "./agent-stream.ts";

const questionReceipt = z.object({
  messageId: z.string().min(1),
  created: z.boolean(),
  status: z.literal("awaiting_answer"),
});
const mcpResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});
const failedToolOutput = z.object({ isError: z.literal(true) });

function isPendingQuestion(output: unknown) {
  if (failedToolOutput.safeParse(output).success) return false;
  if (questionReceipt.safeParse(output).success) return true;
  // Codex preserves MCP content; Claude may already have decoded its JSON.
  const result = mcpResult.safeParse(output);
  if (!result.success || result.data.isError) return false;
  return result.data.content.some(part => {
    if (part.type !== "text" || !part.text) return false;
    try { return questionReceipt.safeParse(JSON.parse(part.text)).success; }
    catch { return false; }
  });
}

/** A planning question is the public turn's endpoint, but the native turn must
 * drain normally so its history and warm environment can still be retained. */
export function consumePlanningText<TPart extends {
  type: string; text?: string; error?: unknown;
  toolName?: string; output?: unknown;
}>(stream: AsyncIterable<TPart>, onText: (body: string) => void) {
  async function* publicParts() {
    let questionPublished = false;
    for await (const part of stream) {
      if (part.type === "tool-error" || (part.type === "tool-result" && failedToolOutput.safeParse(part.output).success)) {
        questionPublished = false;
      } else if (part.type === "tool-result" &&
        (part.toolName === "request_input" || part.toolName === "mcp__hive__request_input") &&
        isPendingQuestion(part.output)) {
        questionPublished = true;
      }
      if (questionPublished && ["text-start", "text-delta", "text-end"].includes(part.type)) continue;
      // In particular, never swallow a native error or abort after a question.
      yield part;
    }
  }
  return consumeAgentText(publicParts(), onText);
}

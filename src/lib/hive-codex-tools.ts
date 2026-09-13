import type { HarnessV1Prompt } from "@ai-sdk/harness";

// Pinned Codex code-mode models defer MCP schemas. Supply the route per prompt,
// not in instructions/skills: changing their fingerprint resets native history,
// and changing a bootstrap asset alone cannot update an already warm bridge.
const toolContext = `<hive-tool-context>
Hive questions use the shared hive MCP request_input tool, not native request_user_input (unavailable in this host).
Hive tools may be absent from the short list but remain callable in functions.exec. Use tools.mcp__hive__request_input with an object containing key and prompt, optional options (up to four short choices) and optional targetMemberId. Await the call and print its receipt with text(...). The key is stable across retries, at most 60 letters, digits, underscores or hyphens. Omit targetMemberId to ask any task member; use tools.mcp__hive__get_context({}) to resolve a named teammate. Discover other Hive tools through ALL_TOOLS when needed; absence from the short list is not unavailability. functions.exec is tool dispatch, not a shell command, and is allowed in planning.
The receipt is not an answer. The shared card is already visible: do not repeat it, create a Thread, poll or call another question tool. End this turn at a safe boundary; Hive saves an eligible answer and continues once with that answer and native context. Report failure only after an actual failed call. Apply these mechanics silently; greetings and direct replies need no tools.
</hive-tool-context>`;

export function withHiveCodexTools(prompt: HarnessV1Prompt): HarnessV1Prompt {
  if (typeof prompt === "string") return `${toolContext}\n\n${prompt}`;
  return { ...prompt, content: typeof prompt.content === "string"
    ? `${toolContext}\n\n${prompt.content}`
    : [{ type: "text", text: toolContext }, ...prompt.content] };
}

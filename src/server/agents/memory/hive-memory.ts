import { createHash } from "node:crypto";
import { z } from "zod";

export type RepositoryMemoryScope = {
  installationId: number;
  repositoryId: number;
};
export type MemorySource = {
  sessionId: string;
  messageId: string;
  replyId?: string;
  authorId: string;
  authorName: string;
};
export class HiveMemoryError extends Error {}

export function repositoryMemoryId(scope: RepositoryMemoryScope) {
  if (
    ![scope.installationId, scope.repositoryId].every(
      (id) => Number.isSafeInteger(id) && id > 0
    )
  ) {
    throw new HiveMemoryError(
      "Attach an authorized repository before using memory."
    );
  }
  return `hive-repo-${createHash("sha256").update(`${scope.installationId}:${scope.repositoryId}`).digest("hex")}`;
}

const memoryText = z.string().trim().min(1).max(1000);
export function checkedMemoryText(text: string) {
  const parsed = memoryText.safeParse(text);
  if (!parsed.success)
    throw new HiveMemoryError(
      "Choose a short convention or decision of up to 1,000 characters."
    );
  // This is a guard against obvious accidental disclosure, not a general secret detector.
  if (
    /```|-----BEGIN |\b(?:sk-|gh[pousr]_|github_pat_|Bearer\s+|postgres(?:ql)?:\/\/)|(?:api[_ -]?key|client[_ -]?secret|password|token)\s*[:=]\s*\S+/i.test(
      parsed.data
    )
  ) {
    throw new HiveMemoryError(
      "Memory is for short team conventions, not code, credentials, or connection strings."
    );
  }
  return parsed.data;
}

const searchResponse = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      memory: z.string(),
      metadata: z.record(z.string(), z.unknown()).nullish(),
    })
  ),
});
const addResponse = z.object({
  status: z.enum(["PENDING", "SUCCEEDED", "FAILED"]).optional(),
  event_id: z.string().optional(),
  results: z.array(z.object({ id: z.string() })).optional(),
});

/** Fixed Mem0 Cloud endpoints. No provider key or caller-supplied scope reaches the sandbox. */
export function createHiveMemory(
  apiKey: string | undefined,
  request: typeof fetch = fetch
) {
  async function call(
    operation: "add" | "search",
    body: unknown,
    signal?: AbortSignal
  ) {
    if (!apiKey?.trim())
      throw new HiveMemoryError(
        "Memory is not connected. Configure MEM0_API_KEY on the Hive server."
      );
    let response: Response;
    try {
      response = await request(
        `https://api.mem0.ai/v3/memories/${operation}/`,
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: {
            Authorization: `Token ${apiKey.trim()}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        }
      );
    } catch {
      throw new HiveMemoryError(
        operation === "add"
          ? "Mem0 did not confirm the write. It may have been saved; search before trying again."
          : "Memory is temporarily unavailable. Continue without recalled context and say so if relevant."
      );
    }
    if (!response.ok)
      throw new HiveMemoryError(
        `Memory service rejected the request (${response.status}). No automatic retry was made.`
      );
    try {
      return await response.json();
    } catch {
      throw new HiveMemoryError(
        "Mem0 returned an unreadable response. Do not claim the operation succeeded."
      );
    }
  }
  return {
    enabled: Boolean(apiKey?.trim()),
    async search(
      scope: RepositoryMemoryScope,
      query: string,
      signal?: AbortSignal
    ) {
      const scopeId = repositoryMemoryId(scope);
      const response = searchResponse.safeParse(
        await call(
          "search",
          {
            query: checkedMemoryText(query),
            filters: { AND: [{ user_id: scopeId }, { app_id: "hive" }] },
            top_k: 3,
            rerank: false,
          },
          signal
        )
      );
      if (!response.success)
        throw new HiveMemoryError(
          "Mem0 returned an unexpected search response."
        );
      return response.data.results
        .filter((item) => item.metadata?.hive_scope === scopeId)
        .slice(0, 3)
        .map((item) => ({
          id: item.id,
          text: item.memory.slice(0, 1500),
          source: {
            sessionId: item.metadata?.source_session_id,
            messageId: item.metadata?.source_message_id,
            replyId: item.metadata?.source_reply_id,
            authorName: item.metadata?.author_name,
          },
        }));
    },
    async remember(
      scope: RepositoryMemoryScope,
      text: string,
      source: MemorySource,
      signal?: AbortSignal
    ) {
      const scopeId = repositoryMemoryId(scope);
      const response = addResponse.safeParse(
        await call(
          "add",
          {
            user_id: scopeId,
            app_id: "hive",
            infer: false,
            messages: [{ role: "user", content: checkedMemoryText(text) }],
            metadata: {
              hive_scope: scopeId,
              source_session_id: source.sessionId,
              source_message_id: source.messageId,
              source_reply_id: source.replyId ?? null,
              author_id: source.authorId,
              author_name: source.authorName,
            },
          },
          signal
        )
      );
      if (!response.success || response.data.status === "FAILED")
        throw new HiveMemoryError(
          "Mem0 did not confirm that the memory was saved."
        );
      if (response.data.status === "PENDING") {
        if (response.data.event_id)
          return { status: "pending", eventId: response.data.event_id };
        throw new HiveMemoryError(
          "Mem0 has not confirmed the write. Do not retry automatically or claim it was saved."
        );
      }
      if (
        response.data.results?.length ||
        response.data.status === "SUCCEEDED"
      ) {
        return {
          status: "saved",
          memoryIds: response.data.results?.map((item) => item.id) ?? [],
          eventId: response.data.event_id,
        };
      }
      throw new HiveMemoryError(
        "Mem0 did not confirm that the memory was saved."
      );
    },
  };
}

import { z } from "zod";
import { codeReferenceSchema } from "../workspace/code-reference.ts";
import { codingEfforts } from "../agents/coding-effort.ts";
import {
  isClientSubmissionId,
  MESSAGE_BODY_LIMIT,
} from "../conversation/message-draft.ts";
import { normalizeTaskTitle } from "../tasks/task-title.ts";

const clientId = z
  .string()
  .refine(isClientSubmissionId, "A valid submission ID is required");
const body = (limit: number) =>
  z
    .string()
    .trim()
    .min(1, "Message body is required")
    .max(
      limit,
      `Messages can contain up to ${limit.toLocaleString("en-US")} characters.`
    );
const modelId = z.string().min(1).max(120).optional();

/** Only client-authored fields belong here. Actor and repository credentials are server-owned. */
export const clientTaskSessionActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rename-task"),
    title: z
      .string()
      .refine(
        (value) => normalizeTaskTitle(value) !== null,
        "Use a task name between 1 and 120 characters."
      ),
  }),
  z.object({ type: z.literal("archive-task") }),
  z.object({ type: z.literal("restore-task") }),
  z.object({
    type: z.literal("send-message"),
    body: body(MESSAGE_BODY_LIMIT),
    clientId,
  }),
  z.object({
    type: z.literal("edit-message"),
    messageId: z.string().min(1),
    body: body(MESSAGE_BODY_LIMIT),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    // Captured when the editor opens; dequeued work cannot silently change.
    queuedSteerId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("answer-question"),
    messageId: z.string().max(200),
    body: body(4000),
    clientId,
    replyThreadId: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("resolve-peer-review"),
    messageId: z.string().max(200),
    revision: z.string().min(1).max(200),
  }),
  z.object({
    type: z.literal("continue-queued-steer"),
    steerId: z.string().max(200),
  }),
  z.object({
    type: z.literal("select-harness"),
    runtime: z.enum(["codex", "claude-code"]),
    modelId,
  }),
  z.object({
    type: z.literal("set-coding-effort"),
    effort: z.enum(codingEfforts),
    modelId,
  }),
  z.object({
    type: z.literal("annotate-message"),
    messageId: z.string(),
    body: body(4000),
    clientId,
  }),
  z.object({
    type: z.literal("annotate-code"),
    reference: codeReferenceSchema,
    body: z
      .string()
      .max(500)
      .refine((value) => value.trim().length > 0, "Message body is required"),
    clientId,
  }),
  z.object({
    type: z.literal("steer-message-annotation"),
    messageId: z.string(),
    annotationId: z.string(),
  }),
  z.object({
    type: z.literal("steer-thread"),
    messageId: z.string(),
    throughReplyId: z.string(),
  }),
  z.object({ type: z.literal("apply-next-steer") }),
  z.object({ type: z.literal("remove-queued-steer"), steerId: z.string() }),
  z.object({
    type: z.literal("reorder-queued-steer"),
    steerId: z.string(),
    direction: z.enum(["up", "down"]),
  }),
  z.object({ type: z.literal("steer-agent") }),
  z.object({ type: z.literal("recover-stalled-run") }),
  z.object({ type: z.literal("reset") }),
]);

export type ClientTaskSessionAction = z.infer<
  typeof clientTaskSessionActionSchema
>;

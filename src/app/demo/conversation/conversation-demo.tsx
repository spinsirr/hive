"use client";

import Link from "next/link";
import { useState } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { ConversationComposer } from "@/components/hive/conversation-composer";
import { ConversationMessage } from "@/components/hive/conversation-message";
import { HiveMark } from "@/components/hive/hive-mark";
import { MessageThread } from "@/components/hive/message-thread";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChatMessage, CodingRuntime, TeamMember } from "@/lib/task-session";
import type { CodingEffort } from "@/lib/coding-effort";
import { codingModelOptions, CODEX_SUBSCRIPTION_MODEL, modelEffort } from "@/lib/coding-models";

const models = codingModelOptions(CODEX_SUBSCRIPTION_MODEL, true);

const members: TeamMember[] = [
  { id: "demo-alex", name: "Alex", shortName: "Alex", initials: "AL", githubLogin: "alex" },
  { id: "demo-casey", name: "Casey", shortName: "Casey", initials: "CA", githubLogin: "casey" },
];
const samples: ChatMessage[] = [
  { id: "request", role: "human", memberId: "demo-alex", name: "Alex", initials: "AL", time: "10:42 AM", body: "Let's make the navigation feel a little quieter. Keep the settings section open when I select a page." },
  { id: "answer", role: "agent", name: "Hive", initials: "H", time: "10:42 AM", body: "I’ll keep the parent section expanded and highlight only the active page.\n\nThe interaction should stay predictable: navigate without losing your place, and keep the selected state distinct from hover.", annotations: [{ id: "reply", authorId: "demo-casey", body: "Keep keyboard focus visible, too.", createdAt: 1789054920000, status: "open" }] },
  { id: "sample-question", role: "agent", name: "Hive", initials: "H", time: "10:43 AM", body: "Should the settings section remain open after navigation?", interaction: { kind: "question", runId: "preview-run", targetMemberId: "demo-alex", options: ["Keep it open", "Close after navigation"] } },
];

export function ConversationDemo({ title = "Conversation preview", repositoryName, initialMessages = samples }: {
  title?: string;
  repositoryName?: string | null;
  initialMessages?: ChatMessage[];
}) {
  const [runtime, setRuntime] = useState<CodingRuntime>("codex");
  const [modelId, setModelId] = useState(CODEX_SUBSCRIPTION_MODEL);
  const [effort, setEffort] = useState<CodingEffort>("low");
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const thread = messages.find((message) => message.id === threadId);
  const steer = (messageId: string, replyId: string) => {
    setMessages((current) => current.map((message) => message.id !== messageId ? message : { ...message, annotations: message.annotations?.map((reply) => reply.id !== replyId ? reply : { ...reply, status: "queued", queuedBy: "demo-alex" }) }));
    setNotice("Queued in this preview only. No agent is running.");
  };
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-white text-[#171717]">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#eee] px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link aria-label="Back to sample tasks" href="/demo" prefetch={false} className="flex shrink-0 items-center gap-2.5 rounded text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"><HiveMark className="size-7" /> <span className="hidden sm:inline">Sample tasks</span></Link>
          <span aria-hidden="true" className="text-[#ddd]">/</span>
          <div className="min-w-0"><h1 className="truncate text-sm font-medium" title={title}>{title}</h1>{repositoryName !== undefined ? <p className="mt-0.5 truncate text-xs text-[#888]">{repositoryName ?? "No repository attached"}</p> : null}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <button aria-pressed={busy} className="cursor-pointer rounded-full border border-[#e8e8e8] px-3 py-1.5 text-[#666] hover:bg-[#f5f5f5]" onClick={() => setBusy((current) => !current)} type="button">{busy ? "Preview: working" : "Preview: idle"}</button>
          <Link href="/" className="text-[#888] hover:text-[#171717]">Open Hive</Link>
        </div>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5 text-xs text-[#aaa]"><p>UI preview · Sample conversation · No model calls</p><div aria-label="Sample teammates" className="flex -space-x-1.5"><span className="grid size-6 place-items-center rounded-full border-2 border-white bg-[#242424] text-xs text-white">AL</span><span className="grid size-6 place-items-center rounded-full border-2 border-white bg-[#eaeaea] text-xs text-[#555]">CA</span></div></div>
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-7 px-5 py-6 sm:px-6">
            {messages.map((message) => <ConversationMessage key={message.id} message={message} currentMember="demo-alex" members={members} sessionId="ui-conversation-preview" disabled={false} runActive={false} queueing={busy} selected={threadId === message.id} onOpenThread={setThreadId} onSteerReply={steer} />)}
            {notice ? <p className="px-1 text-xs text-[#999]" role="status">{notice}</p> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <ConversationComposer value={value} onChange={setValue} onSubmit={() => {
          if (!value.trim()) return;
          setMessages((current) => [...current, { id: crypto.randomUUID(), role: "human", memberId: "demo-alex", name: "Alex", initials: "AL", body: value, time: "Now" }]);
          setValue("");
          setNotice("Message added to this preview only. Nothing was sent to an agent.");
        }} members={members} currentMember="demo-alex" disabled={false} sending={false} unconfirmed={false} queueing={busy} runtime={runtime} modelId={modelId} models={models} agentLocked={busy} agentDisabled={false} onSelectAgent={(nextRuntime, nextModelId) => {
          const model = models.find((entry) => entry.modelId === nextModelId);
          if (!model || busy) return;
          setRuntime(nextRuntime); setModelId(nextModelId);
          setEffort(modelEffort(model, effort) ?? "low");
        }} effort={effort} effortLocked={busy} onEffortChange={setEffort} />
      </div>
      <Dialog open={Boolean(thread)} onOpenChange={(open) => { if (!open) setThreadId(null); }}>
        <DialogContent className="flex h-[min(720px,85dvh)] flex-col overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Thread preview</DialogTitle>
          {thread ? <MessageThread sessionId="ui-conversation-preview" message={thread} members={members} currentMember="demo-alex" disabled={false} runActive={busy} queue={[]} onClose={() => setThreadId(null)} onReply={async (messageId, submission) => {
            setMessages((current) => current.map((message) => message.id !== messageId ? message : { ...message, annotations: [...message.annotations ?? [], { id: crypto.randomUUID(), clientId: submission.clientId, authorId: "demo-alex", body: submission.body, createdAt: Date.now(), status: "open" }] }));
            return true;
          }} onAnswerQuestion={async (messageId, submission) => {
            const replyId = crypto.randomUUID();
            setMessages((current) => current.map((message) => message.id !== messageId || message.interaction?.kind !== "question" || message.interaction.answer ? message : {
              ...message, interaction: { ...message.interaction, answer: { replyId, by: "demo-alex", at: Date.now() } },
              annotations: [...message.annotations ?? [], { id: replyId, clientId: submission.clientId, authorId: "demo-alex", body: submission.body, createdAt: Date.now(), status: "queued", queuedBy: "demo-alex" }],
            }));
            setNotice("Sample answer recorded locally. No agent is running and no task was changed.");
            return true;
          }} onSteerReply={steer} onSteerThread={async (messageId, throughReplyId) => {
            setMessages((current) => current.map((message) => message.id !== messageId ? message : { ...message, threadSteer: { id: crypto.randomUUID(), throughReplyId, replyCount: message.annotations?.length ?? 0, requestedBy: "demo-alex", requestedAt: Date.now(), status: "queued" } }));
            setNotice("Thread queued in this preview only. No agent is running.");
            return true;
          }} /> : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}

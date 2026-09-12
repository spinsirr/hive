"use client";

import { ArrowRight, ArrowUp, Check, ChevronRight, CircleHelp, Code2, GitBranch, MessageSquare, RotateCcw, Users } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useReducer, useRef, useState } from "react";
import { HiveMark } from "@/components/hive/hive-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { answerOptions, canAskHive, createDemoState, demoReducer, pendingComments, phaseCopy, sampleFeedback, type DemoChoice, type DemoMember } from "./demo-state";
import { WorkspacePreview } from "./workspace-preview";

function Avatar({ name, small = false }: { name: DemoMember | "Hive"; small?: boolean }) {
  if (name === "Hive") return <HiveMark className={small ? "size-6 rounded-full" : "size-8 rounded-full"} />;
  return <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full border text-[11px] font-medium", small ? "size-6" : "size-8", name === "Alex" ? "border-[#d9d8d4] bg-[#f0efeb] text-[#57534b]" : "border-[#d2ddd8] bg-[#eaf1ed] text-[#3c6551]")}>{name === "Alex" ? "AL" : "CA"}</span>;
}

export function CollaborationDemo({ title = "Keep navigation predictable", repositoryName = "sample-team / workspace", initialRequest = "Make the Settings navigation feel more predictable. Casey, could you review the interaction as Hive works?" }: {
  title?: string;
  repositoryName?: string;
  initialRequest?: string;
}) {
  const [state, dispatch] = useReducer(demoReducer, undefined, createDemoState);
  const [member, setMember] = useState<DemoMember>("Casey");
  const [choice, setChoice] = useState<DemoChoice>("open");
  const [customAnswer, setCustomAnswer] = useState("");
  const [draft, setDraft] = useState("");
  const [mobileView, setMobileView] = useState<"thread" | "workspace">("thread");
  const conversation = useRef<HTMLDivElement>(null);
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const status = phaseCopy[state.phase];
  const pending = pendingComments(state);
  const reviewOpen = state.phase === "review" || state.phase === "verify";
  const answerBody = choice === "custom" ? customAnswer.trim() : answerOptions.find((option) => option.value === choice)?.label ?? "";

  // Local actions append to this one thread. Jump once without an opening scroll animation.
  useLayoutEffect(() => {
    if (conversation.current && state.replies.length) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [state.replies.length]);

  function reset() {
    dispatch({ type: "reset" });
    setChoice("open"); setCustomAnswer(""); setDraft(""); setMobileView("thread");
    if (conversation.current) conversation.current.scrollTop = 0;
  }

  return <main className="flex h-dvh min-h-[520px] flex-col bg-white text-[#202020]">
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[#e9e9e7] px-4 sm:px-7">
      <Link aria-label="Back to sample tasks" className="flex shrink-0 items-center gap-2.5 rounded text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4" href="/demo" prefetch={false}><HiveMark className="size-8" /><span className="hidden sm:inline">Sample tasks</span></Link>
      <span aria-hidden="true" className="text-[#d1d1cf]">/</span>
      <div className="min-w-0"><h1 className="truncate text-sm font-medium" title={title}>{title}</h1><p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#7a7a75]"><GitBranch className="size-3 shrink-0" /><span className="truncate">{repositoryName}</span></p></div>
      <div className="ml-auto hidden items-center gap-2 sm:flex"><div className="flex -space-x-1"><Avatar name="Alex" /><Avatar name="Casey" /></div><span className="ml-1 text-xs text-[#73736e]">Demo team</span></div>
    </header>

    <aside aria-label="Demo controls" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#e9e9e7] bg-[#fafaf8] px-4 py-2.5 sm:px-7">
      <div className="flex items-center gap-2.5 text-xs"><span className="size-1.5 rounded-full bg-[#6c8474]" /><span className="font-medium">Interactive preview</span><span className="hidden text-[#777771] md:inline">Sample data · No live agents or workspace changes</span></div>
      <div className="flex items-center gap-3"><span className="hidden text-xs text-[#777771] sm:inline">You are</span><div aria-label="Demo persona" className="flex gap-1 rounded-full border border-[#e5e5e1] bg-white p-0.5">{(["Alex", "Casey"] as const).map((name) => <Button aria-pressed={member === name} className={cn("h-7 rounded-full px-3 text-xs", member === name && "bg-[#292b28] text-white hover:bg-[#292b28]")} key={name} onClick={() => setMember(name)} variant="ghost">{name}</Button>)}</div><Button aria-label="Reset collaboration demo" className="text-[#777771]" onClick={reset} size="icon" title="Reset demo" variant="ghost"><RotateCcw className="size-3.5" /></Button></div>
    </aside>

    <nav aria-label="Preview panels" className="flex shrink-0 border-b border-[#e9e9e7] px-4 lg:hidden">{(["thread", "workspace"] as const).map((view) => <button aria-pressed={mobileView === view} className={cn("min-h-11 flex-1 cursor-pointer border-b-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-[-3px]", mobileView === view ? "border-[#343b34] font-medium text-[#292b28]" : "border-transparent text-[#777771]")} key={view} onClick={() => setMobileView(view)} type="button">{view === "thread" ? "Conversation" : `Workspace${state.revision ? ` · v${state.revision}` : ""}`}</button>)}</nav>

    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,1fr)] xl:grid-cols-[minmax(0,1.3fr)_minmax(400px,1fr)]">
      <section aria-label="Task conversation" className={cn("min-h-0 min-w-0 flex-col lg:flex", mobileView === "thread" ? "flex" : "hidden")}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#efefec] px-5 text-xs sm:px-8"><MessageSquare className="size-3.5 text-[#7a7a75]" /><h2 className="font-medium">Task conversation</h2><span className="ml-auto text-[#7a7a75]">One shared thread</span></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-8 pt-6 sm:px-8" ref={conversation}>
          <div className="mx-auto max-w-[740px]">
            <div className="mb-7 flex gap-3"><Avatar name="Alex" /><div className="min-w-0"><div className="mb-1.5 flex items-center gap-2 text-xs"><span className="font-medium">Alex</span><span className="text-[#8a8a84]">Task owner</span></div><p className="text-sm leading-6">{initialRequest}</p></div></div>
            <div className="flex gap-3"><Avatar name="Hive" /><div className="min-w-0 flex-1"><div className="mb-1.5 text-xs font-medium">Hive</div><p className="text-sm leading-6">I’ll update the navigation and prepare the keyboard checks. One behavior to agree on first:</p>
              <section aria-label="Question for the team" className="mt-4 overflow-hidden rounded-xl border border-[#dce3dc] bg-[#fcfdfb]">
                <div className="flex items-center gap-2 border-b border-[#e5eae2] px-4 py-3 text-xs text-[#52634e]"><CircleHelp className="size-3.5" /><span className="font-medium">{state.answer ? "Answered" : "Question for Casey"}</span><span className="ml-auto text-[11px]">{state.answer ? `by ${state.answer.author}` : state.phase === "waiting" ? "Needed to continue" : "Not blocking yet"}</span></div>
                <div className="p-4"><h3 className="text-sm font-medium leading-6">After choosing a Settings page, should the section stay open?</h3>
                  {state.answer ? <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#edf2e9] px-3 py-2.5 text-sm leading-5 text-[#42553b]"><Check className="mt-0.5 size-3.5 shrink-0" /><p className="min-w-0 whitespace-pre-wrap break-words">{state.answer.body}</p></div> : <form onSubmit={(event) => { event.preventDefault(); if (answerBody) dispatch({ type: "answer", author: member, choice, body: answerBody }); }}>
                    <fieldset className="mt-4 space-y-2"><legend className="sr-only">Navigation behavior</legend>{answerOptions.map((option) => <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors", choice === option.value ? "border-[#b1c1aa] bg-[#f0f4ec]" : "border-[#e6e8e2] bg-white hover:border-[#bac4b5]")} key={option.value}><input checked={choice === option.value} className="mt-0.5 size-3.5 shrink-0 accent-[#526b46]" name="navigation-behavior" onChange={() => setChoice(option.value)} type="radio" value={option.value} /><span><span className="block text-xs font-medium">{option.label}</span><span className="mt-1 block text-xs leading-5 text-[#747b6f]">{option.detail}</span></span></label>)}
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-xs text-[#6e7468]"><input checked={choice === "custom"} className="size-3.5 accent-[#526b46]" name="navigation-behavior" onChange={() => setChoice("custom")} type="radio" value="custom" />Something else</label>
                    </fieldset>
                    {choice === "custom" ? <textarea aria-label="Your navigation direction" className="mt-1 min-h-20 w-full resize-y rounded-lg border border-[#dce3d7] bg-white p-3 text-sm outline-none focus:border-[#718366]" maxLength={1000} onChange={(event) => setCustomAnswer(event.target.value)} placeholder="Describe the behavior you want…" value={customAnswer} /> : null}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-[11px] text-[#7a8075]">Your answer will continue this work.</span><Button className="h-8 rounded-lg bg-[#344b30] px-3 text-xs hover:bg-[#293c26]" disabled={!answerBody} type="submit">Answer as {member}<ArrowRight className="size-3.5" /></Button></div>
                  </form>}
                </div>
              </section>
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-[#878b81]"><Users className="size-3" />Visible to everyone in this task</div>
            </div></div>

            {state.replies.length ? <div aria-label="Thread replies" className="ml-4 mt-6 space-y-5 border-l border-[#e1e4dd] pb-1 pl-6 sm:ml-4 sm:pl-7">{state.replies.map((reply) => <article className="flex gap-2.5" key={reply.id}><Avatar name={reply.author} small /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-medium">{reply.author}</span>{reply.kind === "answer" ? <span className="text-[#697f5c]">Answer accepted</span> : reply.kind === "comment" ? <span className="text-[#8a8a84]">{state.sharedReplies[reply.id] ? `Shared by ${state.sharedReplies[reply.id]}` : "Discussion only"}</span> : null}</div><p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-[#555650]">{reply.body}</p></div></article>)}</div> : null}

            {state.revision > 0 ? <section aria-label="Shared review" className="ml-0 mt-6 rounded-xl border border-[#e3e5df] p-4 sm:ml-11">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-medium"><Code2 className="size-4 text-[#727c68]" />Review · v{state.revision}</div><span className="text-[11px] text-[#7b7e75]">{state.phase === "complete" ? `Resolved by ${state.resolvedBy}` : state.phase === "revising" ? "Updating" : "For Casey"}</span></div>
              <p className="mt-2 text-xs leading-5 text-[#73776d]">{state.revision > 1 ? "v1 is superseded. Verify this version before resolving." : "Check navigation behavior and keyboard focus on this version."}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2"><Button className="text-xs lg:hidden" onClick={() => setMobileView("workspace")} size="sm" variant="outline">View sample diff<ChevronRight className="size-3" /></Button>{reviewOpen ? <><Button className="text-xs" disabled={pending.length > 0} onClick={() => dispatch({ type: "resolve", author: member, revision: state.revision })} size="sm" variant="outline"><Check className="size-3" />Verify & resolve as {member}</Button>{pending.length > 0 ? <span className="text-[11px] text-[#8a6e44]">Share new feedback first.</span> : null}</> : null}</div>
            </section> : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-[#efefec] bg-[#fcfcfa] px-4 py-3 sm:px-7">
          {canAskHive(state) ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-[#73776d]">{pending.length} new {pending.length === 1 ? "reply" : "replies"} · not sent to Hive</span><Button className="h-7 text-xs" onClick={() => dispatch({ type: "ask-hive", author: member })} size="sm" variant="outline">Ask Hive about this thread<ArrowRight className="size-3" /></Button></div> : null}
          {reviewOpen && !draft && !pending.length ? <button className="mb-2 cursor-pointer text-xs text-[#6f795f] underline decoration-[#bbc4ac] underline-offset-4 hover:text-[#344b30]" onClick={() => { setDraft(sampleFeedback); replyInput.current?.focus(); }} type="button">Try a keyboard-focus review comment</button> : null}
          <form className="rounded-xl border border-[#dedfd9] bg-white p-2.5 shadow-[0_1px_3px_#00000004] focus-within:border-[#b1b9a7]" onSubmit={(event) => { event.preventDefault(); if (!draft.trim()) return; dispatch({ type: "comment", author: member, body: draft }); setDraft(""); }}>
            <label className="sr-only" htmlFor="demo-thread-reply">Reply to thread as {member}</label><textarea className="max-h-28 min-h-12 w-full resize-none px-1 py-1 text-sm leading-6 outline-none placeholder:text-[#a0a198] disabled:cursor-not-allowed" disabled={state.phase === "complete"} id="demo-thread-reply" maxLength={1000} onChange={(event) => setDraft(event.target.value)} placeholder={state.phase === "complete" ? "Review resolved. Reset the demo to try again." : `Reply to thread as ${member}…`} ref={replyInput} rows={2} value={draft} />
            <div className="flex items-center justify-between gap-2"><span className="px-1 text-[11px] text-[#92958a]">Discussion only · use Ask Hive to share feedback</span><Button aria-label={`Send thread reply as ${member}`} className="size-7 rounded-full" disabled={!draft.trim() || state.phase === "complete"} size="icon" type="submit"><ArrowUp className="size-3.5" /></Button></div>
          </form>
        </div>
      </section>
      <WorkspacePreview className={cn("lg:flex", mobileView === "workspace" ? "flex" : "hidden")} state={state} />
    </div>

    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#e3e6dc] bg-[#f1f3ed] px-4 py-3 sm:px-7">
      <div className="min-w-0" role="status"><p className="flex items-center gap-2 text-xs font-medium text-[#49563e]"><span className={cn("size-1.5 shrink-0 rounded-full", state.phase === "waiting" ? "bg-[#ab823b]" : "bg-[#738461]")} />{status.label}</p><p className="mt-1 max-w-[680px] text-[11px] leading-4 text-[#7c8371]">{state.phase === "waiting" ? "Answer the question to continue. Waiting does not approve anything." : "Demo controls advance sample work only. No model calls; refresh resets everything."}</p></div>
      {status.next ? <Button className="h-8 rounded-lg border-[#d5dbca] bg-white px-3 text-xs text-[#4d5c40]" onClick={() => dispatch({ type: "advance" })} variant="outline">{status.next}<ArrowRight className="size-3.5" /></Button> : state.phase === "complete" ? <Button onClick={reset} size="sm" variant="outline"><RotateCcw className="size-3" />Try again</Button> : state.phase === "waiting" && mobileView === "workspace" ? <Button onClick={() => setMobileView("thread")} size="sm" variant="outline">Answer question<ArrowRight className="size-3" /></Button> : <span className="hidden text-[11px] text-[#7c8371] sm:block">{reviewOpen ? "Read the diff, then reply in the thread." : "One task. One shared context."}</span>}
    </footer>
  </main>;
}

// Local UI simulation only. This module never contacts a model, task, or workspace.
export type DemoMember = "Alex" | "Casey";
export type DemoPhase = "working" | "waiting" | "resumed" | "review" | "revising" | "verify" | "complete";
export type DemoChoice = "open" | "close" | "custom";
export type DemoReply = {
  id: number;
  author: DemoMember | "Hive";
  body: string;
  kind: "comment" | "answer" | "update";
};

export type DemoState = {
  phase: DemoPhase;
  answer: { author: DemoMember; body: string; choice: DemoChoice } | null;
  replies: DemoReply[];
  revision: number;
  sharedReplies: Record<number, DemoMember>;
  resolvedBy: DemoMember | null;
};

export type DemoAction =
  | { type: "advance" }
  | { type: "answer"; author: DemoMember; choice: DemoChoice; body: string }
  | { type: "comment"; author: DemoMember; body: string }
  | { type: "ask-hive"; author: DemoMember }
  | { type: "resolve"; author: DemoMember; revision: number }
  | { type: "reset" };

export const sampleFeedback = "Please keep keyboard focus visible on the selected page, too.";
export const answerOptions = [
  { value: "open", label: "Keep Settings open", detail: "Keep your place when moving between pages." },
  { value: "close", label: "Close after navigating", detail: "Collapse Settings once a page is selected." },
] as const;

export function createDemoState(): DemoState {
  return { phase: "working", answer: null, replies: [], revision: 0, sharedReplies: {}, resolvedBy: null };
}

export function pendingComments(state: DemoState) {
  return state.replies.filter((reply) => reply.kind === "comment" && !state.sharedReplies[reply.id]);
}

export function canAskHive(state: DemoState) {
  return (state.phase === "review" || state.phase === "verify") && pendingComments(state).length > 0;
}

function append(state: DemoState, ...replies: Omit<DemoReply, "id">[]): DemoReply[] {
  return [...state.replies, ...replies.map((reply, index) => ({ ...reply, id: state.replies.length + index + 1 }))];
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset": return createDemoState();
    case "answer": {
      const body = action.body.trim().slice(0, 1000);
      // Accept once; switching personas must not rewrite an accepted answer.
      if (state.answer || !body || !["working", "waiting"].includes(state.phase)) return state;
      return { ...state, phase: "resumed", answer: { author: action.author, body, choice: action.choice }, replies: append(state,
        { author: action.author, body, kind: "answer" },
        { author: "Hive", body: `Thanks, ${action.author}. Your answer is captured. In this simulation, I can now continue with the navigation change. No additional steer needed.`, kind: "update" },
      ) };
    }
    case "comment": {
      const body = action.body.trim().slice(0, 1000);
      if (!body || state.phase === "complete") return state;
      return { ...state, replies: append(state, { author: action.author, body, kind: "comment" }) };
    }
    case "ask-hive": {
      if (!canAskHive(state)) return state;
      const comments = pendingComments(state);
      return { ...state, phase: "revising",
        sharedReplies: { ...state.sharedReplies, ...Object.fromEntries(comments.map((reply) => [reply.id, action.author])) },
        replies: append(state, { author: "Hive", body: `${action.author} shared ${comments.length === 1 ? "a reply" : `${comments.length} replies`} with me. I’ll keep each author attached and bring the next sample revision back to this thread.`, kind: "update" }),
      };
    }
    case "advance": {
      if (state.phase === "working") return { ...state, phase: "waiting" };
      if (state.phase === "resumed") return { ...state, phase: "review", revision: 1, replies: append(state,
        { author: "Hive", body: "Casey, could you review navigation behavior and keyboard focus? Sample revision v1 is ready on the right. This review is tied to that version; nothing is approved automatically.", kind: "update" },
      ) };
      if (state.phase === "revising") return { ...state, phase: "verify", revision: state.revision + 1, replies: append(state,
        { author: "Hive", body: `Sample revision v${state.revision + 1} is ready. The fixture demonstrates a visible focus ring; it is not generated from free-form feedback. Please verify the current version before resolving this review.`, kind: "update" },
      ) };
      return state;
    }
    case "resolve": {
      if (!["review", "verify"].includes(state.phase) || action.revision !== state.revision || pendingComments(state).length) return state;
      return { ...state, phase: "complete", resolvedBy: action.author, replies: append(state,
        { author: action.author, body: `Verified sample revision v${state.revision}. Resolving this review.`, kind: "update" },
      ) };
    }
  }
}

export const phaseCopy: Record<DemoPhase, { label: string; detail: string; next?: string }> = {
  working: { label: "Working · question open", detail: "Hive can prepare keyboard checks while Casey considers the navigation behavior.", next: "Finish independent work" },
  waiting: { label: "Waiting for an answer", detail: "Independent work is done. The navigation change needs a decision; silence is not approval." },
  resumed: { label: "Answer received · continuing", detail: "The reply resumes the original work automatically. The answer and its author stay in this thread.", next: "Prepare sample review" },
  review: { label: "Review requested", detail: "Review a specific version. Thread comments stay between teammates until someone shares them with Hive." },
  revising: { label: "Working from thread feedback", detail: "Only the shared replies are in this run. New replies remain discussion until you share them.", next: "Return sample revision" },
  verify: { label: "Ready for verification", detail: "A new version supersedes the previous review. A teammate—not Hive—verifies and resolves it." },
  complete: { label: "Review resolved", detail: "The decision, feedback, and review result all remain in one thread. No live task was changed." },
};

export function demoDiff(state: DemoState): { kind: "context" | "add" | "remove"; text: string }[] {
  if (!state.answer || state.answer.choice === "custom") return [
    { kind: "context", text: "// No generated code in this UI preview." },
    { kind: "context", text: state.answer ? "// Custom direction captured in the thread." : "// Waiting for a navigation decision." },
  ];
  return [
    { kind: "context", text: "function onSelectPage(page: Page) {" },
    { kind: "context", text: "  navigate(page.href);" },
    { kind: "remove", text: "  toggleSettings();" },
    { kind: "add", text: `  setSettingsOpen(${state.answer.choice === "open"});` },
    { kind: "context", text: "}" },
    { kind: "context", text: "" },
    { kind: "context", text: "<NavigationLink" },
    ...(state.revision > 1 ? [
      { kind: "remove" as const, text: '  className="nav-link"' },
      { kind: "add" as const, text: '  className="nav-link focus-visible:ring-2"' },
    ] : [{ kind: "context" as const, text: '  className="nav-link"' }]),
    { kind: "context", text: "  href={page.href}" },
    { kind: "context", text: "/>" },
  ];
}

# Public Vercel take-home references

Checked 2026-09-08. This is a small, illustrative sample for Hive's introduction, scope, and presentation. It is not a Vercel rubric or evidence of what earns an offer. Two modern AI projects have explicit author-written Vercel take-home descriptions; older exercises and a weaker title-only example are labeled separately. None of the sources reviewed reports a hiring outcome. Repository contents and author claims were inspected; the applications were not run or independently tested.

## Modern AI projects with explicit author identification

### 1. DealWave Agent — David Wells

**Provenance:** The author's repository description says “Vercel SA take-home — agentic deal analyst on AI Gateway + Workflow.” GitHub records creation in May 2026. This identifies a Solutions Architect exercise, not necessarily Hive's role or assignment. [Author repository](https://github.com/thedavidwells/dealwave-agent), [repository metadata](https://api.github.com/repos/thedavidwells/dealwave-agent).

**Purpose and complete loop:** A property investor supplies an address; tools retrieve underwriting data and comparable properties; a second model produces a validated verdict with score, strategy, metrics, and risks. The user can approve saving a deal, review saved deals, and request sensitivity analysis. The author also describes a durable post-save review and sandboxed Monte Carlo analysis. [README](https://github.com/thedavidwells/dealwave-agent/blob/main/README.md).

**Stack and presentation:** Next.js, AI SDK, AI Gateway, Workflow SDK, Sandbox, and AI Elements each have a purpose mapped to implementation files. The README explains model tiering, the research/advisor split, structured-output evaluation, and rendering choices. It admits duplicate-save errors, an approval state lost on refresh, and a delayed verdict. This is a strong example of linking services to product behavior and making limitations visible. It does **not** document the author's AI-assisted development journey or report an interview result. Performance/cost statements are the author's claims, not measurements verified here. [README](https://github.com/thedavidwells/dealwave-agent/blob/main/README.md).

**Use for Hive:** Put the shared task outcome first, then map each Vercel primitive to the part of that outcome it enables. Do not treat DealWave's feature count as a target; its time allowance is not established.

### 2. Vercel Docs Assistant — cchaechae

**Provenance:** The author's repository description says “Take home for Vercel AI SDK.” GitHub records creation in June 2026. A separate design note explicitly discusses an interview rubric, corroborating the exercise context; it does not establish that this was Hive's exact brief. [Author repository](https://github.com/cchaechae/vercel-takehome-ai), [repository metadata](https://api.github.com/repos/cchaechae/vercel-takehome-ai), [design note](https://github.com/cchaechae/vercel-takehome-ai/blob/main/docs/design/2026-06-04-retrieval-and-context-design.md).

**Purpose and complete loop:** A developer asks about Vercel, Next.js, or AI SDK documentation. A bounded agent chooses between semantic search and fetching a full page, then streams an answer with source links and a visible tool trace, or declines when grounding is insufficient. Chats persist in browser storage. [README](https://github.com/cchaechae/vercel-takehome-ai/blob/main/README.md).

**Stack and presentation:** Next.js App Router, AI SDK v6, and AI Gateway. An offline ingest builds a JSON index; the demo deliberately avoids a runtime database, authentication, multi-tenancy, and multiple agents. The README gives a compact architecture, two-tool table, evaluation command, tradeoffs, and omissions. The design note compares alternative retrieval approaches, explains the current scale, and separates demo needs from future infrastructure. Neither source provides an explicit account of how the author used coding AI or a hiring result. [README](https://github.com/cchaechae/vercel-takehome-ai/blob/main/README.md), [design note](https://github.com/cchaechae/vercel-takehome-ai/blob/main/docs/design/2026-06-04-retrieval-and-context-design.md).

**Use for Hive:** Define one bounded working loop and justify its boundaries. A visible explanation of what the agent consumed, did, and returned carries more information than an expansive capability list.

## Older exercises: useful for presentation, different evaluation contexts

### 3. Preview-comment collaboration UI — eerikson

**Provenance:** The author named the repository `vercel-takehome`; its README discusses the supplied design prompt, preview comments, and who the author is interviewing with. GitHub records January 2025 creation. The reviewed README does not name the precise role. This is a frontend exercise, not a modern AI product submission. [Author repository](https://github.com/eerikson/vercel-takehome), [metadata](https://api.github.com/repos/eerikson/vercel-takehome).

**Scope and framing:** A Next.js implementation explores collaborator cursors and comment interactions. The author explains inferred design intent, message attribution, cursor colors, reduced motion, keyboard access, animation performance, and unfinished cursor/formatting behavior. CSS Modules, native browser APIs, `next/font`, and React Transition Group support that surface. These are documented UI behaviors; the README does not establish a real shared backend or production multiplayer service. No AI development journey or hiring result is reported. [README](https://github.com/eerikson/vercel-takehome/blob/main/README.md).

**Use for Hive:** This is the closest presentation precedent for explaining *why attribution matters*. Distinguish the visible identity of a teammate from evidence that their input actually reached the shared agent.

### 4. Vercel Take Home Exercise — Nate Skiles

**Provenance:** The README explicitly identifies a frontend built to complete the Vercel Take Home Exercise. The README's last-modified date returned by GitHub is March 2024. [README](https://github.com/NateSkiles/vercel-take-home/blob/main/README.md).

**Scope and framing:** A Next.js/Nextra/MDX documentation site presents ten exercise responses covering support work, troubleshooting, cloud concepts, customer responses, redirects, and indexing. The author explains choosing a documentation template to keep attention on the exercise content. One response presents a support incident through evidence gathering, diagnosis, mitigation, stakeholder work, and reflection. This is a support-oriented exercise, not a comparable AI app. No coding-AI journey or hiring result is reported in the reviewed sources. [Exercise index](https://github.com/NateSkiles/vercel-take-home/blob/main/pages/exercises.mdx), [problem-solving response](https://github.com/NateSkiles/vercel-take-home/blob/main/pages/exercises/3_problem_solving.mdx).

**Use for Hive:** Make the reviewer journey easy to follow and describe a concrete problem with evidence, decisions, and a visible result.

## Additional product-framing reference: provenance is weaker

### 5. Room Review — Timothy Cheng

**Identification limit:** The author named the public repository `vercel-takehome`, but its description is empty and the reviewed README does not explicitly identify the employer, role, assignment, or submission status. Treat it as a suggestive author-labeled reference, not a verified equivalent of the current brief. GitHub records creation in February 2026. [Author repository](https://github.com/timothychengg/vercel-takehome), [metadata](https://api.github.com/repos/timothychengg/vercel-takehome).

**Purpose and complete loop:** A host creates a screening board and shares its link. Guests contribute reactions and star ratings; AI produces a streaming summary of the audience response. The README centers the single screening as both the product boundary and data boundary, then explains static versus dynamic routes. It describes Next.js 14, Upstash Redis, Vercel AI SDK with OpenAI, and Vercel hosting. Its product explanation is unusually concrete and brief. No AI development account or hiring outcome is reported. [README](https://github.com/timothychengg/vercel-takehome/blob/main/README.md).

**Use for Hive:** Explain the single shared task as clearly as this project explains a single shared screening. The shared object, the participants' actions, and the resulting artifact should all fit in the opening paragraph.

## Official Vercel references — not take-home submissions

- **Coding Agent Template:** Already offers coding agents, GitHub/Vercel authentication, Sandbox, Gateway, Next.js, and Neon Postgres. Its documented multi-user model gives each user their own tasks, keys, and GitHub connection. This means those services alone do not explain Hive's product distinction. Hive's proposed distinction is several people participating in and steering the **same** task and inspecting the same result. That distinction is an inference from comparing the template with Hive's stated scope. [Official README](https://github.com/vercel-labs/coding-agent-template/blob/main/README.md).
- **Sandboxed Issue Triage Agent:** Accepts a repository, issue report, optional failing command, and harness choice; streams an isolated investigation and returns a reproduction report. Its README explicitly excludes GitHub app setup, comments, PR creation, Workflow durability, and patch mode. This is a relevant example of a focused HarnessAgent/Sandbox product loop with clear exclusions. [Official README](https://github.com/vercel-labs/sandboxed-issue-triage-agent/blob/main/README.md).

## Implications for Hive

These are presentation recommendations drawn from the examples, not claims about Vercel's grading:

1. Open with the problem and shared unit of work: teammates need to discuss and steer one coding task while seeing the same transcript, workspace, changes, and checks.
2. Demonstrate one continuous path: join the same task → discuss an attributed concern → explicitly promote it to agent input → observe queued/consumed input → inspect the resulting diff and test output together.
3. Separate product behavior from infrastructure. Explain the team interaction first; use the architecture section to show why Harness/Codex, Gateway, Sandbox, and Postgres support it.
4. State scope limits in a compact section. Do not add PR automation, organization administration, uploads, or cross-task memory merely because a reference has more features.
5. Keep the current assignment's AI-journey requirement explicit. The public examples offer architecture and tradeoff writing, but the reviewed READMEs do not replace a candid account of what coding AI generated, what the author changed or rejected, and how the result was verified.

## Research limits

Public GitHub search found stronger candidates than broad web queries, which often confused take-homes *hosted on Vercel* with take-homes *for Vercel*. Projects explicitly for CambioML, Spur, Ajaia, Wardly, and other employers were excluded. Official templates were kept separate. No passing result, interview duration, exact six-hour brief, or general hiring standard was inferred from a repository name, public availability, deployment link, or project size.

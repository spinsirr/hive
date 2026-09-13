# Hive UI ownership

## Product and visual direction

Hive is a shared task workspace: teammates discuss, steer one agent, and review
the same files. Keep the interface quiet, compact, and content-led. The existing
production UI is the design reference; demos are not alternate designs.

## Single source of truth

- `src/components/hive/hive-workspace.tsx` owns `HiveWorkspaceView`, the complete
  task interface: header, responsive split, conversation, composer, Thread,
  workspace tabs and recovery controls. The live wrapper supplies the connection.
- Feature components under `src/components/hive` own their interactions and styles.
  Shared controls come from `src/components/ui` and `src/components/ai-elements`.
- `src/app/demo/demo-workspace.tsx` supplies sample state and a local client to
  **the same view**. Demo-only UI is limited to a labelled simulation toolbar.
- Demo routes select fixtures, not layouts. Do not create a second conversation,
  header, editor, question/review card or workspace implementation under `demo`.
- `src/components/hive/hive-client.tsx` is the scoped request boundary. Production
  uses HTTP; demo implements local responses with no network fallback. The demo
  never mounts the live session hook or changes global fetch/WebSocket behavior.

## Foundations and component rules

### Typography (existing contract, retained)

| Role                                                              | Font and size    | Tailwind utility                      |
| ----------------------------------------------------------------- | ---------------- | ------------------------------------- |
| Message bodies, thread replies, editable text                     | Geist, 14px      | `text-sm`; body copy uses `leading-6` |
| Names, compact controls, labels, timestamps, statuses, paths, IDs | Geist, 12px      | `text-xs`                             |
| Headings                                                          | Geist, 16–24px   | `text-base` through `text-2xl`        |
| Code, diffs, commands, terminal output                            | Geist Mono, 12px | `font-mono text-xs`                   |

Use regular weight for reading, medium for names/controls, semibold for headings.
Ordinary interface text has a 12px floor, including avatars and number badges.
Editable inputs use 16px below `sm`, then 14px, to avoid mobile Safari focus zoom.
Decorative TS/JS icons may retain 10px lettering in a 16px icon and are hidden
from assistive technology. Keep monospace on code/commands (including inline code),
not filenames, paths, timestamps, durations, counters or checkpoint IDs.
Use existing Tailwind sizes instead of per-component pixel-size exceptions.

2026-09-10: Consolidated scattered 7–14px interface sizes into 12px metadata and
14px body roles, retaining Geist and Geist Mono. This decision remains in force.

### Shared styles

`src/app/globals.css` owns the existing Tailwind/shadcn color, typography and radius
tokens: Geist Sans / Geist Mono, neutral surfaces, restrained borders and primary
text. Preserve production styling when changing demo data. Feature CSS modules
own split/file layout details; do not copy their CSS into routes.

Use existing buttons, dialogs and inputs, preserve focus restoration and keyboard
navigation, and retain the production mobile Chat/Workspace navigation. Demo
identity switching, reset, files and checkpoints operate only on sample state.
Always disclose sample data and simulated results; never label a simulation Live.
Preserve text wrapping and truncation without clipping avatars, badges, menus or
workspace navigation. Long source lines scroll inside their own container rather
than overflowing the page. Verify desktop and narrow layouts, including Thread
and agent settings, when changing typography.

## Migration and exceptions

Removed: standalone collaboration, conversation and subagent preview layouts and
the collaboration-only state machine. Kept: sample task dashboard and its links.
Adapted: fixtures to the production task state/reducer and request contracts.
No new visual system, component library or production behavior is introduced.

The simulation toolbar is the sole task-page layout exception. Dashboard sample
controls are also intentionally demo-only. Existing production style literals are
out of scope; this change does not mandate an unrelated token migration.

## Enforcement and verification

### Task naming (2026-09-12)

New task creates the member-owned task and opens its conversation immediately,
without a naming dialog, seeded greeting or agent run. New and reset conversations
start empty; the existing composer guides the first message. Historical messages
are not rewritten. An empty stored title means not yet named;
the interface displays `Untitled task`. The first accepted main-conversation
message assigns a whitespace-normalized excerpt (at most 72 graphemes and 120
UTF-16 code units), atomically with that message. This is not an AI summary.
Every nonempty stored title is authoritative, including historical names and a
manual `Untitled task`; later messages, run completion and restore never rename
it. No schema migration, title polling or additional inference is required.

The shared header reads the current session snapshot, not a separate initial-title
prop. Its title button opens `TaskTitleControl` for a member to rename the task
for everyone. Renaming changes neither task ID/URL, messages nor agent execution;
it follows existing membership, origin, recovery and archive guards. Demo uses
the same creation entry and workspace controls with local sample state.

### Message editing (2026-09-12)

Following Slack's message model, a member edits their own ordinary message in
place via its compact action menu, with explicit Save changes / Cancel. Preserve
its ID, author, original timestamp, Thread and timeline position. Keep the main
composer's draft separate. Escape cancels; Ctrl/Command+Enter saves; Enter and IME
confirmation remain text input. Menus and editor return keyboard focus correctly.
Edited opens retained previous versions; that shared audit history is a Hive
choice, not a claim about Slack's UI. Agent output, code quotes and restore
receipts are not editable. Archived tasks remain read-only.

Saving changes discussion without replaying or interrupting a run. A plain queued
message updates its pending input atomically and keeps its queue position; already
dispatched work and frozen whole-Thread steers retain their original input.
Concurrent edits and changed queue identities fail visibly and keep the draft.
The queue sits above the composer, with edit, reorder, remove and safe-boundary
Run next actions. Removing a queued request keeps its conversation message.
Production and Demo compose the same message actions, inline editor and queue.

`SteeringQueue` owns one compact row for pending and applying work, regardless of
whether it came from a message, Thread, answer or code comment. Each row keeps a
bounded content preview above quiet source/submitting-member metadata; status and
the action menu occupy consistent positions. A Thread preview uses the last human
reply within its saved handoff boundary, with that reply's author, never later
discussion. Missing source content gets a neutral label, not an invented excerpt.
Internal handoff instructions and answer JSON are not UI copy or hover titles.
The applying row retains the same preview and source, but has no queue mutations.
Pending rows keep reorder/remove and source navigation; only the author's own
plain queued message is editable. Unifying presentation does not change queue
order, frozen inputs, safe-boundary Run next or agent invocation.

### Thread presentation (2026-09-12)

An agent turn and its adjacent question/review messages form one visual group
with one author header, linked only by the stored run ID. Never group by author,
timestamp proximity or similar text, and never move a message across a human
contribution. A question without its source turn remains a standalone message.
The turn's explanation precedes its attached requests; source records, message
IDs, individual copy actions and Thread destinations stay unchanged.

Messages retain the same body surface, width, padding and author alignment before
and after the first reply. A reply must not turn an ordinary message into a card
or remove a human message's bubble. `MessageThreadPreview` owns one lightweight,
bounded footer with a reply count, excerpt and open state for ordinary messages,
questions and reviews. Its subtle left rule connects the discussion to its parent;
it does not wrap or restyle that parent. Question/review metadata and answer controls
compose inside the same message layout, not an additional outer card.
Copy, Reply and More actions sit below the message content (2026-09-13), before
the discussion footer; author headers remain metadata-only. The same placement
applies to ordinary messages and question/review messages. Own-message actions
align right; other actions align left. Touch and keyboard access remain available.
Copy retains its copy icon and briefly says
`Copied`; a persistent checkmark must not resemble review approval.
The Thread's selected and keyboard-focus states are distinct, and the full-width
entry remains available on touch screens and archived tasks. Production and Demo
use the same message-group and preview components.

The main conversation shows one Thread entry per message, with only the latest
reply's author and a bounded two-line excerpt. Opening the Thread hides that
excerpt; full replies, timestamps and steering controls live in `MessageThread`.
Questions render the shared `QuestionAnswer` widget inline, not a mandatory
Thread entry. Only the designated teammate can answer; others see who is awaited.
The answer is displayed in the question card, not counted as a discussion reply.
Reply can explicitly start discussion. Archived tasks keep existing Threads
readable and disable answering.

Question controls are compact (2026-09-12): choices and a quiet Write an answer
entry, not a permanently open second composer. Clicking a question option submits
that answer immediately; there is no second Answer confirmation. Disable choices
while sending, show progress on the chosen option, and reuse its delivery identity
on retry. This shortcut never applies to review approval. Custom text expands a one-row,
content-growing input with its submit action alongside, without a separate footer.
Questions without options show that compact input directly. Restored custom drafts
stay visible without stealing focus. Keep question metadata neutral; no large
warning badge, surrounding card or decorative attention animation. The same
QuestionAnswer component owns this behavior inline and inside Threads.

The timeline suppresses exact repeated empty question cards using their stable
request key, prompt, addressee and choices. Source records and IDs are unchanged;
copies with replies, answers or other evidence stay visible and are never merged.
Thread is for team discussion; an explicit Steer hands work back to the main
conversation. Progress, new questions, results and failures from that run appear
there once, not as replies to the source Thread. This applies to immediate and
queued starts, including historical single-reply steers. The source keeps its
authors, discussion and handoff boundary; it is provenance, not a reply address.
Run admission and the Demo share this destination rule. Already-admitted runs
keep their persisted route. Navigation never starts a run.

After a confirmed handoff, the sender returns to the main conversation. Failed
submissions keep the Thread open; delayed confirmations do not override a newer
navigation choice. Other teammates' views never move. Review feedback remains
bound to its source Thread and the completed revision even though Hive replies
in main; later comments are not silently marked addressed.

A question raised while working in a Thread belongs to that existing Thread.
Its durable message keeps the originating `threadId`; the timeline excludes it
and `MessageThread` renders the same inline widget. Its answer resumes the main
agent in that Thread, never a nested Thread. Main-conversation answers stay in
the main conversation unless explicitly answered within an opened Thread.
Reply destinations are validated against the question record, not arbitrary
client-supplied IDs. Opening a Thread or adding discussion does not start a run.

Thread has one explicit Steer thread / Queue thread action, never per-reply
Steer buttons or a separate Thread agent. It sends the parent and the full
attributed discussion up to the clicked reply boundary to the existing main
agent. Later replies are not silently included. Previously shared replies remain
context; a new handoff needs new human feedback, so Hive's own acknowledgement
cannot repeatedly wake itself. Partial streaming responses cannot be handed off.
Ordinary replies, including mentions, do not start a run. No agent-generated
summary is required before Steer. Historical per-reply steering attribution
and already queued work remain readable and executable.

### Review navigation (2026-09-12)

Viewing changes from a review Thread keeps its identity and shows Back to review
above the workspace tabs. Direct Diff entry lists the reviews matching the current
workspace revision, with the shared review status and Open review links. Archived
tasks retain these read-only links and verification history. Older review Threads
retain their own return link and explicitly warn when the current diff no longer
matches. Diff, Files and Runs are evidence views, never approval
surfaces. Mark as reviewed lives only in the original Thread, gated by the current
revision and reviewer. No global Approve changes button or action remains. Demo
uses these same components. Historical task approval records are not rewritten.

Review controls follow the compact question treatment: a flat View changes /
Mark as reviewed row, no surrounding card or repeated instruction paragraph.
Only unavailable actions get a short reason (pending work, outdated revision or
the designated reviewer). Completion is consistently labeled Reviewed by across
the Thread, conversation and workspace. Marking a revision reviewed records that
human decision only; it does not start a run, approve a PR or merge anything.

### Team archive (2026-09-12)

Archive is separate from run completion. The dashboard exposes Active/Archived
lists and the task header exposes Archive/Restore. Both use `TaskArchiveControl`
with a team-wide confirmation. A shared read-only banner names the archiving
member. Reading discussion, files and history remains available; all mutations
require restoring first. In-flight runs, queued work and recovery block archive.
Demo uses the same controls and reducer with local sample state.

`test:design-system` checks demo route ownership, production/demo dependency
direction, removal of duplicate task UIs and isolation of the local client.
Guard self-tests must reject a deliberately duplicated demo and direct network
access. The dedicated CI step runs alongside type, lint and component checks.
Browser checks cover sample tasks, Thread replies/questions, resizable panes,
Files, Runs, Checkpoints and narrow-screen navigation using production components.

### Happy-path attention and motion (2026-09-12)

Reading position, the selected workspace tab and unsent drafts belong to the
person using the page. Sending, queuing or finishing a run must not switch Diff,
Files, Runs or Checkpoints. Explicit navigation and review links may switch views.
Follow incremental output only while the reader is at the bottom; scrolling up
opts out. Back to latest is a named, visible action and returns keyboard focus to
the reading surface, not the disappearing button or the mobile composer.

Thread-originated work shows a scoped waiting status before its first text delta;
an unrelated run must not make every Thread appear busy. New deltas do not refocus
inputs. Streaming uses actual received text, never a synthetic typing delay.
Pending questions show one quiet header entry for eligible members, including
when the question belongs to a Thread or the reader is viewing Files. It points
to the existing widget only after a click; arrival never navigates or moves focus.
Answered questions disappear from this actionable count. It is not an unread
counter, and is suppressed while the task is archived or recovering.
JavaScript scroll animation respects reduced motion as well as CSS. Shared buttons
transition only their visual feedback properties, not dimensions or layout.
Do not add ornamental entrance animation to each token/message. Judge motion by
continuity, interruption and focus preservation, not by the amount of animation.

The continuous production journeys and evidence rules in
`docs/HAPPY_PATH_ACCEPTANCE.md` supplement functional regression checks. A passing
mock or final screenshot cannot certify stream smoothness, first-token timing,
mobile keyboard behavior or attention management.

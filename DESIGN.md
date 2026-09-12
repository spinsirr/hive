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

| Role | Font and size | Tailwind utility |
| --- | --- | --- |
| Message bodies, thread replies, editable text | Geist, 14px | `text-sm`; body copy uses `leading-6` |
| Names, compact controls, labels, timestamps, statuses, paths, IDs | Geist, 12px | `text-xs` |
| Headings | Geist, 16–24px | `text-base` through `text-2xl` |
| Code, diffs, commands, terminal output | Geist Mono, 12px | `font-mono text-xs` |

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

### Thread presentation (2026-09-12)

The main conversation shows one Thread entry per message, with only the latest
reply's author and a bounded two-line excerpt. Opening the Thread hides that
excerpt; full replies, timestamps and steering controls live in `MessageThread`.
Questions without replies retain one explicit collaboration entry, not a second
hover Reply action. Archived tasks keep these read-only navigation controls.
The timeline suppresses exact repeated empty question cards using their stable
request key, prompt, addressee and choices. Source records and IDs are unchanged;
copies with replies, answers or other evidence stay visible and are never merged.
Single-reply and whole-Thread steers return their stream/result to the original
discussion, including ordinary messages and code annotations, not only question
and review cards. `hiveReplyThreadId` is shared by run admission and the Demo;
immediate and queued starts use the same destination rule. Main-message work
still returns to the main conversation. Navigation never starts a run.

### Review navigation (2026-09-12)

Viewing changes from a review Thread keeps its identity and shows Back to review
above the workspace tabs. Direct Diff entry lists the reviews matching the current
workspace revision, with the shared review status and Open review links. Archived
tasks retain these read-only links and verification history. Older review Threads
retain their own return link and explicitly warn when the current diff no longer
matches. Diff, Files and Runs are evidence views, never approval
surfaces. Verify & resolve lives only in the original Thread, gated by the current
revision and reviewer. No global Approve changes button or action remains. Demo
uses these same components. Historical task approval records are not rewritten.

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

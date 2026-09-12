# Hive Collaboration

Hive gives a small software team one shared coding agent for one concrete task at a time. The conversation records human intent; the workspace records what the agent actually did.

## Language

**Team**:
The people collaborating through explicit task invitations. There is no global team-wide repository grant or multi-team administration surface.
_Avoid_: Room, tenant, workspace

**Member**:
A GitHub-authenticated person. Creating a task admits its creator; joining someone else's task requires an invitation.
_Avoid_: Persona, actor, user seat

**Task Session**:
A bounded collaboration around one intended outcome, with one shared conversation and at most one attached repository. In the interface, shorten this to “session” or “task.” Finishing a run or verifying a review does not close the task: members can continue discussing or steering without a manual Complete/Reopen step.
_Avoid_: Room, channel, project, long-lived workspace

**Repository Access**:
The intersection of the current person's GitHub access and the GitHub App's installed repository access. Joining a task does not inherit the inviter's repository pool.
_Avoid_: Connector, repository binding

**Archived Task**:
A task member can archive an idle task for the whole team. This is reversible,
not agent completion or deletion. Archived tasks move to the Archived list and
remain readable, including discussion and workspace evidence. All task writes,
steering, repository attachment and checkpoint restore are blocked until a member
restores the task. A running agent, queued instructions or workspace recovery must
finish first. Archive/restore never runs the agent or changes repository access.

**Attached Repository**:
The single repository selected from Repository Access for a task session. It may be attached after the conversation begins and cannot be replaced within that session.
_Avoid_: Project, default repository

**Thread**:
Discussion attached to one human or completed agent message. Replies retain their authors and do not direct the agent until explicitly steered, except for a structured answer requested by Hive. Hive can participate as itself. Existing message annotations are displayed as replies, not a separate comment system.
_Avoid_: New task session, agent history

**Code Annotation**:
A quoted file-and-line selection with a teammate's comment, shared as a discussion thread. It does not edit the file or wake the agent by itself.
_Avoid_: File save, prompt, agent response

**Message Edit**:
A correction by the original author. Pending message edits update the queued request without moving it. Already-dispatched edits update discussion and keep previous versions; they do not rewrite native agent history or rerun work. Frozen whole-thread steers stay frozen.
_Avoid_: Retry, conversation rewind, hidden steer

**Steer**:
One reply, an entire thread, or a teammate message explicitly promoted into agent direction. A whole-thread steer freezes the parent, replies through the selected boundary, and each author's identity. During a run, steers wait in an ordered queue for a safe boundary.
_Avoid_: Comment, hidden prompt

**Question**:
A structured request from Hive, optionally addressed to a task member. The first eligible answer is saved once and queued with its author. An idle task continues immediately; an answer queued during a run continues at the next safe boundary when a connected client observes it ready. If every client closes, it remains saved until reconnect. This is a new turn using saved native history, not a suspended tool callback or a durable background workflow. Interrupted runs and restored queues require manual continuation.

**Review Request**:
Hive asks for human feedback in a Thread. Verification opens only after actual workspace evidence is collected, and is bound to that completed run's revision and its designated reviewer, if any. Explicitly steered feedback returns its stream and result to the same Thread. New comments, another run, or a restore prevent stale verification. Viewing Diff, Files or Runs is navigation only; Back to review returns to the original Thread. Verify & resolve is the sole review confirmation, not a task approval or PR merge. There is no separate global Approve changes action.

**Run**:
One agent execution turn against the attached repository. A run that has not reported for six minutes can be marked lost by a member; the discussion, partial output and queued steers stay and nothing reruns. Resetting a task is separate and deliberate: it requires confirmation and an idle task, and it erases the shared conversation for everyone.
_Avoid_: Session, task

**Workspace**:
The task session’s real repository working copy and evidence of agent execution: a complete, on-demand file browser, diff, commands, and available sandbox checkpoints. File annotations quote what a teammate reviewed; they do not silently edit the repository.
_Avoid_: Team space, chat history

**Checkpoint**:
A saved sandbox filesystem paired with its native agent context and execution evidence. Restoring requires confirmation and an idle task, resets approval, and preserves the team conversation and pending queue without rerunning them. It does not undo GitHub commits or pull requests.
The restore records the original VM before changing it. If a response times out, metadata-only checks can confirm a new VM running the selected snapshot; matching snapshot IDs on the original VM are insufficient. Until confirmed, writes remain fenced. After the bounded worker lease, the UI checks briefly without replaying the restore, shows its waiting time, and offers an explicit same-checkpoint retry. Closing the dialog does not cancel recovery. Every completion is tied to its attempt, so a late worker cannot finish a newer retry.
_Avoid_: Conversation rewind, automatic retry

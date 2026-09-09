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
A bounded collaboration around one intended outcome, with one shared conversation and at most one attached repository. In the interface, shorten this to “session” or “task.”
_Avoid_: Room, channel, project, long-lived workspace

**Repository Access**:
The intersection of the current person's GitHub access and the GitHub App's installed repository access. Joining a task does not inherit the inviter's repository pool.
_Avoid_: Connector, repository binding

**Attached Repository**:
The single repository selected from Repository Access for a task session. It may be attached after the conversation begins and cannot be replaced within that session.
_Avoid_: Project, default repository

**Thread**:
Discussion attached to one human or completed agent message. Replies retain their authors and stay human-only until explicitly steered. Existing message annotations are displayed as replies, not a separate comment system.
_Avoid_: New task session, agent history

**Code Annotation**:
A quoted file-and-line selection with a teammate's comment, shared as a discussion thread. It does not edit the file or wake the agent by itself.
_Avoid_: File save, prompt, agent response

**Steer**:
One reply, an entire thread, or a teammate message explicitly promoted into agent direction. A whole-thread steer freezes the parent, replies through the selected boundary, and each author's identity. During a run, steers wait in an ordered queue for a safe boundary.
_Avoid_: Comment, hidden prompt

**Run**:
One agent execution turn against the attached repository.
_Avoid_: Session, task

**Workspace**:
The task session’s real repository working copy and evidence of agent execution: a complete, on-demand file browser, diff, commands, and available sandbox checkpoints. File annotations quote what a teammate reviewed; they do not silently edit the repository.
_Avoid_: Team space, chat history

**Checkpoint**:
A saved sandbox filesystem paired with its native agent context and execution evidence. Restoring requires confirmation and an idle task, resets approval, and preserves the team conversation and pending queue without rerunning them. It does not undo GitHub commits or pull requests.
_Avoid_: Conversation rewind, automatic retry

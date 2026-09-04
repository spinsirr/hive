# Hive Collaboration

Hive gives a small software team one shared coding agent for one concrete task at a time. The conversation records human intent; the workspace records what the agent actually did.

## Language

**Team**:
The long-lived group of people who share GitHub access and create task sessions.
_Avoid_: Room, tenant, workspace

**Member**:
A GitHub-authenticated person who belongs to the team and is explicitly admitted to a task session.
_Avoid_: Persona, actor, user seat

**Task Session**:
A bounded collaboration around one intended outcome, with one shared conversation and at most one attached repository. In the interface, shorten this to “session” or “task.”
_Avoid_: Room, channel, project, long-lived workspace

**Repository Access**:
The set of GitHub repositories authorized for the team through GitHub App installations.
_Avoid_: Connector, repository binding

**Attached Repository**:
The single repository selected from Repository Access for a task session. It may be attached after the conversation begins and cannot be replaced within that session.
_Avoid_: Project, default repository

**Annotation**:
A human comment attached to a teammate’s message that remains discussion until someone promotes it.
_Avoid_: Prompt, agent response

**Steer**:
An annotation or teammate message explicitly promoted into agent direction. During a run, steers wait in an ordered queue for a safe boundary.
_Avoid_: Comment, hidden prompt

**Run**:
One agent execution turn against the attached repository.
_Avoid_: Session, task

**Workspace**:
The task session’s evidence of agent execution: repository status, changed files, diff, and commands.
_Avoid_: Team space, chat history

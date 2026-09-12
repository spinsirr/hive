# Slack message and thread reference

Checked September 12, 2026. Scope: interaction guidance for Hive PR #5, based on official Slack documentation.

## Documented Slack behavior

- **Author boundary and save:** members can edit their own messages when workspace policy permits. Desktop editing starts from the message menu and finishes with **Save Changes**. [Edit or delete messages](https://slack.com/help/articles/202395258-Edit-or-delete-messages)
- **Keyboard entry:** when a message has focus, `E` edits a message you sent; `T` or Right Arrow opens/replies to its thread. Up Arrow in the message field edits your last message by default, with a preference to change that behavior. [Slack keyboard shortcuts](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)
- **Edited marker:** `chat.update` permits updates only to the authenticated author's messages, including a bot's own messages. Slack documents an `(edited)` label for human edits; bot messages do not show it, and updates using `blocks` have a display exception. These docs do not establish a user-visible full edit-history viewer. [chat.update](https://docs.slack.dev/reference/methods/chat.update.md)
- **Reply versus broadcast:** a reply belongs to a discussion around a specific message. Sending it back to the channel or DM's main view is a separate, explicit choice, available while composing or after sending. [Use threads to organize discussions](https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions)
- **Bot participation:** apps can post with a bot token and put replies in an existing thread using the parent message's `thread_ts`. `reply_broadcast` defaults to `false`; Slack recommends using broadcasts sparingly. [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postmessage.md)

## Hive recommendations for the current scope

These are Hive design decisions, not claims about Slack's agent execution model.

- Keep edits in the existing message UI, limited to the member's own ordinary messages, with explicit Save/Cancel and the existing Edited/history entry. Retain previous versions; history visibility is a Hive requirement, not a verified Slack feature.
- Saving an edit must not replay, retry, or restart an agent run. Previously dispatched agent history remains evidence. Pending plain-message edits may update their queued input under Hive's existing conflict rules.
- Keep thread replies in their discussion. Apply a whole thread to the agent only through the explicit steer action, with its saved discussion boundary; editing its parent must not silently change an already queued steer.
- Treat bot replies in Slack as a reference for attributed participation in a shared discussion, not evidence that Hive should add another execution channel or broadcast control.
- Use the same message actions, edit composer, history display, and thread controls in production and `/demo/conversation`. The demo's sample data can demonstrate interactions; production acceptance still requires the real interactions specified in `AGENTS.md`.

Existing implementation semantics and verification records: [Message actions](MESSAGE_EDITING.md).

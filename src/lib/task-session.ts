import {
  archiveTask,
  restoreTask,
  renameTask,
  setCodingEffort,
  selectHarness,
  recoverStalledRun,
  reset,
  connectRepository,
} from "./task-session-settings.ts";
import {
  editMessage,
  sendMessage,
  annotateCode,
  annotateMessage,
  resolvePeerReview,
} from "./task-session-conversation.ts";
import {
  answerQuestion,
  steerThread,
  steerMessageAnnotation,
  steerAgent,
  applyNextSteer,
  continuePeerResponse,
  removeQueuedSteer,
  reorderQueuedSteer,
} from "./task-session-steering.ts";

import {
  codingModelOptions,
  CODEX_GATEWAY_MODEL,
  type CodingModelOption,
} from "./coding-models.ts";
import {
  resolveMember,
  taskActionBlockReason,
  type TaskSessionState,
  type TaskSessionAction,
  type TeamMember,
} from "./task-session-state.ts";
export * from "./task-session-state.ts";

export function reduceTaskSession(
  state: TaskSessionState,
  action: TaskSessionAction,
  now = Date.now(),
  members: TeamMember[] = [],
  models: CodingModelOption[] = codingModelOptions(CODEX_GATEWAY_MODEL)
): TaskSessionState {
  const actor = resolveMember(action.actor, members);
  if (taskActionBlockReason(state, action)) return state;
  if (
    state.workspace.restore &&
    action.type !== "archive-task" &&
    action.type !== "restore-task"
  )
    return state;
  switch (action.type) {
    case "archive-task":
      return archiveTask(state, action, now, actor, members);
    case "restore-task":
      return restoreTask(state, action, now, actor, members);
    case "edit-message":
      return editMessage(state, action, now);
    case "rename-task":
      return renameTask(state, action, now, actor, members);
    case "set-coding-effort":
      return setCodingEffort(state, action, now, models);
    case "select-harness":
      return selectHarness(state, action, now, models);
    case "recover-stalled-run":
      return recoverStalledRun(state, action, now, actor);
    case "reset":
      return reset(state, action, now);
    case "connect-repository":
      return connectRepository(state, action, now, actor);
    case "send-message":
      return sendMessage(state, action, now, actor, members);
    case "annotate-code":
      return annotateCode(state, action, now, actor);
    case "annotate-message":
      return annotateMessage(state, action, now);
    case "answer-question":
      return answerQuestion(state, action, now, actor, members);
    case "resolve-peer-review":
      return resolvePeerReview(state, action, now, actor, members);
    case "steer-thread":
      return steerThread(state, action, now, actor, members);
    case "steer-message-annotation":
      return steerMessageAnnotation(state, action, now, actor, members);
    case "steer-agent":
      return steerAgent(state, action, now, actor, members);
    case "apply-next-steer":
      return applyNextSteer(state, action, now, members);
    case "continue-peer-response":
      return continuePeerResponse(state, action, now, members);
    case "remove-queued-steer":
      return removeQueuedSteer(state, action, now);
    case "reorder-queued-steer":
      return reorderQueuedSteer(state, action, now);
  }
  return state;
}

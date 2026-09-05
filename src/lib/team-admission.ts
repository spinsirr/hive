import { safeReturnTo } from "./return-to.ts";
import { isTaskSessionId } from "./task-session-id.ts";

export class TeamInviteRequiredError extends Error {
  constructor() {
    super("A team invitation is required to join Hive.");
    this.name = "TeamInviteRequiredError";
  }
}

type AdmissionChecks = {
  isTeamMember: (githubUserId: number) => Promise<boolean>;
  isAppOwner: (githubUserId: number) => Promise<boolean>;
  sessionExists: (sessionId: string) => Promise<boolean>;
  verifyInvite: (sessionId: string, token: string) => boolean;
};

function invitationFromReturnTo(returnTo: string) {
  const url = new URL(safeReturnTo(returnTo), "https://hive.invalid");
  const match = /^\/sessions\/([^/]+)$/.exec(url.pathname);
  const tokens = url.searchParams.getAll("invite");
  if (!match || !isTaskSessionId(match[1]) || tokens.length !== 1 || !tokens[0]) {
    return null;
  }
  return { sessionId: match[1], token: tokens[0] };
}

// GitHub identity is not team membership. In this single-team product, a user
// record is created only after this gate; subsequent sign-ins retain admission.
export async function requireTeamAdmission(
  githubUserId: number,
  returnTo: string,
  checks: AdmissionChecks,
) {
  if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0) {
    throw new TeamInviteRequiredError();
  }
  if (await checks.isTeamMember(githubUserId)) return;

  const invite = invitationFromReturnTo(returnTo);
  if (
    invite &&
    checks.verifyInvite(invite.sessionId, invite.token) &&
    (await checks.sessionExists(invite.sessionId))
  ) {
    return;
  }

  // The verified App owner can bootstrap the first member without an invite.
  // Installing the App on another account is deliberately not an admission path.
  if (await checks.isAppOwner(githubUserId)) return;
  throw new TeamInviteRequiredError();
}

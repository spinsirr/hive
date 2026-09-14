import type { TeamMember } from "../session/task-session.ts";

export type ActiveMention = { start: number; end: number; query: string };

export function activeTeammateMention(
  body: string,
  selectionStart: number,
  selectionEnd = selectionStart
): ActiveMention | null {
  if (
    selectionStart !== selectionEnd ||
    selectionStart < 0 ||
    selectionStart > body.length
  )
    return null;
  const match = body
    .slice(0, selectionStart)
    .match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u);
  if (!match) return null;
  const query = match[1];
  const suffix =
    body.slice(selectionStart).match(/^[\p{L}\p{N}_-]*/u)?.[0] ?? "";
  return {
    start: selectionStart - query.length - 1,
    end: selectionStart + suffix.length,
    query,
  };
}

export function teammateMentionHandle(member: TeamMember) {
  return member.githubLogin || member.id;
}

export function matchingTeammates(
  members: TeamMember[],
  currentMember: string,
  query: string
) {
  const search = query.toLocaleLowerCase();
  return members.filter(
    (member) =>
      member.id !== currentMember &&
      [member.name, member.shortName, teammateMentionHandle(member)].some(
        (value) => value.toLocaleLowerCase().includes(search)
      )
  );
}

export function insertTeammateMention(
  body: string,
  mention: ActiveMention,
  handle: string
) {
  const suffix = body.slice(mention.end);
  const existingSpace = /^\s/.test(suffix);
  const replacement = `@${handle}${existingSpace ? "" : " "}`;
  return {
    body: body.slice(0, mention.start) + replacement + suffix,
    caret: mention.start + replacement.length + (existingSpace ? 1 : 0),
  };
}

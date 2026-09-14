import assert from "node:assert/strict";
import test from "node:test";

import {
  isDirectedAtTeammate,
  type TeamMember,
} from "../session/task-session.ts";
import {
  activeTeammateMention,
  insertTeammateMention,
  matchingTeammates,
  teammateMentionHandle,
} from "./teammate-mention.ts";

const members: TeamMember[] = [
  {
    id: "github-1",
    name: "Spencer Zhao",
    shortName: "Spencer",
    initials: "SZ",
    githubLogin: "spinsirr",
  },
  {
    id: "github-2",
    name: "Joseph Martinez",
    shortName: "Joseph",
    initials: "JM",
    githubLogin: "josephmreb1",
  },
  {
    id: "github-3",
    name: "小王",
    shortName: "小王",
    initials: "王",
    githubLogin: "wang-dev",
  },
];

test("typing @ opens teammate suggestions at the caret, including in multiline drafts", () => {
  assert.deepEqual(activeTeammateMention("@", 1), {
    start: 0,
    end: 1,
    query: "",
  });
  assert.deepEqual(activeTeammateMention("Hi\n@jo", 6), {
    start: 3,
    end: 6,
    query: "jo",
  });
  assert.deepEqual(activeTeammateMention("请问 @小王", 6), {
    start: 3,
    end: 6,
    query: "小王",
  });
});

test("email addresses, completed mentions, and selected text do not open suggestions", () => {
  assert.equal(activeTeammateMention("me@example.com", 10), null);
  assert.equal(activeTeammateMention("@josephmreb1 hello", 17), null);
  assert.equal(activeTeammateMention("@jo", 0, 3), null);
  assert.equal(activeTeammateMention("@jo", 10), null);
});

test("suggestions use only session teammates and search names or GitHub handles", () => {
  assert.deepEqual(
    matchingTeammates(members, "github-1", "").map((member) => member.id),
    ["github-2", "github-3"]
  );
  assert.deepEqual(matchingTeammates(members, "github-1", "JOSEPH"), [
    members[1],
  ]);
  assert.deepEqual(matchingTeammates(members, "github-1", "wang-dev"), [
    members[2],
  ]);
  assert.deepEqual(matchingTeammates(members, "github-1", "小王"), [
    members[2],
  ]);
  assert.deepEqual(matchingTeammates(members, "github-1", "nobody"), []);
  assert.deepEqual(matchingTeammates([], "github-1", ""), []);
});

test("choosing a teammate replaces only the mention, preserving the rest of the draft", () => {
  assert.deepEqual(
    insertTeammateMention(
      "Can @jo review?",
      { start: 4, end: 7, query: "jo" },
      "josephmreb1"
    ),
    {
      body: "Can @josephmreb1 review?",
      caret: 17,
    }
  );
  assert.deepEqual(
    insertTeammateMention(
      "@jo",
      { start: 0, end: 3, query: "jo" },
      "josephmreb1"
    ),
    {
      body: "@josephmreb1 ",
      caret: 13,
    }
  );
});

test("editing inside a mention replaces the full handle without duplicating its suffix", () => {
  const mention = activeTeammateMention("@josephmreb1 review?", 3);
  assert.deepEqual(mention, { start: 0, end: 12, query: "jo" });
  assert.deepEqual(
    insertTeammateMention("@josephmreb1 review?", mention, "wang-dev"),
    {
      body: "@wang-dev review?",
      caret: 10,
    }
  );
});

test("the inserted leading handle is recognized as human discussion by the real message router", () => {
  const body = insertTeammateMention(
    "@jo",
    { start: 0, end: 3, query: "jo" },
    teammateMentionHandle(members[1])
  ).body;
  assert.equal(
    isDirectedAtTeammate(`${body}Can you review?`, "github-1", members),
    true
  );
  assert.equal(
    isDirectedAtTeammate(`Ask Hive to help ${body}`, "github-1", members),
    false
  );
});

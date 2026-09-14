import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionPresence,
  PRESENCE_EXPIRY_MS,
  PRESENCE_RENEW_MS,
  isPresenceAnnouncement,
  type LivePresence,
  type PresenceAnnouncement,
} from "./session-presence.ts";

function fixture() {
  const queue: PresenceAnnouncement[] = [];
  const frames: PresenceAnnouncement[] = [];
  const changes: Array<Array<{ sessionId: string; presence: LivePresence }>> = [
    [],
    [],
  ];
  const instances = changes.map(
    (events) =>
      new SessionPresence(
        (event) => {
          queue.push(event);
          frames.push(event);
        },
        (sessionId, presence) => events.push({ sessionId, presence })
      )
  );
  const flush = () => {
    while (queue.length) {
      const event = queue.shift()!;
      for (const instance of instances) instance.receive(event);
    }
  };
  return {
    instances,
    changes,
    frames,
    flush,
    dispose: () => instances.forEach((instance) => instance.dispose()),
  };
}

test("different instances agree on membership, deduplicate tabs, and retain another tab's typing", () => {
  const f = fixture();
  try {
    const first = f.instances[0].join("presence-qa", "github-101");
    f.flush();
    const second = f.instances[1].join("presence-qa", "github-102");
    f.flush();
    const anotherTab = f.instances[1].join("presence-qa", "github-101");
    f.flush();
    for (const changes of f.changes)
      assert.deepEqual(changes.at(-1)?.presence.activeMembers, [
        "github-101",
        "github-102",
      ]);
    first.setTyping(true);
    f.flush();
    anotherTab.setTyping(false);
    f.flush();
    for (const changes of f.changes)
      assert.deepEqual(changes.at(-1)?.presence.typingMembers, ["github-101"]);
    first.leave();
    f.flush();
    assert.deepEqual(f.changes[1].at(-1)?.presence, {
      activeMembers: ["github-101", "github-102"],
      typingMembers: [],
    });
    anotherTab.leave();
    f.flush();
    assert.deepEqual(f.changes[1].at(-1)?.presence.activeMembers, [
      "github-102",
    ]);
    second.leave();
    f.flush();
  } finally {
    f.dispose();
  }
});

test("tabs on the same instance count once and survive another tab closing", () => {
  const f = fixture();
  try {
    const first = f.instances[0].join("presence-qa", "github-101");
    const second = f.instances[0].join("presence-qa", "github-101");
    first.setTyping(true);
    second.setTyping(true);
    first.leave();
    assert.deepEqual(f.changes[0].at(-1)?.presence, {
      activeMembers: ["github-101"],
      typingMembers: ["github-101"],
    });
    second.leave();
    assert.deepEqual(f.changes[0].at(-1)?.presence, {
      activeMembers: [],
      typingMembers: [],
    });
  } finally {
    f.dispose();
  }
});

test("idle renewal is per instance/task, never per tab, and creates no viewer updates", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 1_000,
  });
  const f = fixture();
  try {
    f.instances[0].join("presence-qa", "github-101");
    f.instances[0].join("presence-qa", "github-101");
    f.instances[1].join("presence-qa", "github-102");
    f.flush();
    const before = f.changes.map((events) => events.length);
    f.frames.length = 0;
    t.mock.timers.tick(PRESENCE_RENEW_MS);
    f.flush();
    assert.equal(f.frames.length, 2);
    assert.deepEqual(
      f.changes.map((events) => events.length),
      before
    );
    assert.ok(
      f.frames.every((frame) => Buffer.byteLength(JSON.stringify(frame)) < 300)
    );
  } finally {
    f.dispose();
  }
});

test("a crashed instance expires without a table query or another user action", (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout", "setInterval", "Date"],
    now: 1_000,
  });
  const f = fixture();
  try {
    f.instances[0].join("presence-qa", "github-101");
    f.instances[1].join("presence-qa", "github-102");
    f.flush();
    f.instances[0].dispose(); // No graceful leave message.
    t.mock.timers.tick(PRESENCE_EXPIRY_MS);
    f.flush();
    assert.deepEqual(f.changes[1].at(-1)?.presence, {
      activeMembers: ["github-102"],
      typingMembers: [],
    });
  } finally {
    f.dispose();
  }
});

test("presence does not leak into another task and malformed notifications are rejected", () => {
  const f = fixture();
  try {
    f.instances[0].join("presence-one", "github-101");
    f.instances[1].join("presence-two", "github-102");
    f.flush();
    assert.deepEqual(f.changes[1].at(-1)?.presence.activeMembers, [
      "github-102",
    ]);
    assert.equal(isPresenceAnnouncement(f.frames[0]), true);
    assert.equal(
      isPresenceAnnouncement({
        ...f.frames[0],
        members: [["github-101", "yes"]],
      }),
      false
    );
    assert.equal(
      isPresenceAnnouncement({ kind: "presence", sessionId: "presence-one" }),
      false
    );
  } finally {
    f.dispose();
  }
});

test("a presence observer sees people across instances without counting itself", () => {
  const f = fixture();
  try {
    const person = f.instances[0].join("presence-qa", "github-101");
    const secondTab = f.instances[0].join("presence-qa", "github-101");
    f.flush();
    const observer = f.instances[1].join("presence-qa");
    f.flush();
    assert.deepEqual(f.changes[1].at(-1)?.presence.activeMembers, [
      "github-101",
    ]);
    assert.deepEqual(f.changes[0].at(-1)?.presence.activeMembers, [
      "github-101",
    ]);
    secondTab.leave();
    person.leave();
    f.flush();
    assert.deepEqual(f.changes[1].at(-1)?.presence.activeMembers, []);
    observer.leave();
  } finally {
    f.dispose();
  }
});

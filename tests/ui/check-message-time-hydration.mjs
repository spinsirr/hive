import { registerTestModules } from "../helpers/test-modules.mjs";
// Render a refreshed page and a client-created message through real React.
// No services, credentials, model or application-state writes.
import assert from "node:assert/strict";

import { createDomFixture } from "../helpers/test-dom.mjs";

registerTestModules();

const { act, createElement: h } = await import("react");
const { renderToString } = await import("react-dom/server");
const { MessageTime } =
  await import("../../src/components/hive/conversation/message-time.tsx");
const cases = [
  {
    serverZone: "UTC",
    viewerZone: "America/Los_Angeles",
    iso: "2026-09-10T05:01:00.000Z",
    expected: "10:01 PM",
  },
  {
    serverZone: "UTC",
    viewerZone: "Asia/Shanghai",
    iso: "2026-09-10T05:01:00.000Z",
    expected: "1:01 PM",
  },
  {
    serverZone: "America/Los_Angeles",
    viewerZone: "UTC",
    iso: "2026-09-10T05:01:00.000Z",
    expected: "5:01 AM",
  },
  {
    serverZone: "UTC",
    viewerZone: "America/Los_Angeles",
    iso: "2026-01-10T05:01:00.000Z",
    expected: "9:01 PM",
  },
];
const originalTimeZone = process.env.TZ;
for (const { serverZone, viewerZone, iso, expected } of cases) {
  let root, clientRoot, dom;
  try {
    const message = { createdAt: Date.parse(iso), time: "stored label" };
    process.env.TZ = serverZone;
    const markup = renderToString(h(MessageTime, { message }));
    dom = createDomFixture(
      `<div id="root">${markup}</div><div id="client"></div>`,
      {
        url: "https://hive.test",
        pretendToBeVisual: true,
      }
    );
    process.env.TZ = viewerZone;
    const container = document.getElementById("root");
    const serverTimeElement = container.querySelector("time");
    const clientContainer = document.getElementById("client");
    const { createRoot, hydrateRoot } = await import("react-dom/client");
    await act(async () => {
      clientRoot = createRoot(clientContainer);
      clientRoot.render(h(MessageTime, { message }));
    });
    assert.equal(
      clientContainer.textContent,
      expected,
      "client-created messages must show the supplied epoch in the viewer's zone"
    );
    const hydrationErrors = [];
    await act(async () => {
      root = hydrateRoot(container, h(MessageTime, { message }), {
        onRecoverableError: (error) => hydrationErrors.push(error),
      });
    });
    assert.equal(
      container.textContent,
      expected,
      "After refresh/hydration, a timestamped message must show the viewer's local time, not retained server UTC."
    );
    assert.deepEqual(
      hydrationErrors,
      [],
      "local times must not require React to discard mismatched server HTML"
    );
    assert.equal(
      container.querySelector("time"),
      serverTimeElement,
      "hydration must preserve the server-rendered time element"
    );
    assert.equal(container.querySelector("time").getAttribute("datetime"), iso);
    await act(async () => {
      root.render(h(MessageTime, { message: { time: "historical label" } }));
    });
    assert.equal(
      container.textContent,
      "historical label",
      "legacy messages must retain their stored label without a guessed zone"
    );
    assert.equal(
      container.querySelector("time").getAttribute("datetime"),
      null
    );
    await act(async () => {
      root.render(h(MessageTime, { message }));
    });
    assert.equal(
      container.textContent,
      expected,
      "prop updates must restore the current message's local time"
    );
    console.log(
      `PASS: ${serverZone} → ${viewerZone} (${iso}), fresh and client-created times agree; legacy labels and updates are preserved.`
    );
  } finally {
    if (root) await act(async () => root.unmount());
    if (clientRoot) await act(async () => clientRoot.unmount());
    dom?.close();
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
}

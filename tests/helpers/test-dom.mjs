import { JSDOM } from "jsdom";

const browserGlobals = [
  "window",
  "self",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "Element",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "Node",
  "DocumentFragment",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
  "FormData",
];

/** Install before importing Testing Library; close after its cleanup. */
export function createDomFixture(html, options) {
  const dom = new JSDOM(html, options);
  const previous = new Map();
  for (const name of [...browserGlobals, "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value:
        name === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : name === "window"
            ? dom.window
            : dom.window[name],
    });
  }
  return {
    window: dom.window,
    close() {
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

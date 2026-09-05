"use client";

import { cjk } from "@streamdown/cjk";
import { createCodePlugin, type ThemeInput } from "@streamdown/code";

import { MessageResponse } from "@/components/ai-elements/message";

const codeTheme: ThemeInput = {
  name: "hive",
  type: "light",
  colors: { "editor.background": "#ffffff", "editor.foreground": "#292929" },
  tokenColors: [
    { scope: ["comment"], settings: { foreground: "#858585", fontStyle: "italic" } },
    { scope: ["keyword", "storage"], settings: { foreground: "#171717", fontStyle: "bold" } },
    { scope: ["string", "constant.numeric"], settings: { foreground: "#626262" } },
    { scope: ["entity.name.type", "support.type"], settings: { foreground: "#404040" } },
    { scope: ["punctuation"], settings: { foreground: "#858585" } },
  ],
};

const plugins = { cjk, code: createCodePlugin({ themes: [codeTheme, codeTheme] }) };
const controls = { code: { copy: true, download: false }, table: false };

export function AgentResponse({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return (
    <MessageResponse
      className="hive-response min-w-0 space-y-3 text-[13px] leading-6 [overflow-wrap:anywhere] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_li]:my-0.5 [&_ol]:my-2 [&_p]:leading-6 [&_pre]:text-xs [&_ul]:my-2"
      controls={controls}
      isAnimating={streaming}
      mode={streaming ? "streaming" : "static"}
      caret="block"
      plugins={plugins}
      skipHtml
    >
      {children}
    </MessageResponse>
  );
}

"use client";

import Editor, { loader, type BeforeMount } from "@monaco-editor/react";
import { useEffect, useState } from "react";

loader.config({ paths: { vs: "/monaco/vs" } });

const configureEditor: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("hive", {
    base: "vs",
    inherit: false,
    rules: [
      { token: "", foreground: "292929" },
      { token: "comment", foreground: "858585", fontStyle: "italic" },
      { token: "keyword", foreground: "171717", fontStyle: "bold" },
      { token: "string", foreground: "626262" },
      { token: "number", foreground: "626262" },
      { token: "type", foreground: "404040" },
      { token: "delimiter", foreground: "858585" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#292929",
      "editorLineNumber.foreground": "#a1a1a1",
      "editorLineNumber.activeForeground": "#525252",
      "editor.selectionBackground": "#e5e5e5",
      "editor.inactiveSelectionBackground": "#f0f0f0",
      "editor.lineHighlightBackground": "#fafafa",
      "editorIndentGuide.background1": "#eeeeee",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e5e5e5",
      "focusBorder": "#737373",
    },
  });
};

export default function CodeViewer({ path, content }: { path: string; content: string }) {
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    loader.init().catch(() => {
      if (mounted) setLoadFailed(true);
    });
    return () => { mounted = false; };
  }, []);

  if (loadFailed) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-[#737373]" role="alert">
        <div>
          <p>The code viewer couldn’t load.</p>
          <button className="mt-2 underline underline-offset-4" onClick={() => window.location.reload()} type="button">
            Reload page
          </button>
        </div>
      </div>
    );
  }

  return (
    <Editor
      beforeMount={configureEditor}
      height="100%"
      loading={<span className="text-xs text-[#737373]" role="status">Loading code viewer…</span>}
      options={{
        ariaLabel: `Read-only code: ${path}`,
        automaticLayout: true,
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 12,
        lineHeight: 21,
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        renderValidationDecorations: "off",
        contextmenu: false,
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        bracketPairColorization: { enabled: false },
        links: false,
        stickyScroll: { enabled: false },
      }}
      path={`file:///${path.split("/").map(encodeURIComponent).join("/")}`}
      theme="hive"
      value={content}
    />
  );
}

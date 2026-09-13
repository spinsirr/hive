export type WorkspaceFileType =
  | "typescript"
  | "javascript"
  | "react"
  | "json"
  | "markdown"
  | "stylesheet"
  | "config"
  | "package"
  | "shell"
  | "image"
  | "archive"
  | "database"
  | "code"
  | "file";

const extensionTypes: Readonly<Record<string, WorkspaceFileType>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  tsx: "react",
  jsx: "react",
  json: "json",
  jsonc: "json",
  jsonl: "json",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  css: "stylesheet",
  scss: "stylesheet",
  sass: "stylesheet",
  less: "stylesheet",
  yaml: "config",
  yml: "config",
  toml: "config",
  ini: "config",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "shell",
  svg: "image",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  ico: "image",
  zip: "archive",
  gz: "archive",
  tar: "archive",
  tgz: "archive",
  br: "archive",
  "7z": "archive",
  sql: "database",
  sqlite: "database",
  db: "database",
  html: "code",
  xml: "code",
  vue: "code",
  svelte: "code",
  py: "code",
  go: "code",
  rs: "code",
  java: "code",
  rb: "code",
  php: "code",
};

const packageFiles = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const configFiles = new Set([
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".prettierrc",
  ".prettierignore",
  ".eslintrc",
  "dockerfile",
  ".dockerignore",
]);

// Classify the basename only. A folder named `assets.ts` must not turn an
// unknown file inside it into a TypeScript file. This is display metadata,
// never a decision about whether the file may be read or executed.
export function workspaceFileType(path: string): WorkspaceFileType {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (packageFiles.has(name)) return "package";
  if (
    configFiles.has(name) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /\.config\.(?:[cm]?[jt]s|json)$/.test(name) ||
    /^tsconfig(?:\..+)?\.json$/.test(name) ||
    /^jsconfig\.json$/.test(name) ||
    /^\.(?:prettierrc|eslintrc)\./.test(name)
  )
    return "config";
  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1)
    : "";
  return Object.hasOwn(extensionTypes, extension)
    ? extensionTypes[extension]
    : "file";
}

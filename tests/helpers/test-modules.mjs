import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { JsxEmit, ModuleKind, transpileModule } from "typescript";

const sourceRoot = new URL("../../src/", import.meta.url);
const nextEntries = new Set([
  "next/server",
  "next/headers",
  "next/navigation",
  "next/link",
  "next/dynamic",
  "next/image",
]);

function resolve(specifier, context, next) {
  if (specifier === "server-only")
    return next("next/dist/compiled/server-only/empty.js", context);
  if (nextEntries.has(specifier)) return next(`${specifier}.js`, context);
  const base = specifier.startsWith("@/")
    ? new URL(specifier.slice(2), sourceRoot)
    : specifier.startsWith(".") &&
        context.parentURL?.startsWith(sourceRoot.href)
      ? new URL(specifier, context.parentURL)
      : undefined;
  if (!base) return next(specifier, context);
  const target = [".ts", ".tsx", "/index.ts", "/index.tsx", ""]
    .map((suffix) => new URL(base.href + suffix))
    .find(existsSync);
  return next(target?.href ?? specifier, context);
}

function load(url, context, next) {
  if (!url.endsWith(".tsx")) return next(url, context);
  return {
    format: "module",
    shortCircuit: true,
    source: transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext },
    }).outputText,
  };
}

/** Call before importing application modules. Fixture-specific mocks run first. */
export function registerTestModules(overrides = {}) {
  return registerHooks({
    resolve: (specifier, context, next) =>
      overrides.resolve
        ? overrides.resolve(specifier, context, (value, ctx) =>
            resolve(value, ctx, next)
          )
        : resolve(specifier, context, next),
    load: (url, context, next) =>
      overrides.load
        ? overrides.load(url, context, (value, ctx) => load(value, ctx, next))
        : load(url, context, next),
  });
}

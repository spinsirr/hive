import { cp, copyFile, mkdir } from "node:fs/promises";

// Serve the editor and workers from Hive, without a third-party runtime CDN.
const root = new URL("../", import.meta.url);
const source = new URL("node_modules/monaco-editor/", root);
const destination = new URL("public/monaco/", root);

await mkdir(destination, { recursive: true });
await cp(new URL("min/vs/", source), new URL("vs/", destination), {
  recursive: true,
});
await copyFile(new URL("LICENSE", source), new URL("LICENSE", destination));
await copyFile(new URL("ThirdPartyNotices.txt", source), new URL("ThirdPartyNotices.txt", destination));

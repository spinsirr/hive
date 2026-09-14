import path from "node:path";
import type { Experimental_SandboxSession } from "ai";
import type {
  WorkspaceCommand,
  WorkspaceFile,
} from "../../lib/session/task-session.ts";

const MAX_DIFF_CHARS = 60_000;
const MAX_FILE_CHARS = 20_000;
const MAX_FILE_PREVIEWS = 12;

function preview(text: string, limit: number) {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n\n[output truncated by Hive]`;
}

/** Git's machine output stays intact until each artifact applies its own budget. */
export async function collectArtifacts(
  sandbox: Pick<Experimental_SandboxSession, "run" | "readTextFile">,
  commands: WorkspaceCommand[],
  workingDirectory: string,
  abortSignal = AbortSignal.timeout(120_000)
) {
  const run = async (command: string) => {
    const result = await sandbox.run({
      command,
      workingDirectory,
      abortSignal,
    });
    if (result.exitCode !== 0)
      throw new Error("Could not capture repository changes.");
    return result.stdout;
  };
  const [names, deletedNames, rawDiff] = await Promise.all([
    run(
      "git diff --name-only -z HEAD && git ls-files -z --others --exclude-standard"
    ),
    run("git diff --name-only -z --diff-filter=D HEAD"),
    run(
      `git diff --no-ext-diff --no-textconv HEAD && while IFS= read -r -d '' file; do git diff --no-ext-diff --no-textconv --no-index -- /dev/null "$file"; status=$?; if [ "$status" -gt 1 ]; then exit "$status"; fi; done < <(git ls-files -z --others --exclude-standard)`
    ),
  ]);
  const changedFiles = [...new Set(names.split("\0").filter(Boolean))];
  const deleted = new Set(deletedNames.split("\0"));
  const previews = await Promise.all(
    changedFiles
      .filter((name) => !deleted.has(name))
      .slice(0, MAX_FILE_PREVIEWS)
      .map(async (name) => {
        const content = await sandbox.readTextFile({
          path: path.posix.join(workingDirectory, name),
          abortSignal,
        });
        return content == null
          ? null
          : { path: name, content: preview(content, MAX_FILE_CHARS) };
      })
  );
  return {
    changedFiles,
    files: previews.filter((file): file is WorkspaceFile => file !== null),
    diff: preview(rawDiff, MAX_DIFF_CHARS),
    commands,
  };
}

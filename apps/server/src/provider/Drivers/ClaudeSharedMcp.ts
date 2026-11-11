import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  type ClaudeHomeConfig,
  resolveClaudeConfigDirPath,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const objectAt = (parent: JsonObject | undefined, key: string): JsonObject | undefined => {
  const value = parent?.[key];
  return isObject(value) ? value : undefined;
};

const ensureObject = (parent: JsonObject, key: string): JsonObject => {
  const existing = objectAt(parent, key);
  if (existing !== undefined) return existing;
  const created: JsonObject = {};
  parent[key] = created;
  return created;
};

const parseObject = (contents: string): JsonObject | undefined => {
  try {
    const parsed: unknown = JSON.parse(contents);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Moves every MCP server out of `shadow` into `shared`, user-level and per-project.
 * A name `shared` already defines keeps the shared definition. Returns whether each changed.
 */
function promoteClaudeMcpServers(
  shared: JsonObject,
  shadow: JsonObject,
): { readonly sharedChanged: boolean; readonly shadowChanged: boolean } {
  let sharedChanged = false;
  let shadowChanged = false;
  const move = (from: JsonObject, to: () => JsonObject) => {
    const servers = objectAt(from, "mcpServers");
    if (servers === undefined) return;
    for (const [name, server] of Object.entries(servers)) {
      const targetServers = ensureObject(to(), "mcpServers");
      if (!(name in targetServers)) {
        targetServers[name] = server;
        sharedChanged = true;
      }
      delete servers[name];
      shadowChanged = true;
    }
  };
  move(shadow, () => shared);
  for (const [projectPath, project] of Object.entries(objectAt(shadow, "projects") ?? {})) {
    if (!isObject(project)) continue;
    move(project, () => ensureObject(ensureObject(shared, "projects"), projectPath));
  }
  return { sharedChanged, shadowChanged };
}

const projectKey = (directory: string, platform: NodeJS.Platform): string => {
  const normalized = directory.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
};

/** The shared config's user-level servers plus those of any project in `projectDirectories`. */
function selectClaudeMcpServers(
  shared: JsonObject,
  projectDirectories: ReadonlyArray<string>,
  platform: NodeJS.Platform,
): JsonObject {
  const wanted = new Set(projectDirectories.map((directory) => projectKey(directory, platform)));
  const selected: JsonObject = { ...objectAt(shared, "mcpServers") };
  for (const [projectPath, project] of Object.entries(objectAt(shared, "projects") ?? {})) {
    if (!isObject(project) || !wanted.has(projectKey(projectPath, platform))) continue;
    Object.assign(selected, objectAt(project, "mcpServers"));
  }
  for (const [name, server] of Object.entries(selected)) {
    if (!isObject(server)) delete selected[name];
  }
  return selected;
}

// Claude keys a project's local MCP servers by its repository root, or the main checkout's for a worktree.
const projectDirectoriesFor = Effect.fnUntraced(function* (cwd: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directories = [cwd];
  for (let directory = cwd; ; directory = path.dirname(directory)) {
    const gitPath = path.join(directory, ".git");
    if (yield* fileSystem.exists(gitPath).pipe(Effect.orElseSucceed(() => false))) {
      directories.push(directory);
      const pointer = yield* fileSystem
        .readFileString(gitPath)
        .pipe(Effect.orElseSucceed(() => ""));
      const mainRoot = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m.exec(pointer)?.[1];
      if (mainRoot !== undefined) directories.push(path.resolve(directory, mainRoot));
      break;
    }
    if (path.dirname(directory) === directory) break;
  }
  return directories;
});

let temporaryFileCounter = 0;

/**
 * For a shadow home: moves MCP servers the CLI saved in the shadow's `.claude.json` into the
 * shared home's, then returns the shared servers that apply to `cwd` for the session to register.
 * Never fails; a config it cannot read or write is left as it is.
 */
export const syncClaudeShadowMcpServers = Effect.fn("syncClaudeShadowMcpServers")(function* (
  config: ClaudeHomeConfig,
  environment: NodeJS.ProcessEnv | undefined,
  cwd: string | undefined,
): Effect.fn.Return<JsonObject, never, FileSystem.FileSystem | Path.Path> {
  if ((config.shadowHomePath?.trim() ?? "").length === 0) return {};
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const userHome = yield* HostProcess.HomeDirectory;
  // Without CLAUDE_CONFIG_DIR the CLI keeps .claude.json beside ~/.claude, not inside it.
  const sharedIsDefault =
    config.homePath.trim().length === 0 && (environment?.CLAUDE_CONFIG_DIR?.trim() ?? "") === "";
  const sharedPath = path.join(
    sharedIsDefault ? userHome : yield* resolveClaudeHomePath(config, environment),
    ".claude.json",
  );
  const shadowPath = path.join(
    yield* resolveClaudeConfigDirPath(config, environment),
    ".claude.json",
  );
  if (sharedPath === shadowPath) return {};

  const read = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.map(parseObject),
      Effect.orElseSucceed(() => undefined),
    );
  const write = (filePath: string, value: JsonObject) => {
    const temporaryPath = `${filePath}.t3-mcp-${process.pid}-${temporaryFileCounter++}.tmp`;
    return fileSystem.writeFileString(temporaryPath, JSON.stringify(value, null, 2)).pipe(
      Effect.andThen(fileSystem.rename(temporaryPath, filePath)),
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.logWarning("claude-shared-mcp.write-failed", { filePath, cause }).pipe(
          Effect.andThen(fileSystem.remove(temporaryPath).pipe(Effect.ignore)),
          Effect.as(false),
        ),
      ),
    );
  };

  const sharedExists = yield* fileSystem.exists(sharedPath).pipe(Effect.orElseSucceed(() => false));
  const shared = sharedExists ? yield* read(sharedPath) : {};
  const shadow = yield* read(shadowPath);
  if (shared === undefined) return {};
  if (shadow !== undefined) {
    const { sharedChanged, shadowChanged } = promoteClaudeMcpServers(shared, shadow);
    // Shared first: a failed write then leaves the server where it was instead of losing it.
    const sharedSaved = !sharedChanged || (yield* write(sharedPath, shared));
    if (sharedSaved && shadowChanged) yield* write(shadowPath, shadow);
  }
  return selectClaudeMcpServers(
    shared,
    cwd === undefined ? [] : yield* projectDirectoriesFor(cwd),
    platform,
  );
});

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";

const quotePath = Schema.encodeSync(Schema.fromJsonString(Schema.String));

/**
 * Config accepted by the home helpers. `shadowHomePath` is optional so callers
 * that only know the shared home keep working unchanged.
 */
export type ClaudeHomeConfig = Pick<ClaudeSettings, "homePath"> &
  Partial<Pick<ClaudeSettings, "shadowHomePath">>;

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const homePath = config.homePath.trim();
  if (homePath.length > 0) {
    return path.resolve(expandHomePath(homePath, home));
  }
  // Inherited env vars are not shell-expanded, so a literal `~` stays literal.
  const inherited = environment?.CLAUDE_CONFIG_DIR?.trim() ?? "";
  if (inherited.length > 0) {
    return path.resolve(inherited);
  }
  return path.resolve(path.join(home, ".claude"));
});

/**
 * The config dir the spawned CLI actually sees. A shadow home layers an
 * account-specific config dir (private credentials and .claude.json) over the
 * shared home; continuation identity stays keyed on the shared home so
 * instances that share session state remain continuation-compatible (Codex
 * shadow-home parity). The shadow dir is expected to link its shared state
 * (projects, skills, plugins, settings) back to the shared home.
 */
export const resolveClaudeConfigDirPath = Effect.fn("resolveClaudeConfigDirPath")(function* (
  config: ClaudeHomeConfig,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const shadowHomePath = config.shadowHomePath?.trim() ?? "";
  if (shadowHomePath.length > 0) {
    const home = yield* HostProcess.HomeDirectory;
    return path.resolve(expandHomePath(shadowHomePath, home));
  }
  return yield* resolveClaudeHomePath(config, environment);
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: ClaudeHomeConfig,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  const shadowHomePath = config.shadowHomePath?.trim() ?? "";
  if (homePath.length === 0 && shadowHomePath.length === 0) return resolvedBaseEnv;
  const resolvedConfigDir = yield* resolveClaudeConfigDirPath(config);
  return {
    ...resolvedBaseEnv,
    // Overriding HOME also relocates the macOS login keychain lookup
    // ($HOME/Library/Keychains), so the spawned CLI can't find its stored
    // OAuth credentials and reports "Not logged in". CLAUDE_CONFIG_DIR points
    // Claude Code at its config dir directly while leaving HOME (and the
    // keychain) intact.
    CLAUDE_CONFIG_DIR: resolvedConfigDir,
  };
});

/**
 * While it exists Claude refuses `--strict-mcp-config` and exits before
 * initializing, but it already ignores user, project and `--mcp-config` servers
 * on its own, so callers that pass the flag for isolation can drop it. Paths
 * match the ones Claude Code checks.
 */
export const hasClaudeManagedMcpConfig = Effect.fn("hasClaudeManagedMcpConfig")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const managedMcpConfigPath =
    platform === "darwin"
      ? "/Library/Application Support/ClaudeCode/managed-mcp.json"
      : platform === "win32"
        ? "C:\\Program Files\\ClaudeCode\\managed-mcp.json"
        : "/etc/claude-code/managed-mcp.json";
  return yield* fileSystem.exists(managedMcpConfigPath).pipe(Effect.orElseSucceed(() => false));
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (
    // Accepts (and deliberately ignores) a shadow home: continuation identity
    // follows the shared home so shadow instances stay compatible.
    config: ClaudeHomeConfig,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config, environment);
    return `claude:home:${resolvedHomePath}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath"> & ClaudeHomeConfig,
    cwd?: string,
    environment?: NodeJS.ProcessEnv,
  ): Effect.fn.Return<string, never, Path.Path> {
    // Keyed on the effective config dir (shadow-aware) so account-specific
    // probes never share auth metadata across instances of one continuation
    // group.
    const resolvedConfigDir = yield* resolveClaudeConfigDirPath(config, environment);
    return `${config.binaryPath}\0${resolvedConfigDir}\0${cwd ?? ""}`;
  },
);

/**
 * Describe the spawned CLI's environment separately from the login command so
 * paths remain literal on every shell, including relative inherited values.
 */
export const claudeSignedOutMessage = (input: {
  readonly configDir: string | undefined;
  readonly cwd: string;
}): string => {
  const configuration =
    input.configDir !== undefined
      ? ` from ${quotePath(input.cwd)}, with CLAUDE_CONFIG_DIR set to ${quotePath(input.configDir)}`
      : "";
  return `Claude could not authenticate. For subscription login, run \`claude auth login\` on this environment's machine${configuration}, then start a new thread. For API-key authentication, check this instance's configured credentials.`;
};

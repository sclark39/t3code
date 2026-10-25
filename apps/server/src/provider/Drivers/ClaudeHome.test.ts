import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  mergeClaudeProcessEnvironment,
  resolveClaudeConfigDirPath,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("resolves configured Claude HOME and stamps continuation/cache keys with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect("uses inherited CLAUDE_CONFIG_DIR when homePath is empty", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const inherited = path.resolve("/tmp/claude-inherited");
        const environment = { CLAUDE_CONFIG_DIR: inherited };

        expect(yield* resolveClaudeHomePath({ homePath: "" }, environment)).toBe(inherited);
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" }, environment)).toBe(
          `claude:home:${inherited}`,
        );

        const explicit = path.resolve(NodeOS.homedir(), ".claude-work");
        expect(yield* resolveClaudeHomePath({ homePath: "~/.claude-work" }, environment)).toBe(
          explicit,
        );
      }),
    );

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );
  });

  it.effect(
    "drops the launching Claude session and Electron's run-as-Node flag, and labels processes t3-code unless overridden",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const homePath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-home-" });
        const host = {
          CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
          CLAUDECODE: "1",
          CLAUDE_CODE_SESSION_ID: "host-session",
          CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/host-claude.sock",
          CLAUDE_EFFORT: "high",
          ELECTRON_RUN_AS_NODE: "1",
          KEEP: "1",
        };
        const instance = [
          { name: "CLAUDE_CODE_ENTRYPOINT", value: "instance", sensitive: false },
          { name: "CLAUDE_EFFORT", value: "low", sensitive: false },
        ];

        expect(yield* mergeClaudeProcessEnvironment({ homePath }, undefined, host)).toEqual({
          CLAUDE_CODE_ENTRYPOINT: "t3-code",
          KEEP: "1",
        });
        expect(yield* mergeClaudeProcessEnvironment({ homePath }, instance, host)).toEqual({
          CLAUDE_CODE_ENTRYPOINT: "instance",
          CLAUDE_EFFORT: "low",
          KEEP: "1",
        });

        yield* fileSystem.writeFileString(
          path.join(homePath, "settings.json"),
          JSON.stringify({ env: { CLAUDE_CODE_ENTRYPOINT: "custom" } }),
        );
        expect(
          (yield* mergeClaudeProcessEnvironment({ homePath }, instance, host))
            .CLAUDE_CODE_ENTRYPOINT,
        ).toBe("custom");
      }),
  );

  describe("Claude shadow home", () => {
    it.effect("points the CLI at the shadow config dir while keying continuation on HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude";
        const shadowHomePath = "~/.claude-t3/personal";
        const resolvedHome = path.resolve(NodeOS.homedir(), ".claude");
        const resolvedShadow = path.resolve(NodeOS.homedir(), ".claude-t3", "personal");

        expect(yield* resolveClaudeConfigDirPath({ homePath, shadowHomePath })).toBe(
          resolvedShadow,
        );
        expect((yield* makeClaudeEnvironment({ homePath, shadowHomePath })).CLAUDE_CONFIG_DIR).toBe(
          resolvedShadow,
        );
        expect(yield* makeClaudeContinuationGroupKey({ homePath, shadowHomePath })).toBe(
          `claude:home:${resolvedHome}`,
        );
      }),
    );

    it.effect("sets CLAUDE_CONFIG_DIR from the shadow home even without a HOME override", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const shadowHomePath = "~/.claude-t3/personal";
        const resolvedShadow = path.resolve(NodeOS.homedir(), ".claude-t3", "personal");

        expect(
          (yield* makeClaudeEnvironment({ homePath: "", shadowHomePath })).CLAUDE_CONFIG_DIR,
        ).toBe(resolvedShadow);
      }),
    );

    it.effect("shadow home wins over an inherited CLAUDE_CONFIG_DIR", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const inherited = path.resolve("/tmp/claude-inherited");
        const environment = { CLAUDE_CONFIG_DIR: inherited };
        const shadowHomePath = "~/.claude-t3/personal";
        const resolvedShadow = path.resolve(NodeOS.homedir(), ".claude-t3", "personal");

        expect(
          yield* resolveClaudeConfigDirPath({ homePath: "", shadowHomePath }, environment),
        ).toBe(resolvedShadow);
        // Continuation still follows the shared home, which here is inherited.
        expect(
          yield* makeClaudeContinuationGroupKey({ homePath: "", shadowHomePath }, environment),
        ).toBe(`claude:home:${inherited}`);
      }),
    );

    it.effect(
      "keeps continuation compatible while separating capability probes across shadow homes",
      () =>
        Effect.gen(function* () {
          const homePath = "~/.claude";
          const first = { binaryPath: "claude", homePath, shadowHomePath: "~/.claude-t3/work" };
          const second = {
            binaryPath: "claude",
            homePath,
            shadowHomePath: "~/.claude-t3/personal",
          };

          expect(yield* makeClaudeContinuationGroupKey(first)).toBe(
            yield* makeClaudeContinuationGroupKey(second),
          );
          expect(yield* makeClaudeCapabilitiesCacheKey(first)).not.toBe(
            yield* makeClaudeCapabilitiesCacheKey(second),
          );
        }),
    );
  });
});

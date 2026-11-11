import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { syncClaudeShadowMcpServers } from "./ClaudeSharedMcp.ts";

it.layer(NodeServices.layer)("ClaudeSharedMcp", (it) => {
  it.effect("moves shadow MCP servers into the shared home and returns the ones for the cwd", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-claude-mcp-" });
      const homePath = path.join(root, "home");
      const shadowHomePath = path.join(root, "shadow");
      const repo = path.join(root, "repo");
      const otherRepo = path.join(root, "other");
      const cwd = path.join(repo, "packages", "app");
      for (const directory of [homePath, shadowHomePath, cwd, path.join(repo, ".git")]) {
        yield* fileSystem.makeDirectory(directory, { recursive: true });
      }
      const sharedFile = path.join(homePath, ".claude.json");
      const shadowFile = path.join(shadowHomePath, ".claude.json");
      const readJson = (file: string) =>
        fileSystem.readFileString(file).pipe(Effect.map((text) => JSON.parse(text)));
      yield* fileSystem.writeFileString(
        sharedFile,
        JSON.stringify({
          numStartups: 3,
          mcpServers: { both: { command: "shared" } },
          projects: { [otherRepo]: { mcpServers: { elsewhere: { command: "x" } } } },
        }),
      );
      yield* fileSystem.writeFileString(
        shadowFile,
        JSON.stringify({
          oauthAccount: { emailAddress: "a@example.com" },
          mcpServers: { both: { command: "shadow" }, added: { type: "http", url: "http://a" } },
          projects: { [repo]: { allowedTools: [], mcpServers: { local: { command: "l" } } } },
        }),
      );

      const config = { homePath, shadowHomePath };
      expect(yield* syncClaudeShadowMcpServers(config, undefined, cwd)).toEqual({
        both: { command: "shared" },
        added: { type: "http", url: "http://a" },
        local: { command: "l" },
      });
      expect(yield* readJson(shadowFile)).toEqual({
        oauthAccount: { emailAddress: "a@example.com" },
        mcpServers: {},
        projects: { [repo]: { allowedTools: [], mcpServers: {} } },
      });
      expect(yield* readJson(sharedFile)).toEqual({
        numStartups: 3,
        mcpServers: { both: { command: "shared" }, added: { type: "http", url: "http://a" } },
        projects: {
          [otherRepo]: { mcpServers: { elsewhere: { command: "x" } } },
          [repo]: { mcpServers: { local: { command: "l" } } },
        },
      });

      // Nothing left to move: the shared file is read, not rewritten.
      const before = yield* fileSystem.stat(sharedFile);
      expect(Object.keys(yield* syncClaudeShadowMcpServers(config, undefined, otherRepo))).toEqual([
        "both",
        "added",
        "elsewhere",
      ]);
      expect((yield* fileSystem.stat(sharedFile)).mtime).toEqual(before.mtime);
      expect(yield* syncClaudeShadowMcpServers({ homePath }, undefined, cwd)).toEqual({});
    }),
  );
});

import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import { AuthTerminalOperateScope, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { randomUUID } from "../../lib/utils";
import { resolveOnboardingProviderLoginCommand } from "../../onboarding/providerReadiness.logic";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const SIGN_IN_THREAD_ID = ThreadId.make("settings-provider-sign-in");

export function providerSupportsSignInTerminal(driver: ServerProvider["driver"]): boolean {
  return driver === "claudeAgent" || driver === "codex";
}

/**
 * Sign-in section for an existing provider instance. The terminal is opened
 * with the instance's id, so the server exports that instance's config dir
 * (CLAUDE_CONFIG_DIR / CODEX_HOME, shadow home included) and the login
 * lands in this account rather than the default one.
 */
export function ProviderSignInSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider;
  readonly displayName: string;
  readonly readOnly: boolean;
}) {
  const { environmentId, instanceId, provider, displayName, readOnly } = props;
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const [open, setOpen] = useState(false);
  const authenticated = provider.auth.status === "authenticated";
  const email = provider.auth.email?.trim();
  const configDirVariable = provider.driver === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
  const command =
    serverConfig === null
      ? null
      : resolveOnboardingProviderLoginCommand(
          provider,
          serverConfig.settings,
          serverConfig.environment.platform.os,
        );
  const unavailable = serverConfig === null || !canOperateTerminal || readOnly;

  return (
    <SettingsSection title="Account">
      <SettingsRow
        title={authenticated ? "Switch account" : "Sign in"}
        description={
          <>
            {authenticated && email ? (
              <>
                Signed in as <span className="text-foreground">{email}</span>.{" "}
              </>
            ) : authenticated ? (
              "Signed in. "
            ) : (
              "Not signed in. "
            )}
            Opens a terminal with this instance&apos;s{" "}
            <code className="text-foreground">{configDirVariable}</code> already set, so the login
            applies to this instance only. Status refreshes on the next provider check.
          </>
        }
        control={
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={unavailable || command === null}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <TerminalIcon />
            {open ? "Close terminal" : authenticated ? "Switch account" : "Sign in"}
          </Button>
        }
      />
      {open && serverConfig !== null && command !== null ? (
        <div className="px-3 pb-3 sm:px-4">
          <ProviderSignInTerminal
            environmentId={environmentId}
            instanceId={instanceId}
            driver={provider.driver}
            displayName={displayName}
            command={command}
            cwd={serverConfig.cwd}
            keybindings={serverConfig.keybindings}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
    </SettingsSection>
  );
}

function ProviderSignInTerminal(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly driver: ServerProvider["driver"];
  readonly displayName: string;
  readonly command: string;
  readonly cwd: string;
  readonly keybindings: ServerConfig["keybindings"];
  readonly onClose: () => void;
}) {
  const { environmentId, instanceId, driver, displayName, command, cwd, keybindings, onClose } =
    props;
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const setupQueueRef = useRef(Promise.resolve());
  const setupGenerationRef = useRef(0);
  const activeSetupGenerationRef = useRef<number | null>(null);
  const [terminalId] = useState(() => `sign-in-${driver}-${randomUUID()}`);
  const threadRef = scopeThreadRef(environmentId, SIGN_IN_THREAD_ID);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [setupState, setSetupState] = useState<
    "preparing" | "ready" | "openFailed" | "writeFailed"
  >("preparing");
  const terminalReady = setupState === "ready" || setupState === "writeFailed";

  // Mirrors the onboarding install terminal: a canceled open must not close
  // or pre-type into a replacement session that shares this terminal id.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens the server terminal session for this card and closes it on unmount
  useEffect(() => {
    const generation = setupGenerationRef.current + 1;
    setupGenerationRef.current = generation;
    activeSetupGenerationRef.current = generation;
    // oxlint-disable-next-line react/set-state-in-effect -- A retry reopens the terminal, which shows as preparing until the open settles.
    setSetupState("preparing");

    setupQueueRef.current = setupQueueRef.current.then(async () => {
      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("openFailed");
        return;
      }
      const opened = await openTerminal({
        environmentId,
        input: {
          threadId: SIGN_IN_THREAD_ID,
          terminalId,
          cwd,
          providerInstanceId: instanceId,
        },
      });
      if (opened._tag !== "Success") {
        if (activeSetupGenerationRef.current === generation) setSetupState("openFailed");
        return;
      }

      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("writeFailed");
        return;
      }

      const wrote = await writeTerminal({
        environmentId,
        input: { threadId: SIGN_IN_THREAD_ID, terminalId, data: command },
      });
      if (activeSetupGenerationRef.current !== generation) return;
      setSetupState(wrote._tag === "Success" ? "ready" : "writeFailed");
    });

    return () => {
      if (activeSetupGenerationRef.current === generation) {
        activeSetupGenerationRef.current = null;
      }
      setupQueueRef.current = setupQueueRef.current.then(async () => {
        if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) return;
        await closeTerminal({
          environmentId,
          input: { threadId: SIGN_IN_THREAD_ID, terminalId, deleteHistory: true },
        });
      });
    };
  }, [
    closeTerminal,
    command,
    cwd,
    environmentId,
    instanceId,
    openTerminal,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retry bumps setupAttempt to open the terminal again.
    setupAttempt,
    terminalId,
    writeTerminal,
  ]);

  return (
    <div
      data-thread-terminal-drawer
      className="overflow-hidden rounded-lg border border-border/70 bg-background text-foreground"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-3 py-1.5">
        <span className="text-2xs font-medium text-muted-foreground">
          {!canOperateTerminal ? (
            "This connection cannot control terminals."
          ) : setupState === "writeFailed" ? (
            <>
              Run <code className="rounded bg-muted px-1 font-mono">{command}</code> in this
              terminal.
            </>
          ) : setupState === "ready" ? (
            "Review the command, then press Enter to run it. Finish the browser sign-in, then close this terminal."
          ) : setupState === "openFailed" ? (
            "Could not open the sign-in terminal."
          ) : (
            "Preparing command..."
          )}
        </span>
        <div className="flex items-center gap-1">
          {setupState === "openFailed" ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={!canOperateTerminal}
              onClick={() => {
                if (readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
                  setSetupAttempt((value) => value + 1);
                }
              }}
            >
              Retry
            </Button>
          ) : null}
          <Button size="xs" variant="ghost-muted" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="h-64">
        {terminalReady ? (
          <TerminalViewport
            threadRef={threadRef}
            threadId={SIGN_IN_THREAD_ID}
            terminalId={terminalId}
            terminalLabel={`Sign in to ${displayName}`}
            cwd={cwd}
            providerInstanceId={instanceId}
            advancedTypography={advancedTypography}
            onSessionExited={onClose}
            autoFocus
            visible
            keybindings={keybindings}
          />
        ) : null}
      </div>
    </div>
  );
}

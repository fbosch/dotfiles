import { expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createHerdrSessionCwdExtension } from "../herdr-session-cwd";

type SessionStartHandler = (
  event: { reason: string },
  ctx: Pick<ExtensionContext, "mode" | "sessionManager">,
) => void;

function createHarness(environment: NodeJS.ProcessEnv = { HERDR_ENV: "1" }) {
  const changedDirectories: string[] = [];
  const terminalWrites: string[] = [];
  let sessionStart: SessionStartHandler | undefined;
  const pi = {
    on(event: string, handler: SessionStartHandler) {
      if (event === "session_start") sessionStart = handler;
    },
  } as unknown as ExtensionAPI;

  createHerdrSessionCwdExtension({
    environment,
    changeDirectory: (cwd) => changedDirectories.push(cwd),
    writeTerminal: (sequence) => terminalWrites.push(sequence),
  })(pi);

  return {
    changedDirectories,
    terminalWrites,
    start(cwd: string, mode: ExtensionContext["mode"] = "tui") {
      sessionStart?.({ reason: "startup" }, {
        mode,
        sessionManager: { getCwd: () => cwd },
      } as Pick<ExtensionContext, "mode" | "sessionManager">);
    },
  };
}

test("restores Herdr's Pi process and terminal cwd from the loaded session", () => {
  const harness = createHarness();

  harness.start("/worktrees/restored session");

  expect(harness.changedDirectories).toEqual(["/worktrees/restored session"]);
  expect(harness.terminalWrites).toEqual(["\u001b]7;file:///worktrees/restored%20session\u001b\\"]);
});

test("leaves cwd unchanged outside an interactive Herdr pane", () => {
  const outsideHerdr = createHarness({});
  const headless = createHarness();

  outsideHerdr.start("/worktrees/restored");
  headless.start("/worktrees/restored", "rpc");

  expect(outsideHerdr.changedDirectories).toEqual([]);
  expect(outsideHerdr.terminalWrites).toEqual([]);
  expect(headless.changedDirectories).toEqual([]);
  expect(headless.terminalWrites).toEqual([]);
});

test("preserves the pane cwd when the restored session cwd is unusable", () => {
  const relativeCwd = createHarness();
  relativeCwd.start("relative/path");
  expect(relativeCwd.changedDirectories).toEqual([]);
  expect(relativeCwd.terminalWrites).toEqual([]);

  const terminalWrites: string[] = [];
  let sessionStart: SessionStartHandler | undefined;
  const pi = {
    on(event: string, handler: SessionStartHandler) {
      if (event === "session_start") sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  createHerdrSessionCwdExtension({
    environment: { HERDR_ENV: "1" },
    changeDirectory: () => {
      throw new Error("missing directory");
    },
    writeTerminal: (sequence) => terminalWrites.push(sequence),
  })(pi);

  sessionStart?.({ reason: "startup" }, {
    mode: "tui",
    sessionManager: { getCwd: () => "/missing" },
  } as Pick<ExtensionContext, "mode" | "sessionManager">);

  expect(terminalWrites).toEqual([]);
});

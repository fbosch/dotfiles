import { describe, expect, test } from "bun:test";
import { dispatchStartMenuAction } from "../actions";

function createContext(
  commands: Record<string, string> = { applications: "flatseal" },
  sessionActionIds = new Set(["shutdown"]),
) {
  const calls: string[] = [];
  let commandError: Error | null = null;

  return {
    calls,
    context: {
      commands,
      sessionActionIds,
      hideMenu: () => calls.push("hide"),
      showRecentItemsMenu: () => calls.push("recent-items"),
      openUtility: (utility: string) => calls.push(`utility:${utility}`),
      runCommand: (command: string) => {
        calls.push(`command:${command}`);
        if (commandError) throw commandError;
      },
      reportMissingCommand: (itemId: string) => calls.push(`missing:${itemId}`),
      reportCommandError: (itemId: string, error: unknown) => {
        calls.push(`error:${itemId}:${String(error)}`);
      },
    },
    failNextCommand(error = new Error("spawn failed")) {
      commandError = error;
    },
  };
}

describe("dispatchStartMenuAction", () => {
  test("opens recent items without hiding the menu", () => {
    const { calls, context } = createContext();

    dispatchStartMenuAction("recent-items", context);

    expect(calls).toEqual(["recent-items"]);
  });

  test.each(["about-this-pc", "force-quit"])(
    "hides before opening %s",
    (utility) => {
      const { calls, context } = createContext();

      dispatchStartMenuAction(utility, context);

      expect(calls).toEqual(["hide", `utility:${utility}`]);
    },
  );

  test("hides before dispatching session actions", () => {
    const { calls, context } = createContext({ shutdown: "shutdown-command" });

    dispatchStartMenuAction("shutdown", context);

    expect(calls).toEqual(["hide", "command:shutdown-command"]);
  });

  test("dispatches regular commands before hiding the menu", () => {
    const { calls, context } = createContext({ applications: "flatseal" });

    dispatchStartMenuAction("applications", context);

    expect(calls).toEqual(["command:flatseal", "hide"]);
  });

  test("reports and dismisses an unknown action", () => {
    const { calls, context } = createContext();

    dispatchStartMenuAction("missing", context);

    expect(calls).toEqual(["missing:missing", "hide"]);
  });

  test("reports a failed command and preserves hide ordering", () => {
    const { calls, context, failNextCommand } = createContext();
    failNextCommand();

    dispatchStartMenuAction("applications", context);

    expect(calls).toEqual([
      "command:flatseal",
      "error:applications:Error: spawn failed",
      "hide",
    ]);
  });
});

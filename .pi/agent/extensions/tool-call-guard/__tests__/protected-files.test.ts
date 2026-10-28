import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import toolCallGuard from "../index";
import { createGuardProtection } from "../protected-files";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function harness(approve = false) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "guard-protection-")));
  roots.push(cwd);
  const protectedPath = join(cwd, "settings.json");
  writeFileSync(protectedPath, "{}");
  const prompts: string[] = [];
  const controller = new AbortController();
  // SAFETY: tests invoke only fields consumed by the protection and disabled semantic handler.
  const ctx = {
    cwd,
    hasUI: true,
    signal: controller.signal,
    ui: {
      confirm: async (_title: string, message: string) => {
        prompts.push(message);
        return approve;
      },
    },
  } as unknown as ExtensionContext;
  let queue = Promise.resolve();
  const guard = createGuardProtection({
    paths: [protectedPath],
    enqueue: (task) => {
      const result = queue.then(task);
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  });
  const event = (toolName: string, input: Record<string, unknown>): ToolCallEvent => ({
    type: "tool_call",
    toolName,
    toolCallId: "mutation",
    input,
  });
  return { cwd, protectedPath, prompts, controller, ctx, guard, event };
}

describe("command guard file protection", () => {
  test.each(["write", "edit", "replace", "replace_match", "insert", "undo_last_change"])(
    "requires approval for %s independently of classifier settings",
    async (tool) => {
      const h = harness();
      expect(await h.guard.check(h.event(tool, { path: h.protectedPath }), h.ctx)).toMatchObject({
        block: true,
      });
      expect(h.prompts).toHaveLength(1);
      expect(h.prompts[0]).toContain(h.protectedPath);
    },
  );

  test("returns to normal handling for unrelated mutations and reads", async () => {
    const h = harness();
    expect(
      await h.guard.check(h.event("write", { path: join(h.cwd, "ordinary") }), h.ctx),
    ).toBeUndefined();
    expect(h.guard.check(h.event("read", { path: h.protectedPath }), h.ctx)).toBeUndefined();
    expect(
      h.guard.check(h.event("bash", { command: `cat ${h.protectedPath}` }), h.ctx),
    ).toBeUndefined();
  });

  test.each(["rm -f", "mv", "cp source", "tee", "printf '{}' >"])(
    "protects literal Bash mutations: %s",
    async (prefix) => {
      const h = harness();
      expect(
        await h.guard.check(h.event("bash", { command: `${prefix} ${h.protectedPath}` }), h.ctx),
      ).toMatchObject({ block: true });
      expect(h.prompts).toHaveLength(1);
    },
  );

  test("protects ancestor removal and symlink aliases", async () => {
    const h = harness();
    const alias = join(h.cwd, "alias");
    symlinkSync(h.protectedPath, alias);
    expect(await h.guard.check(h.event("replace", { path: alias }), h.ctx)).toMatchObject({
      block: true,
    });
    expect(
      await h.guard.check(h.event("bash", { command: `rm -rf ${h.cwd}` }), h.ctx),
    ).toMatchObject({ block: true });
  });

  test("rejects a symlink retargeted while approval is open", async () => {
    const h = harness(true);
    const ordinary = join(h.cwd, "ordinary");
    writeFileSync(ordinary, "");
    const alias = join(h.cwd, "alias");
    symlinkSync(h.protectedPath, alias);
    h.ctx.ui.confirm = async () => {
      unlinkSync(alias);
      symlinkSync(ordinary, alias);
      return true;
    };
    expect(await h.guard.check(h.event("replace", { path: alias }), h.ctx)).toMatchObject({
      block: true,
    });
  });

  test.each(["input", "cwd", "cancel", "abort"])(
    "rejects stale approval after %s changes",
    async (mutation) => {
      const h = harness(true);
      const event = h.event("replace", { path: h.protectedPath, text: "{}" });
      h.ctx.ui.confirm = async () => {
        if (mutation === "input") event.input = { path: h.protectedPath, text: "changed" };
        if (mutation === "cwd") h.ctx.cwd = "/";
        if (mutation === "cancel") h.guard.cancel();
        if (mutation === "abort") h.controller.abort();
        return true;
      };
      expect(await h.guard.check(event, h.ctx)).toMatchObject({ block: true });
    },
  );

  test("headless protected changes fail closed; unknown anchors are left to the tool", async () => {
    const h = harness(true);
    h.ctx.hasUI = false;
    expect(await h.guard.check(h.event("write", { path: h.protectedPath }), h.ctx)).toMatchObject({
      block: true,
      reason: "Changing command guard files requires interactive approval.",
    });
    // The hashline tool rejects an anchor it never served, so it cannot reach a file.
    expect(
      await h.guard.check(h.event("copy", { path: "ordinary", anchor: "zzzzz" }), h.ctx),
    ).toBeUndefined();
    expect(h.prompts).toHaveLength(0);
  });

  test("an unavailable anchor registry asks instead of implying a permission denial", async () => {
    const h = harness(false);
    let queue = Promise.resolve();
    const guard = createGuardProtection({
      paths: [h.protectedPath],
      resolveAnchors: async () => {
        throw new Error("registry missing");
      },
      enqueue: (task) => {
        const result = queue.then(task);
        queue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    });
    expect(
      await guard.check(h.event("move", { path: join(h.cwd, "ordinary"), anchor: "x" }), h.ctx),
    ).toMatchObject({ block: true, reason: "Command guard file change was not approved." });
    expect(h.prompts[0]).toContain("could not be resolved");
  });

  test("unresolvable protected roots report an internal error only for mutations", async () => {
    const h = harness();
    let queue = Promise.resolve();
    const guard = createGuardProtection({
      paths: [join(h.cwd, "loop")],
      enqueue: (task) => {
        const result = queue.then(task);
        queue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    });
    symlinkSync(join(h.cwd, "loop"), join(h.cwd, "loop"));
    expect(await guard.check(h.event("write", { path: join(h.cwd, "x") }), h.ctx)).toEqual({
      block: true,
      reason: "Tool-call guard internal error: could not resolve its protected paths.",
    });
    expect(await guard.check(h.event("bash", { command: "git status" }), h.ctx)).toBeUndefined();
  });

  test.each([
    "git status",
    "git log --oneline -5",
    "cd PROTECTED && grep -n x file.ts | head; wc -l file.ts",
    "cat PROTECTED/settings.json",
    "ls PROTECTED",
    "cp PROTECTED/settings.json /tmp/copy.json",
  ])("ordinary work inside grants needs no approval: %s", async (template) => {
    const h = harness();
    const command = template.replaceAll("PROTECTED", h.cwd);
    expect(await h.guard.check(h.event("bash", { command }), h.ctx)).toBeUndefined();
    expect(h.prompts).toHaveLength(0);
  });

  test.each([
    "cd PROTECTED && rm settings.json",
    "cp /tmp/x PROTECTED/settings.json",
    "cp /tmp/settings.json PROTECTED",
    "sed -i s/a/b/ PROTECTED/settings.json",
    "sudo -u root rm -f PROTECTED/settings.json",
    "dd if=/dev/zero of=PROTECTED/settings.json",
  ])("mutations of protected files require approval: %s", async (template) => {
    const h = harness();
    const command = template.replaceAll("PROTECTED", h.cwd);
    expect(await h.guard.check(h.event("bash", { command }), h.ctx)).toMatchObject({
      block: true,
    });
    expect(h.prompts).toHaveLength(1);
  });

  test("accepts only the approved call and recovers after dialog failure", async () => {
    const h = harness(true);
    h.ctx.ui.confirm = async () => {
      throw new Error("dialog unavailable");
    };
    expect(await h.guard.check(h.event("write", { path: h.protectedPath }), h.ctx)).toMatchObject({
      block: true,
    });
    h.ctx.ui.confirm = async () => true;
    expect(await h.guard.check(h.event("write", { path: h.protectedPath }), h.ctx)).toBeUndefined();
  });

  test("the actual handler protects files when settings are disabled or invalid", async () => {
    for (const settings of [{}, null]) {
      const h = harness();
      let call: ((event: ToolCallEvent, ctx: ExtensionContext) => unknown) | undefined;
      // SAFETY: this fixture records only the tool_call callback used below.
      const pi = {
        on(name: string, handler: typeof call) {
          if (name === "tool_call") call = handler;
        },
      } as unknown as ExtensionAPI;
      toolCallGuard(pi, {
        protectedPaths: [h.protectedPath],
        loadSettings: () => settings,
        loadSandbox: () => undefined,
        request: async () => {
          throw new Error("Protection must not use a classifier");
        },
      });
      expect(await call?.(h.event("write", { path: h.protectedPath }), h.ctx)).toMatchObject({
        block: true,
      });
      expect(h.prompts).toHaveLength(1);
    }
  });

  test.each(["copy", "move"])(
    "resolves cross-file %s anchors in the active hashline session",
    async (tool) => {
      const h = harness();
      // Dynamic import uses the installed package without pulling its implementation into our TS project.
      const modulePath = join(
        import.meta.dir,
        "../../../npm/node_modules/pi-hashline-edit-pro/src/anchor-registry.ts",
      );
      const registry = await import(modulePath);
      const sessionId = `guard-protection-${h.cwd}`;
      h.ctx.sessionManager = {
        getSessionId: () => sessionId,
      } as ExtensionContext["sessionManager"];
      try {
        const [source, destination] = await registry.withAnchorSession(h.ctx, () => [
          registry.allocateAnchor(join(h.cwd, "ordinary"), "source"),
          registry.allocateAnchor(h.protectedPath, "destination"),
        ]);
        expect(
          await h.guard.check(
            h.event(tool, {
              path: join(h.cwd, "ordinary"),
              source_from: source,
              source_to: source,
              anchor: destination,
              direction: "after",
            }),
            h.ctx,
          ),
        ).toMatchObject({ block: true });
        expect(h.prompts).toHaveLength(1);
        expect(h.prompts[0]).toContain(h.protectedPath);
      } finally {
        registry.releaseRegistrySession(`ephemeral:${sessionId}`);
      }
    },
  );

  test("never offers an override for catastrophic ancestor removal", async () => {
    const h = harness(true);
    expect(await h.guard.check(h.event("bash", { command: "rm -rf /" }), h.ctx)).toMatchObject({
      block: true,
    });
    expect(h.prompts).toHaveLength(0);
  });
});

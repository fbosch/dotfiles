import { describe, expect, test } from "bun:test";
import {
  createComponentHostRequestHandler,
  type ComponentHostRouterOptions,
  type ComponentRequestHandler,
} from "@/services/component-host-router";

interface RouterTestOptions {
  componentHandlers?: ReadonlyMap<string, ComponentRequestHandler>;
  taskbarVisibilityComponents?: readonly string[];
  handleUtilityRequest?: ComponentHostRouterOptions["handleUtilityRequest"];
  visibleUtilityComponent?: () => string | null;
}

function createRouter({
  componentHandlers = new Map(),
  taskbarVisibilityComponents = [],
  handleUtilityRequest = () => false,
  visibleUtilityComponent = () => null,
}: RouterTestOptions = {}): ComponentRequestHandler {
  return createComponentHostRequestHandler({
    instanceName: "test-host",
    componentHandlers,
    taskbarVisibilityComponents,
    handleUtilityRequest,
    visibleUtilityComponent,
  });
}

function request(
  router: ComponentRequestHandler,
  argv: string[],
): Promise<string> {
  return new Promise((resolve) => router(argv, resolve));
}

describe("component host router", () => {
  test("handles readiness routes before adapters", async () => {
    let utilityCalls = 0;
    const router = createRouter({
      componentHandlers: new Map([
        ["ping", (_argv, res) => res("component")],
      ]),
      handleUtilityRequest() {
        utilityCalls += 1;
        return true;
      },
    });

    await expect(request(router, [])).resolves.toBe("ready");
    await expect(request(router, ["   "])).resolves.toBe("ready");
    await expect(request(router, ["ping", "ignored"])).resolves.toBe("ready");
    expect(utilityCalls).toBe(0);
  });

  test("routes direct requests to eager components before utilities", async () => {
    const payload = ['{"action":', '"show"}'];
    let received: string[] | undefined;
    let utilityCalls = 0;
    const router = createRouter({
      componentHandlers: new Map([
        [
          "target",
          (argv, res) => {
            received = argv;
            res("shown");
          },
        ],
      ]),
      handleUtilityRequest() {
        utilityCalls += 1;
        return true;
      },
    });

    await expect(request(router, ["target", ...payload])).resolves.toBe("shown");
    expect(received).toEqual(payload);
    expect(utilityCalls).toBe(0);
  });

  test("observes eager components registered after router creation", async () => {
    const componentHandlers = new Map<string, ComponentRequestHandler>();
    const router = createRouter({ componentHandlers });

    componentHandlers.set("target", (_argv, res) => res("registered"));

    await expect(request(router, ["target"])).resolves.toBe("registered");
  });

  test("allows claimed utility requests to respond later", async () => {
    let respond: ((response: string) => void) | undefined;
    const router = createRouter({
      handleUtilityRequest(component, argv, res) {
        expect(component).toBe("utility");
        expect(argv).toEqual(['{"action":"show"}']);
        respond = res;
        return true;
      },
    });

    const response = request(router, ["utility", '{"action":"show"}']);
    await Promise.resolve();
    respond?.("shown");
    await expect(response).resolves.toBe("shown");
  });

  test("reports the first synchronously visible taskbar component", async () => {
    const queried: string[] = [];
    const componentHandlers = new Map<string, ComponentRequestHandler>([
      [
        "first",
        (argv, res) => {
          queried.push(`first:${argv.join(" ")}`);
          res("false");
        },
      ],
      [
        "second",
        (argv, res) => {
          queried.push(`second:${argv.join(" ")}`);
          res("true");
        },
      ],
    ]);
    let utilityVisibilityCalls = 0;
    const router = createRouter({
      componentHandlers,
      taskbarVisibilityComponents: ["missing", "first", "second"],
      visibleUtilityComponent() {
        utilityVisibilityCalls += 1;
        return "utility";
      },
    });

    await expect(
      request(router, [
        "taskbar-visibility",
        '{"action":"visible-component"}',
      ]),
    ).resolves.toBe("second");
    expect(queried).toEqual([
      'first:{"action":"is-visible"}',
      'second:{"action":"is-visible"}',
    ]);
    expect(utilityVisibilityCalls).toBe(0);
  });

  test("ignores visibility responses delivered after the handler returns", async () => {
    let respond: ((response: string) => void) | undefined;
    const router = createRouter({
      componentHandlers: new Map([
        [
          "late",
          (_argv, res) => {
            respond = res;
          },
        ],
      ]),
      taskbarVisibilityComponents: ["late"],
      visibleUtilityComponent: () => "utility",
    });

    await expect(
      request(router, [
        "taskbar-visibility",
        '{"action":"visible-component"}',
      ]),
    ).resolves.toBe("utility");
    respond?.("true");
  });

  test("preserves taskbar request responses", async () => {
    const router = createRouter();

    await expect(request(router, ["taskbar-visibility"])).resolves.toBe("none");
    await expect(
      request(router, ["taskbar-visibility", "not-json"]),
    ).resolves.toBe("error: invalid JSON");
    await expect(
      request(router, ["taskbar-visibility", '{"action":"other"}']),
    ).resolves.toBe("unknown action");
    await expect(
      request(router, [
        "taskbar-visibility",
        '{"action":"visible-component"}',
      ]),
    ).resolves.toBe("none");
  });

  test("routes the legacy action form and preserves extra fields", async () => {
    let forwarded: unknown;
    let targetUtilityCalls = 0;
    const router = createRouter({
      componentHandlers: new Map([
        [
          "target",
          (argv, res) => {
            forwarded = JSON.parse(argv.join(" "));
            res("shown");
          },
        ],
      ]),
      handleUtilityRequest(component, _argv, res) {
        if (component !== "target") return false;
        targetUtilityCalls += 1;
        res("utility");
        return true;
      },
    });

    await expect(
      request(router, [
        '{"action":"target:show:ignored",',
        '"source":"legacy"}',
      ]),
    ).resolves.toBe("shown");
    expect(forwarded).toEqual({ action: "show", source: "legacy" });
    expect(targetUtilityCalls).toBe(0);
  });

  test("routes the legacy action form to utilities", async () => {
    let forwarded: unknown;
    const router = createRouter({
      handleUtilityRequest(component, argv, res) {
        if (component !== "utility") return false;
        forwarded = JSON.parse(argv.join(" "));
        res("hidden");
        return true;
      },
    });

    await expect(
      request(router, ['{"action":"utility:hide","source":"legacy"}']),
    ).resolves.toBe("hidden");
    expect(forwarded).toEqual({ action: "hide", source: "legacy" });
  });

  test("preserves unknown target and unsupported envelope errors", async () => {
    const router = createRouter();

    await expect(request(router, ["missing"])).resolves.toBe(
      'error: unknown component "missing"',
    );
    await expect(
      request(router, ['{"window":"target","action":"show"}']),
    ).resolves.toBe("error: component not specified");
  });

  test("maps synchronous adapter exceptions through the host error response", async () => {
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args) => errors.push(args);
    const router = createRouter({
      handleUtilityRequest() {
        throw new Error("boom");
      },
    });

    try {
      await expect(request(router, ["utility"])).resolves.toBe(
        "error: Error: boom",
      );
      expect(errors).toEqual([
        ["Error in test-host request handler:", new Error("boom")],
      ]);
    } finally {
      console.error = originalError;
    }
  });
});

import { describe, expect, test } from "bun:test";
import type { ComponentModule } from "../component-host";
import {
  createUtilityManager,
  type UtilityDefinition,
} from "../utility-registry";

interface FakeUtility {
  component: ComponentModule;
  definition: UtilityDefinition;
  loadCount: () => number;
  initCount: () => number;
  requests: string[];
  setVisible: (visible: boolean) => void;
}

function createFakeUtility(): FakeUtility {
  let visible = false;
  let loads = 0;
  let inits = 0;
  const requests: string[] = [];
  const component: ComponentModule = {
    init() {
      inits += 1;
    },
    handleRequest(argv, res) {
      const action = JSON.parse(argv.join(" ")).action;
      requests.push(action);
      if (action === "is-visible") {
        res(visible ? "true" : "false");
        return;
      }
      if (action === "show") visible = true;
      if (action === "hide") visible = false;
      res(action === "show" ? "shown" : "hidden");
    },
    instanceName: "fake-utility",
  };

  const definition: UtilityDefinition = {
    load() {
      loads += 1;
      return Promise.resolve();
    },
    component: () => component,
  };

  return {
    component,
    definition,
    loadCount: () => loads,
    initCount: () => inits,
    requests,
    setVisible(next) {
      visible = next;
    },
  };
}

function request(
  manager: ReturnType<typeof createUtilityManager>,
  component: string,
  action: string,
): Promise<string> {
  return new Promise((resolve) => {
    expect(manager.handleRequest(component, [JSON.stringify({ action })], resolve)).toBe(
      true,
    );
  });
}

describe("utility manager", () => {
  test("does not load an unseen utility to answer is-visible", async () => {
    const utility = createFakeUtility();
    const manager = createUtilityManager({ utility: utility.definition });

    await expect(request(manager, "utility", "is-visible")).resolves.toBe("false");
    expect(utility.loadCount()).toBe(0);
    expect(utility.initCount()).toBe(0);
  });

  test("deduplicates concurrent requests and initializes once", async () => {
    const utility = createFakeUtility();
    const manager = createUtilityManager({ utility: utility.definition });

    await expect(
      Promise.all([request(manager, "utility", "show"), request(manager, "utility", "show")]),
    ).resolves.toEqual(["shown", "shown"]);
    expect(utility.loadCount()).toBe(1);
    expect(utility.initCount()).toBe(1);
    expect(utility.requests).toEqual(["show", "show"]);
  });

  test("opens an allow-listed utility through its public entry point", async () => {
    const utility = createFakeUtility();
    const manager = createUtilityManager({ utility: utility.definition });

    await manager.openUtility("utility");

    expect(utility.loadCount()).toBe(1);
    expect(utility.initCount()).toBe(1);
    expect(utility.requests).toEqual(["show"]);
  });

  test("reports visibility only for loaded utilities", async () => {
    const first = createFakeUtility();
    const second = createFakeUtility();
    const manager = createUtilityManager({
      first: first.definition,
      second: second.definition,
    });

    await request(manager, "first", "show");
    second.setVisible(true);

    expect(manager.visibleComponent()).toBe("first");
    expect(second.loadCount()).toBe(0);
  });

  test("rejects unknown utility request targets", () => {
    const manager = createUtilityManager({});
    expect(manager.handleRequest("unknown", [], () => {})).toBe(false);
  });

  test("reports a failed lazy load to the request caller", async () => {
    const manager = createUtilityManager({
      broken: {
        load: () => Promise.reject(new Error("unavailable")),
        component: () => {
          throw new Error("component should not be requested");
        },
      },
    });
    const originalError = console.error;
    console.error = () => {};

    try {
      await expect(request(manager, "broken", "show")).resolves.toBe(
        "error: utility unavailable",
      );
    } finally {
      console.error = originalError;
    }
  });
});

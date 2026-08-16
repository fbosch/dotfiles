import app from "ags/gtk4/app";
import {
  handleUtilityRequest,
  visibleUtilityComponent,
} from "./utility-manager";

export interface ComponentModule {
  init: () => void;
  handleRequest: (argv: string[], res: (response: string) => void) => void;
  instanceName: string;
  show?: () => void;
}

interface ComponentHostOptions {
  instanceName: string;
  components: Array<() => ComponentModule>;
  taskbarVisibilityComponents: string[];
  css?: string;
}

type ComponentHandler = ComponentModule["handleRequest"];

export function startComponentHost({
  instanceName,
  components: componentFactories,
  taskbarVisibilityComponents,
  css,
}: ComponentHostOptions): void {
  const components = new Map<string, ComponentHandler>();

  function requestComponent(component: string, payload: unknown): string {
    const handler = components.get(component);
    if (!handler) return "";

    let response = "";
    handler([JSON.stringify(payload)], (value) => {
      response = value;
    });
    return response;
  }

  function handleTaskbarVisibilityRequest(
    argv: string[],
    res: (response: string) => void,
  ): void {
    const request = argv.join(" ");
    if (request.trim() === "") {
      res("none");
      return;
    }

    let data: { action?: string };
    try {
      data = JSON.parse(request);
    } catch {
      res("error: invalid JSON");
      return;
    }

    if (data.action !== "visible-component") {
      res("unknown action");
      return;
    }

    for (const component of taskbarVisibilityComponents) {
      if (requestComponent(component, { action: "is-visible" }) === "true") {
        res(component);
        return;
      }
    }

    const visibleUtility = visibleUtilityComponent();
    if (visibleUtility) {
      res(visibleUtility);
      return;
    }

    res("none");
  }

  function handleRequest(argv: string[], res: (response: string) => void): void {
    try {
      const [component, ...rest] = argv;
      if (!component || component.trim() === "") {
        res("ready");
        return;
      }

      if (component === "ping") {
        res("ready");
        return;
      }

      if (component === "taskbar-visibility") {
        handleTaskbarVisibilityRequest(rest, res);
        return;
      }

      const handler = components.get(component);
      if (handler) {
        handler(rest, res);
        return;
      }

      if (handleUtilityRequest(component, rest, res)) {
        return;
      }

      try {
        const data = JSON.parse(argv.join(" ")) as { action?: string };
        if (data.action?.includes(":") === true) {
          const [target, action] = data.action.split(":", 2);
          const targetHandler = components.get(target);
          if (targetHandler) {
            targetHandler([JSON.stringify({ ...data, action })], res);
            return;
          }

          if (
            handleUtilityRequest(
              target,
              [JSON.stringify({ ...data, action })],
              res,
            )
          ) {
            return;
          }
        }

        res("error: component not specified");
      } catch {
        res(`error: unknown component "${component}"`);
      }
    } catch (error) {
      console.error(`Error in ${instanceName} request handler:`, error);
      res(`error: ${error}`);
    }
  }

  app.start({
    css,
    main() {
      console.log(`[${instanceName}] Initializing components...`);
      for (const componentFactory of componentFactories) {
        try {
          const component = componentFactory();
          component.init();
          components.set(component.instanceName, component.handleRequest);
          console.log(`[${instanceName}] ${component.instanceName} initialized`);
        } catch (error) {
          console.error(`[${instanceName}] Failed to initialize component:`, error);
        }
      }
      return null;
    },
    instanceName,
    requestHandler: handleRequest,
  });
}

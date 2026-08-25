export type ComponentRequestHandler = (
  argv: string[],
  res: (response: string) => void,
) => void;

export interface ComponentHostRouterOptions {
  instanceName: string;
  componentHandlers: ReadonlyMap<string, ComponentRequestHandler>;
  taskbarVisibilityComponents: readonly string[];
  handleUtilityRequest: (
    component: string,
    argv: string[],
    res: (response: string) => void,
  ) => boolean;
  visibleUtilityComponent: () => string | null;
}

export function createComponentHostRequestHandler({
  instanceName,
  componentHandlers,
  taskbarVisibilityComponents,
  handleUtilityRequest,
  visibleUtilityComponent,
}: ComponentHostRouterOptions): ComponentRequestHandler {
  function requestComponent(component: string, payload: unknown): string {
    const handler = componentHandlers.get(component);
    if (!handler) return "";

    // Taskbar visibility is a synchronous protocol; ordinary requests may respond later.
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

  return (argv, res) => {
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

      const handler = componentHandlers.get(component);
      if (handler) {
        handler(rest, res);
        return;
      }

      if (handleUtilityRequest(component, rest, res)) return;

      try {
        const data = JSON.parse(argv.join(" ")) as { action?: string };
        if (data.action?.includes(":") === true) {
          const [target, action] = data.action.split(":", 2);
          const targetHandler = componentHandlers.get(target);
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
  };
}

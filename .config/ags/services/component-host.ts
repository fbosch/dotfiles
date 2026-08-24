import app from "ags/gtk4/app";
import {
  handleUtilityRequest,
  visibleUtilityComponent,
} from "./utility-manager";
import {
  createComponentHostRequestHandler,
  type ComponentRequestHandler,
} from "./component-host-router";

export interface ComponentModule {
  init: () => void;
  handleRequest: ComponentRequestHandler;
  instanceName: string;
  show?: () => void;
}

interface ComponentHostOptions {
  instanceName: string;
  components: Array<() => ComponentModule>;
  taskbarVisibilityComponents: string[];
  css?: string;
}

export function startComponentHost({
  instanceName,
  components: componentFactories,
  taskbarVisibilityComponents,
  css,
}: ComponentHostOptions): void {
  const components = new Map<string, ComponentRequestHandler>();
  const handleRequest = createComponentHostRequestHandler({
    instanceName,
    componentHandlers: components,
    taskbarVisibilityComponents,
    handleUtilityRequest,
    visibleUtilityComponent,
  });

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

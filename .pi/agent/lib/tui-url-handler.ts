const URL_HANDLER_STATE = Symbol.for("dotfiles:pi-url-handler-lifecycle");

type UrlHandler = ((url: string) => void) & {
  [URL_HANDLER_STATE]?: UrlHandlerLifecycle;
};

interface UrlHandlerLifecycle {
  readonly disposed: boolean;
  readonly original?: UrlHandler;
}

export function trackUrlHandler(handler: UrlHandler, lifecycle: UrlHandlerLifecycle): void {
  handler[URL_HANDLER_STATE] = lifecycle;
}

// An outer extension may restore an inner handler after its owner has shut down.
// Both link integrations share this marker to avoid retaining wrappers on reload.
export function activeUrlHandler(handler: UrlHandler | undefined): UrlHandler | undefined {
  let current = handler;
  while (current?.[URL_HANDLER_STATE]?.disposed) {
    current = current[URL_HANDLER_STATE].original;
  }
  return current;
}

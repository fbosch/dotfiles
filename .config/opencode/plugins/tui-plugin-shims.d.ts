declare namespace JSX {
  type Element = any

  interface IntrinsicElements {
    [elemName: string]: any
  }
}

declare module "solid-js" {
  export type JSX = globalThis.JSX
  export type Accessor<T> = () => T

  export function createMemo<T>(fn: () => T): Accessor<T>
  export function createSignal<T>(value: T): [Accessor<T>, (next: T | ((prev: T) => T)) => T]
  export function onCleanup(fn: () => void): void
}

declare module "@opentui/core" {
  export interface RGBA {
    r: number
    g: number
    b: number
    a: number
  }
}

declare module "@opentui/solid/jsx-runtime" {
  export const Fragment: any
  export function jsx(type: any, props: any, key?: any): any
  export function jsxs(type: any, props: any, key?: any): any
}

declare module "@opencode-ai/plugin/tui" {
  export interface TuiPluginApi {
    client: {
      session: {
        messages(input: {
          path: { id: string }
          query?: { directory?: string }
        }): Promise<{ data?: unknown[] } | unknown[]>
      }
    }
    theme: {
      current: Record<string, unknown>
    }
    event: {
      on(type: string, handler: (event: { properties: Record<string, unknown> }) => void): () => void
    }
    state: {
      path: {
        directory: string
      }
      provider: unknown[]
      session: {
        messages(sessionID: string): unknown[]
      }
    }
    route: {
      current: {
        name: string
        params?: Record<string, unknown>
      }
    }
    ui: unknown
    slots: {
      register(plugin: {
        order?: number
        slots: Record<string, (ctx: unknown, props: Record<string, unknown>) => any>
      }): string
    }
  }

  export type TuiPlugin = (api: TuiPluginApi, options: unknown, meta: unknown) => Promise<void>

  export interface TuiPluginModule {
    id?: string
    tui: TuiPlugin
  }
}

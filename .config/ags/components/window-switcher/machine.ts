import { assign, assertEvent, setup } from "xstate";
import { cycleSelection, type SwitchDirection } from "./session-policy";

export interface WindowInfo {
  address: string;
  stableId?: string;
  class: string;
  initialClass?: string;
  title: string;
  initialTitle?: string;
  workspace: string;
  size?: {
    width: number;
    height: number;
  };
  position?: {
    x: number;
    y: number;
  };
}

type WindowSwitcherContext = {
  windows: WindowInfo[];
  currentIndex: number;
  triggerModifier: string;
};

type WindowSwitcherEvent =
  | {
      type: "ACTIVATE";
      windows: WindowInfo[];
      index: number;
      triggerModifier: string;
    }
  | { type: "CYCLE"; direction: SwitchDirection }
  | { type: "SELECT"; index: number }
  | { type: "REFRESH"; windows: WindowInfo[] }
  | { type: "COMMIT" }
  | { type: "HIDE" };

export const windowSwitcherMachine = setup({
  types: {
    context: {} as WindowSwitcherContext,
    events: {} as WindowSwitcherEvent,
    tags: {} as "switcher-visible",
  },
  guards: {
    hasMultipleWindows: ({ event }) => {
      assertEvent(event, "ACTIVATE");
      return event.windows.length > 1;
    },
  },
  actions: {
    activateSession: assign(({ event }) => {
      assertEvent(event, "ACTIVATE");
      return {
        windows: event.windows,
        currentIndex: event.index,
        triggerModifier: event.triggerModifier,
      };
    }),
    cycleSelection: assign({
      currentIndex: ({ context, event }) => {
        assertEvent(event, "CYCLE");
        return cycleSelection(
          context.currentIndex,
          context.windows.length,
          event.direction,
        );
      },
    }),
    selectWindow: assign({
      currentIndex: ({ event }) => {
        assertEvent(event, "SELECT");
        return event.index;
      },
    }),
    refreshWindows: assign(({ event }) => {
      assertEvent(event, "REFRESH");
      return {
        windows: event.windows,
        currentIndex: 0,
      };
    }),
  },
}).createMachine({
  id: "window-switcher",
  context: {
    windows: [],
    currentIndex: 0,
    triggerModifier: "ALT",
  },
  initial: "hidden",
  states: {
    hidden: {
      on: {
        ACTIVATE: {
          guard: "hasMultipleWindows",
          target: "visible",
          actions: "activateSession",
        },
      },
    },
    visible: {
      tags: ["switcher-visible"],
      on: {
        ACTIVATE: {
          guard: "hasMultipleWindows",
          actions: "activateSession",
        },
        CYCLE: { actions: "cycleSelection" },
        SELECT: { actions: "selectWindow" },
        REFRESH: { actions: "refreshWindows" },
        COMMIT: "hidden",
        HIDE: "hidden",
      },
    },
  },
});

import { setup } from "xstate";

type StartMenuEvent =
  | { type: "SHOW" }
  | { type: "HIDE" }
  | { type: "RECENT_OPEN_REQUEST" }
  | { type: "RECENT_CLOSE_REQUEST" }
  | { type: "RECENT_OPEN_NOW" }
  | { type: "RECENT_CLOSE_NOW" };

export const startMenuMachine = setup({
  types: {
    events: {} as StartMenuEvent,
    tags: {} as "menu-visible" | "recent-items-visible",
  },
  delays: {
    recentOpenDelay: 300,
    recentCloseDelay: 200,
  },
}).createMachine({
  id: "start-menu",
  initial: "hidden",
  states: {
    hidden: {
      on: {
        SHOW: "visible",
      },
    },
    visible: {
      tags: ["menu-visible"],
      initial: "recentClosed",
      on: {
        HIDE: "hidden",
      },
      states: {
        recentClosed: {
          on: {
            RECENT_OPEN_REQUEST: "recentOpening",
            RECENT_OPEN_NOW: "recentOpen",
          },
        },
        recentOpening: {
          after: {
            recentOpenDelay: "recentOpen",
          },
          on: {
            RECENT_OPEN_NOW: "recentOpen",
            RECENT_CLOSE_REQUEST: "recentClosed",
            RECENT_CLOSE_NOW: "recentClosed",
          },
        },
        recentOpen: {
          tags: ["recent-items-visible"],
          on: {
            RECENT_CLOSE_REQUEST: "recentClosing",
            RECENT_CLOSE_NOW: "recentClosed",
          },
        },
        recentClosing: {
          tags: ["recent-items-visible"],
          after: {
            recentCloseDelay: "recentClosed",
          },
          on: {
            RECENT_OPEN_REQUEST: "recentOpen",
            RECENT_OPEN_NOW: "recentOpen",
            RECENT_CLOSE_NOW: "recentClosed",
          },
        },
      },
    },
  },
});

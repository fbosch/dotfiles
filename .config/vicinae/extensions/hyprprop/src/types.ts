export type HyprpropWindowInfo = {
  address: string;
  mapped: boolean;
  hidden: boolean;
  at: [number, number];
  size: [number, number];
  workspace: {
    id: number;
    name: string;
  };
  floating: boolean;
  monitor: number;
  class: string;
  title: string;
  initialClass: string;
  initialTitle: string;
  pid: number;
  xwayland: boolean;
  pinned: boolean;
  fullscreen: boolean;
  fullscreenMode: number;
  fakeFullscreen: boolean;
  grouped: unknown[];
  swallowing: string | null;
  focusHistoryID: number;
};

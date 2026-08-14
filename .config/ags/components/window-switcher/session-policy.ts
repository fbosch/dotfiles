export type SwitchDirection = "next" | "previous";

type AddressableWindow = {
  address: string;
};

type CommitWindow = AddressableWindow & {
  workspace: string;
};

export function getInitialSelection(
  windows: AddressableWindow[],
  activeAddress: string | null,
  sortMode: string,
  direction: SwitchDirection,
): number {
  if (sortMode === "RECENCY") return 1;

  const activeIndex = windows.findIndex((window) => window.address === activeAddress);
  if (direction === "next") {
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    return (currentIndex + 1) % windows.length;
  }

  const currentIndex = activeIndex >= 0 ? activeIndex : windows.length - 1;
  return (currentIndex - 1 + windows.length) % windows.length;
}

export function cycleSelection(
  currentIndex: number,
  windowCount: number,
  direction: SwitchDirection,
): number {
  if (windowCount <= 1) return currentIndex;
  if (direction === "next") return (currentIndex + 1) % windowCount;
  return (currentIndex - 1 + windowCount) % windowCount;
}

export function resolveCommitTarget(windows: CommitWindow[], currentIndex: number) {
  const window = windows[currentIndex];
  if (!window) return null;

  return {
    address: window.address,
    restoreMinimized: window.workspace === "special:minimized",
  };
}

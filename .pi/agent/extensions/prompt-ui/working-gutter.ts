export const WORKING_SWEEP_FRAMES = 48;

export function workingGutterStrength(row: number, lastRow: number, position: number): number {
  const headRadius = Math.max(0.8, lastRow * 0.12);
  const tailRadius = Math.max(1.5, lastRow * 0.25);
  // Travel beyond both ends so the glow fades away before the next sweep enters.
  const easedPosition = 1 - gutterFade(position, 1);
  const center = -3 * headRadius + easedPosition * (lastRow + 3 * headRadius + 3 * tailRadius);
  const radius = row < center ? tailRadius : headRadius;
  const distance = (row - center) / radius;
  return Math.exp(-0.5 * distance * distance);
}

export function gutterFade(elapsed: number, duration: number): number {
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  return 1 - progress * progress * (3 - 2 * progress);
}

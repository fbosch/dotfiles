export const WORKING_FRAME_INTERVAL_MS = 50;
export const WORKING_SWEEP_FRAMES = 1_200 / WORKING_FRAME_INTERVAL_MS;

const COMPLETION_RISE_MS = 100;
const COMPLETION_FADE_MS = 600;
export const COMPLETION_GLOW_DURATION_MS = COMPLETION_RISE_MS + COMPLETION_FADE_MS;

export function completionGlowStrength(elapsed: number): number {
  return elapsed < COMPLETION_RISE_MS
    ? 1 - gutterFade(elapsed, COMPLETION_RISE_MS)
    : gutterFade(elapsed - COMPLETION_RISE_MS, COMPLETION_FADE_MS);
}

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

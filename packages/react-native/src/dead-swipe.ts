/**
 * P-M46 `$dead_swipe`: a swipe of at least 48 points after which nothing on screen scrolled, paged or changed (the
 * wireframe fingerprint ~700 ms after the gesture equals the one at its start). Carries geometry only, never text.
 */

export const DEAD_SWIPE_MIN_DISTANCE = 48;
export const DEAD_SWIPE_SETTLE_MS = 700;
export const DEAD_SWIPE_COOLDOWN_MS = 2000;

export type SwipeDirection = "left" | "right" | "up" | "down";

/** Dominant axis of end - start; screen y grows downwards. */
export const swipeDirection = (dx: number, dy: number): SwipeDirection =>
  Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";

export interface DeadSwipeInput {
  screen: string;
  startScreen: string;
  startFingerprint: string;
  endFingerprint: string;
  dx: number;
  dy: number;
  nowMs: number;
  lastAt?: number | undefined;
}

/** The `$dead_swipe` properties when the swipe was dead and the 2 s cooldown has passed, else null. */
export function deadSwipeDecision(i: DeadSwipeInput): { $screen_name: string; $swipe_direction: SwipeDirection; $swipe_distance: number } | null {
  const distance = Math.hypot(i.dx, i.dy);
  if (distance < DEAD_SWIPE_MIN_DISTANCE || i.screen !== i.startScreen || i.startFingerprint !== i.endFingerprint) return null;
  if (i.lastAt !== undefined && i.nowMs - i.lastAt < DEAD_SWIPE_COOLDOWN_MS) return null;
  return { $screen_name: i.screen, $swipe_direction: swipeDirection(i.dx, i.dy), $swipe_distance: Math.round(distance) };
}

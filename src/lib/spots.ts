// Pure logic: parking-space geometry, how much of a space the detected vehicles cover,
// and the free/occupied state machine. No React Native imports, so it is unit-tested.

/** A point in normalised image coordinates (0..1, origin top-left). */
export type Pt = [number, number];

/** A detected vehicle, normalised to the whole camera frame. */
export type Box = { x: number; y: number; w: number; h: number; score: number; label: string };

export type Rect = { x: number; y: number; w: number; h: number };

export type Spot = { id: string; name: string; pts: Pt[] };

export type SpotState = 'unknown' | 'free' | 'occupied';

/** Live, per-spot tracking while watching. */
export type Track = {
  state: SpotState;
  /** The reading being confirmed and how many checks in a row it has held. */
  cand: Exclude<SpotState, 'unknown'> | null;
  streak: number;
  /** When the current state began. */
  since: number | null;
  /** Last time a "free" alert went out for this spot. */
  lastAlert: number;
  /** Share of the spot covered by vehicles at the last check (0..1). */
  ratio: number;
};

export const newTrack = (): Track => ({ state: 'unknown', cand: null, streak: 0, since: null, lastAlert: 0, ratio: 0 });

export function inPoly(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Evenly spread points inside the polygon; coverage is the share of them inside a vehicle box. */
export function samplePoints(pts: Pt[]): Pt[] {
  if (pts.length < 3) return [];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  for (const n of [24, 48, 96]) {
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
        const y = y0 + ((j + 0.5) * (y1 - y0)) / n;
        if (inPoly(x, y, pts)) out.push([x, y]);
      }
    }
    if (out.length >= 40) return out;
  }
  return pts.slice();
}

export function coverage(samples: Pt[], boxes: Box[]): number {
  if (!samples.length) return 0;
  let hit = 0;
  for (const [x, y] of samples) {
    if (boxes.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) hit++;
  }
  return hit / samples.length;
}

/**
 * The part of the frame worth looking at: all spots plus a margin, so cars that stick out
 * of a space are still seen whole. Cropping first gives the detector more pixels per car and
 * keeps the rest of the street out of its 10-detection budget.
 */
export function regionOfInterest(spots: { pts: Pt[] }[], margin = 0.12): Rect {
  const all = spots.flatMap((s) => s.pts);
  if (!all.length) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const mx = Math.max(0.08, (x1 - x0) * margin);
  const my = Math.max(0.08, (y1 - y0) * margin);
  x0 = Math.max(0, x0 - mx);
  y0 = Math.max(0, y0 - my);
  x1 = Math.min(1, x1 + mx);
  y1 = Math.min(1, y1 + my);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// SSD MobileNet (COCO) class ids, 0-based.
const VEHICLES: Record<number, string> = { 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck' };

/**
 * Turns the detector's raw outputs (boxes as [ymin, xmin, ymax, xmax] within the crop,
 * class ids, scores, count) into vehicle boxes on the whole frame.
 */
export function parseDetections(
  out: { boxes: ArrayLike<number>; classes: ArrayLike<number>; scores: ArrayLike<number>; count: number },
  crop: Rect,
  minScore: number,
): Box[] {
  const res: Box[] = [];
  const n = Math.min(out.count, out.scores.length);
  for (let i = 0; i < n; i++) {
    const label = VEHICLES[Math.round(out.classes[i])];
    const score = out.scores[i];
    if (!label || score < minScore) continue;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const ymin = clamp(out.boxes[i * 4]);
    const xmin = clamp(out.boxes[i * 4 + 1]);
    const ymax = clamp(out.boxes[i * 4 + 2]);
    const xmax = clamp(out.boxes[i * 4 + 3]);
    res.push({
      x: crop.x + xmin * crop.w,
      y: crop.y + ymin * crop.h,
      w: (xmax - xmin) * crop.w,
      h: (ymax - ymin) * crop.h,
      score,
      label,
    });
  }
  return res;
}

export type Rules = { occ: number; confirm: number };

/** One check for one spot. Returns the new track and the change, if the state flipped. */
export function step(track: Track, ratio: number, rules: Rules, now: number): { track: Track; change: { from: SpotState; to: SpotState } | null } {
  const reading = ratio >= rules.occ ? 'occupied' : 'free';
  const streak = reading === track.cand ? track.streak + 1 : 1;
  const next: Track = { ...track, ratio, cand: reading, streak };
  if (streak >= rules.confirm && track.state !== reading) {
    return { track: { ...next, state: reading, since: now }, change: { from: track.state, to: reading } };
  }
  return { track: next, change: null };
}

/** Quiet hours as whole hours; from === to (or null) means none. Spans midnight when from > to. */
export function inQuietHours(from: number | null, to: number | null, d: Date): boolean {
  if (from == null || to == null || from === to) return false;
  const h = d.getHours();
  return from < to ? h >= from && h < to : h >= from || h < to;
}

export function canAlert(track: Track, cooldownMin: number, now: number): boolean {
  return now - track.lastAlert >= cooldownMin * 60_000;
}

export function since(ts: number | null, now: number): string {
  if (!ts) return '';
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

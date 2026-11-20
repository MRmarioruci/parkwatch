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
  /** How the spot looked when last known taken / free (appearance memory). */
  occRef: Patch | null;
  freeRef: Patch | null;
  /** Similarity to the relevant reference at the last check, for display (0..1), or null. */
  sim: number | null;
  /** True when the last reading came from appearance memory rather than the detector. */
  byLook: boolean;
};

export const newTrack = (): Track => ({ state: 'unknown', cand: null, streak: 0, since: null, lastAlert: 0, ratio: 0, occRef: null, freeRef: null, sim: null, byLook: false });

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

// COCO class ids, 0-based (EfficientDet-Lite and SSD MobileNet use the same).
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

// ---------- appearance memory ----------
// Detectors miss cars behind branches. A parked car doesn't vanish without the spot looking
// different, though, so each spot also remembers how it looked when last known taken or free.
// A small grayscale patch of the spot is compared with normalised cross-correlation, which
// ignores overall brightness and contrast changes (clouds, dusk).

export const PATCH = 24;

/** Zero-mean, unit-length grayscale samples over the spot (NaN outside the polygon). */
export type Patch = Float32Array;

/**
 * Samples the spot from an RGB image of `size`×`size` pixels that shows `crop` of the frame.
 * Each cell averages the pixels it covers, which also smooths out thin branches swaying.
 */
export function extractPatch(rgb: ArrayLike<number>, size: number, crop: Rect, pts: Pt[]): Patch | null {
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const cw = (Math.max(...xs) - x0) / PATCH;
  const ch = (Math.max(...ys) - y0) / PATCH;
  const toPx = (v: number, o: number, len: number) => Math.min(size - 1, Math.max(0, Math.floor(((v - o) / len) * size)));
  const out = new Float32Array(PATCH * PATCH).fill(NaN);
  let sum = 0;
  let n = 0;
  for (let j = 0; j < PATCH; j++) {
    for (let i = 0; i < PATCH; i++) {
      const cx = x0 + (i + 0.5) * cw;
      const cy = y0 + (j + 0.5) * ch;
      if (!inPoly(cx, cy, pts)) continue;
      const px0 = toPx(x0 + i * cw, crop.x, crop.w);
      const px1 = Math.max(px0, toPx(x0 + (i + 1) * cw, crop.x, crop.w) - 1);
      const py0 = toPx(y0 + j * ch, crop.y, crop.h);
      const py1 = Math.max(py0, toPx(y0 + (j + 1) * ch, crop.y, crop.h) - 1);
      // At most 6×6 samples per cell keeps this cheap on big spots.
      const sx = Math.max(1, Math.ceil((px1 - px0 + 1) / 6));
      const sy = Math.max(1, Math.ceil((py1 - py0 + 1) / 6));
      let g = 0;
      let k = 0;
      for (let y = py0; y <= py1; y += sy) {
        for (let x = px0; x <= px1; x += sx) {
          const o = (y * size + x) * 3;
          g += 0.299 * rgb[o] + 0.587 * rgb[o + 1] + 0.114 * rgb[o + 2];
          k++;
        }
      }
      const v = g / k;
      out[j * PATCH + i] = v;
      sum += v;
      n++;
    }
  }
  if (n < 8) return null;
  const mean = sum / n;
  let sq = 0;
  for (let q = 0; q < out.length; q++) {
    if (Number.isNaN(out[q])) continue;
    out[q] -= mean;
    sq += out[q] * out[q];
  }
  // A perfectly flat patch (e.g. a white car filling the spot at night) stays all zeros.
  const norm = Math.sqrt(sq);
  if (norm > 1e-3) for (let q = 0; q < out.length; q++) if (!Number.isNaN(out[q])) out[q] /= norm;
  return out;
}

/** Normalised cross-correlation of two patches of the same spot, mapped to 0..1 (1 = identical). */
export function similarity(a: Patch, b: Patch): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let q = 0; q < a.length; q++) {
    const x = a[q];
    const y = b[q];
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na < 1e-9 && nb < 1e-9) return 1; // both flat: same
  if (na < 1e-9 || nb < 1e-9) return 0.5; // one flat: can't tell
  return Math.max(0, Math.min(1, (dot / Math.sqrt(na * nb) + 1) / 2));
}

export type Rules = {
  occ: number;
  confirm: number;
  /** Use appearance memory. */
  memory?: boolean;
  /** A taken spot stays taken while it looks at least this similar to how it looked taken. */
  stillThere?: number;
  /** A free spot counts as taken when it looks less similar than this to how it looked free. */
  changed?: number;
};

// Calibrated on test scenes: same spot with bare branches scores 0.84–0.93, car vs no car 0.43–0.63.
export const MEMORY_DEFAULTS = { stillThere: 0.75, changed: 0.75 };

/** One check for one spot. Returns the new track and the change, if the state flipped. */
export function step(
  track: Track,
  ratio: number,
  rules: Rules,
  now: number,
  patch: Patch | null = null,
): { track: Track; change: { from: SpotState; to: SpotState } | null } {
  const detected: 'free' | 'occupied' = ratio >= rules.occ ? 'occupied' : 'free';
  let reading = detected;
  let sim: number | null = null;
  let byLook = false;
  const mem = rules.memory !== false && patch != null;

  if (mem && detected === 'free') {
    const stillThere = rules.stillThere ?? MEMORY_DEFAULTS.stillThere;
    const changed = rules.changed ?? MEMORY_DEFAULTS.changed;
    if (track.state === 'occupied' && track.occRef) {
      // The detector lost the car. If the spot still looks the same, the car is still there.
      sim = similarity(track.occRef, patch);
      if (sim >= stillThere) {
        reading = 'occupied';
        byLook = true;
      }
    } else if (track.state === 'free' && track.freeRef) {
      // The detector sees nothing, but the spot looks very different from when it was empty.
      sim = similarity(track.freeRef, patch);
      if (sim < changed) {
        reading = 'occupied';
        byLook = true;
      }
    }
  } else if (mem && detected === 'occupied' && track.occRef) {
    sim = similarity(track.occRef, patch);
  }

  const streak = reading === track.cand ? track.streak + 1 : 1;
  let next: Track = { ...track, ratio, cand: reading, streak, sim, byLook };
  let change: { from: SpotState; to: SpotState } | null = null;
  if (streak >= rules.confirm && track.state !== reading) {
    next = { ...next, state: reading, since: now };
    change = { from: track.state, to: reading };
  }

  // Update the memory with what the spot looks like now, but only when the reading agrees
  // with the state, so a car arriving or leaving doesn't overwrite the reference mid-way.
  if (mem && patch) {
    if (next.state === 'occupied' && reading === 'occupied') next.occRef = patch;
    if (next.state === 'free' && reading === 'free') next.freeRef = patch;
    if (change?.to === 'free') next.occRef = null;
  }
  return { track: next, change };
}

/** The user corrects a spot by hand; what it looks like now becomes the reference. */
export function override(track: Track, state: 'free' | 'occupied', now: number, patch: Patch | null, confirm: number): Track {
  return {
    ...track,
    state,
    cand: state,
    streak: confirm,
    since: now,
    occRef: state === 'occupied' ? (patch ?? track.occRef) : null,
    freeRef: state === 'free' ? (patch ?? track.freeRef) : track.freeRef,
    sim: null,
    byLook: false,
  };
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

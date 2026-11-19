import { describe, expect, it } from 'vitest';

import { canAlert, coverage, inPoly, inQuietHours, newTrack, parseDetections, regionOfInterest, samplePoints, step, type Pt } from './spots';

const square: Pt[] = [
  [0.2, 0.2],
  [0.6, 0.2],
  [0.6, 0.6],
  [0.2, 0.6],
];

describe('geometry', () => {
  it('knows inside from outside', () => {
    expect(inPoly(0.4, 0.4, square)).toBe(true);
    expect(inPoly(0.1, 0.4, square)).toBe(false);
  });

  it('samples only inside the polygon', () => {
    const s = samplePoints(square);
    expect(s.length).toBeGreaterThanOrEqual(40);
    expect(s.every(([x, y]) => inPoly(x, y, square))).toBe(true);
  });

  it('measures how much of the spot a car covers', () => {
    const s = samplePoints(square);
    expect(coverage(s, [])).toBe(0);
    const full = coverage(s, [{ x: 0, y: 0, w: 1, h: 1, score: 1, label: 'car' }]);
    expect(full).toBe(1);
    const left = coverage(s, [{ x: 0.2, y: 0.2, w: 0.2, h: 0.4, score: 1, label: 'car' }]);
    expect(left).toBeGreaterThan(0.4);
    expect(left).toBeLessThan(0.6);
  });

  it('crops around the spots with a margin, inside the frame', () => {
    const r = regionOfInterest([{ pts: square }]);
    expect(r.x).toBeCloseTo(0.12);
    expect(r.y).toBeCloseTo(0.12);
    expect(r.w).toBeCloseTo(0.56);
    expect(regionOfInterest([])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const edge = regionOfInterest([{ pts: [[0, 0], [1, 0], [1, 1]] }]);
    expect(edge).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('parseDetections', () => {
  it('keeps confident vehicles and maps them from the crop to the frame', () => {
    const crop = { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    const out = {
      // car, person, low-score truck
      boxes: [0, 0, 1, 0.5, 0, 0, 1, 1, 0, 0, 1, 1],
      classes: [2, 0, 7],
      scores: [0.9, 0.95, 0.2],
      count: 3,
    };
    const boxes = parseDetections(out, crop, 0.4);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x: 0.5, y: 0.5, w: 0.25, h: 0.5, label: 'car' });
  });
});

describe('step', () => {
  const rules = { occ: 0.3, confirm: 3 };

  it('only flips after enough checks in a row', () => {
    let t = newTrack();
    let r = step(t, 0.1, rules, 1);
    expect(r.change).toBeNull();
    r = step(r.track, 0.1, rules, 2);
    expect(r.change).toBeNull();
    r = step(r.track, 0.1, rules, 3);
    expect(r.change).toEqual({ from: 'unknown', to: 'free' });
    expect(r.track.since).toBe(3);
    t = r.track;
    // a passing car for one check does not count
    r = step(t, 0.9, rules, 4);
    r = step(r.track, 0.1, rules, 5);
    expect(r.change).toBeNull();
    expect(r.track.state).toBe('free');
  });

  it('reports a car parking', () => {
    let r: ReturnType<typeof step> = { track: { ...newTrack(), state: 'free' }, change: null };
    for (let i = 0; i < 3; i++) r = step(r.track, 0.8, rules, i);
    expect(r.change).toEqual({ from: 'free', to: 'occupied' });
  });
});

describe('alert rules', () => {
  it('respects quiet hours, including over midnight', () => {
    const at = (h: number) => new Date(2026, 10, 19, h, 30);
    expect(inQuietHours(22, 7, at(23))).toBe(true);
    expect(inQuietHours(22, 7, at(6))).toBe(true);
    expect(inQuietHours(22, 7, at(12))).toBe(false);
    expect(inQuietHours(12, 14, at(13))).toBe(true);
    expect(inQuietHours(null, 7, at(3))).toBe(false);
  });

  it('waits out the cooldown', () => {
    const t = { ...newTrack(), lastAlert: 0 };
    expect(canAlert(t, 10, 9 * 60_000)).toBe(false);
    expect(canAlert(t, 10, 10 * 60_000)).toBe(true);
  });
});

// The watch loop: every few seconds take a silent still, detect vehicles, update each spot,
// and send an alert when one frees up. Runs while the app is open with the screen on.

import type { CameraView } from 'expo-camera';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { detectVehicles, type Look } from './detector';
import { sendAlert } from './ntfy';
import { canAlert, coverage, inQuietHours, newTrack, override, regionOfInterest, samplePoints, step, type Box, type Patch, type Spot, type Track } from './spots';
import { getSettings } from './store';

const KEEP_AWAKE = 'parkwatch-watch';

// Native errors can carry a whole Java stack trace; the first line is the useful part.
const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200);

export type LogLine = { at: number; text: string };

export function useWatcher(camera: RefObject<CameraView | null>, spots: Spot[]) {
  const [watching, setWatching] = useState(false);
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  const tracksRef = useRef<Record<string, Track>>({});
  const busy = useRef(false);
  const lastPatches = useRef<Record<string, Patch | null>>({});

  const samples = Object.fromEntries(spots.map((s) => [s.id, samplePoints(s.pts)]));

  const note = (text: string) => setLog((l) => [{ at: Date.now(), text }, ...l].slice(0, 60));

  /** One look at the street: a still, cropped to the spots, through the detector. */
  async function look(): Promise<Look> {
    const cam = camera.current;
    if (!cam) throw new Error('Camera not ready');
    const photo = await cam.takePictureAsync({ quality: 0.6, shutterSound: false });
    if (!photo) throw new Error('No picture');
    return detectVehicles(photo, regionOfInterest(spots), getSettings().minScore, spots);
  }

  async function runCheck() {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const { boxes: found, patches } = await look();
      lastPatches.current = patches;
      const s = getSettings();
      const now = Date.now();
      const next: Record<string, Track> = {};
      const changes: { spot: Spot; to: Track['state']; from: Track['state'] }[] = [];
      for (const spot of spots) {
        const r = step(tracksRef.current[spot.id] ?? newTrack(), coverage(samples[spot.id] ?? [], found), { occ: s.occ, confirm: s.confirm, memory: s.memory, stillThere: s.lookSame, changed: s.lookSame }, now, patches[spot.id] ?? null);
        next[spot.id] = r.track;
        if (r.change) changes.push({ spot, ...r.change });
      }
      const freeCount = spots.filter((sp) => next[sp.id]?.state === 'free').length;
      for (const c of changes) {
        const t = next[c.spot.id];
        note(`${c.spot.name}: ${c.to === 'free' ? 'free' : 'taken'} (${t.byLook ? `by look, ${Math.round((t.sim ?? 0) * 100)}% alike` : `${Math.round(t.ratio * 100)}% covered`})`);
        if (c.to === 'free') {
          if (!canAlert(t, s.cooldown, now)) note(`${c.spot.name}: no alert, cooldown`);
          else if (inQuietHours(s.quietFrom, s.quietTo, new Date(now))) note(`${c.spot.name}: no alert, quiet hours`);
          else {
            next[c.spot.id] = { ...t, lastAlert: now };
            const res = await sendAlert(`${c.spot.name} is ${c.from === 'unknown' ? 'free' : 'now free'} (${freeCount}/${spots.length} free)`, 'high', 'car');
            note(res.ok ? `Alert sent for ${c.spot.name}` : `Alert failed: ${res.error}`);
          }
        } else if (c.from === 'free' && s.notifyTaken && !inQuietHours(s.quietFrom, s.quietTo, new Date(now))) {
          await sendAlert(`${c.spot.name} was just taken (${freeCount}/${spots.length} free)`, 'low', 'red_circle');
        }
      }
      tracksRef.current = next;
      setTracks(next);
      setBoxes(found);
      setLastCheck(now);
    } catch (e) {
      note(`Check failed: ${firstLine(e)}`);
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  // The loop always calls the latest runCheck (spots or settings may change while watching).
  const latest = useRef(runCheck);
  useEffect(() => {
    latest.current = runCheck;
  });

  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        const started = Date.now();
        await latest.current();
        const wait = Math.max(1000, getSettings().interval * 1000 - (Date.now() - started));
        const until = Date.now() + wait;
        while (!cancelled && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watching]);

  async function start() {
    tracksRef.current = {};
    setTracks({});
    setBoxes([]);
    setLastCheck(null);
    await activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
    note(`Watching ${spots.length} spot${spots.length === 1 ? '' : 's'} every ${getSettings().interval}s`);
    setWatching(true);
  }

  function stop() {
    setWatching(false);
    deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
    note('Stopped watching');
  }

  /** A single detection to check the camera angle; draws the boxes but changes no state. */
  async function test() {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const { boxes: found, patches } = await look();
      lastPatches.current = patches;
      setBoxes(found);
      note(`Test: ${found.length} vehicle${found.length === 1 ? '' : 's'} seen`);
      return found;
    } catch (e) {
      note(`Test failed: ${firstLine(e)}`);
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  /** The user corrects a spot. What it looks like right now becomes its reference. */
  function mark(spot: Spot, state: 'free' | 'occupied') {
    const t = override(tracksRef.current[spot.id] ?? newTrack(), state, Date.now(), lastPatches.current[spot.id] ?? null, getSettings().confirm);
    tracksRef.current = { ...tracksRef.current, [spot.id]: t };
    setTracks(tracksRef.current);
    note(`${spot.name}: marked ${state === 'free' ? 'free' : 'taken'} by you`);
  }

  useEffect(() => () => void deactivateKeepAwake(KEEP_AWAKE).catch(() => {}), []);

  return { watching, tracks, boxes, lastCheck, checking, log, start, stop, test, mark, clearBoxes: () => setBoxes([]) };
}

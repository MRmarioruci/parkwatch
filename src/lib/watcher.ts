// The watch loop: every few seconds take a silent still, detect vehicles, update each spot,
// and send an alert when one frees up. Runs while the app is open with the screen on.

import type { CameraView } from 'expo-camera';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { AI_MODELS, askClaude, type AiReading } from './ai';
import { detectVehicles, snapshotForAi, type Look } from './detector';
import { sendAlert } from './ntfy';
import { canAlert, coverage, inQuietHours, newTrack, override, regionOfInterest, samplePoints, step, type Box, type Patch, type Spot, type Track } from './spots';
import { getApiKey } from './secrets';
import { getSettings, recordAiCall, usageToday } from './store';

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
  const warnedFallback = useRef('');

  const samples = Object.fromEntries(spots.map((s) => [s.id, samplePoints(s.pts)]));

  const note = (text: string) => setLog((l) => [{ at: Date.now(), text }, ...l].slice(0, 60));

  /** Whether this check goes to Claude: AI on, a key set, and today's cap not reached. */
  function aiActive(): { on: boolean; why?: string } {
    const s = getSettings();
    if (!s.useAI) return { on: false };
    if (!getApiKey()) return { on: false, why: 'no API key' };
    if (usageToday(s).calls >= s.aiCap) return { on: false, why: `daily cap of ${s.aiCap} reached` };
    return { on: true };
  }

  async function photo() {
    const cam = camera.current;
    if (!cam) throw new Error('Camera not ready');
    const p = await cam.takePictureAsync({ quality: 0.7, shutterSound: false });
    if (!p) throw new Error('No picture');
    return p;
  }

  /** One look with the on-phone detector. */
  async function look(): Promise<Look> {
    return detectVehicles(await photo(), regionOfInterest(spots), getSettings().minScore, spots);
  }

  /** One look by Claude. Readings are per spot, in order; null = unsure / not reported. */
  async function askAi(): Promise<{ readings: (AiReading | null)[]; cost: number }> {
    const s = getSettings();
    const snap = await snapshotForAi(await photo(), regionOfInterest(spots), spots);
    const r = await askClaude(getApiKey()!, s.aiModel, snap.b64, spots.length);
    recordAiCall(r.cost);
    const readings = spots.map((_, k) => r.readings.find((x) => Number(x.space) === k + 1) ?? null);
    return { readings, cost: r.cost };
  }

  const describe = (r: AiReading | null) => (r ? `${r.state}${r.reason ? `: ${r.reason}` : ''}` : 'no answer');


  async function runCheck() {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const s = getSettings();
      const now = Date.now();
      const next: Record<string, Track> = {};
      const changes: { spot: Spot; to: Track['state']; from: Track['state'] }[] = [];
      const ai = aiActive();

      if (ai.on) {
        const { readings } = await askAi();
        spots.forEach((spot, k) => {
          const prev = tracksRef.current[spot.id] ?? newTrack();
          const r = readings[k];
          if (!r || r.state === 'unsure') {
            next[spot.id] = { ...prev, reason: r ? describe(r) : prev.reason };
            return;
          }
          const res = step(prev, r.state === 'taken' ? 1 : 0, { occ: 0.5, confirm: s.aiConfirm, memory: false }, now);
          next[spot.id] = { ...res.track, reason: describe(r) };
          if (res.change) changes.push({ spot, ...res.change });
        });
        setBoxes([]);
      } else {
        if (s.useAI && ai.why && warnedFallback.current !== ai.why) {
          note(`AI check off (${ai.why}), using the on-phone detector`);
          warnedFallback.current = ai.why;
        }
        const { boxes: found, patches } = await look();
        lastPatches.current = patches;
        for (const spot of spots) {
          const r = step(tracksRef.current[spot.id] ?? newTrack(), coverage(samples[spot.id] ?? [], found), { occ: s.occ, confirm: s.confirm, memory: s.memory, stillThere: s.lookSame, changed: s.lookSame }, now, patches[spot.id] ?? null);
          next[spot.id] = { ...r.track, reason: null };
          if (r.change) changes.push({ spot, ...r.change });
        }
        setBoxes(found);
      }

      const freeCount = spots.filter((sp) => next[sp.id]?.state === 'free').length;
      for (const c of changes) {
        const t = next[c.spot.id];
        const why = t.reason ?? (t.byLook ? `by look, ${Math.round((t.sim ?? 0) * 100)}% alike` : `${Math.round(t.ratio * 100)}% covered`);
        note(`${c.spot.name}: ${c.to === 'free' ? 'free' : 'taken'} (${why})`);
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
        const st = getSettings();
        const every = aiActive().on ? st.aiInterval : st.interval;
        const wait = Math.max(1000, every * 1000 - (Date.now() - started));
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
    const s = getSettings();
    const ai = aiActive();
    warnedFallback.current = '';
    note(`Watching ${spots.length} spot${spots.length === 1 ? '' : 's'} ${ai.on ? `with ${AI_MODELS[s.aiModel]?.label ?? 'Claude'}, every ${s.aiInterval}s` : `on the phone, every ${s.interval}s`}`);
    setWatching(true);
  }

  function stop() {
    setWatching(false);
    deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
    note('Stopped watching');
  }

  /** A single check to try the setup; shows what was seen but changes no state. Returns a summary. */
  async function test(): Promise<string | undefined> {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      if (aiActive().on) {
        const { readings, cost } = await askAi();
        setBoxes([]);
        const next = { ...tracksRef.current };
        spots.forEach((spot, k) => {
          next[spot.id] = { ...(next[spot.id] ?? newTrack()), reason: describe(readings[k]) };
          note(`Test · ${spot.name}: ${describe(readings[k])}`);
        });
        tracksRef.current = next;
        setTracks(next);
        const free = readings.filter((r) => r?.state === 'free').length;
        return `Claude: ${free} of ${spots.length} free · cost $${cost.toFixed(4)}. Details under Spots.`;
      }
      const { boxes: found, patches } = await look();
      lastPatches.current = patches;
      setBoxes(found);
      note(`Test: ${found.length} vehicle${found.length === 1 ? '' : 's'} seen`);
      return found.length ? `Sees ${found.length} vehicle${found.length > 1 ? 's' : ''}. The blue corners should sit on the cars.` : 'No vehicles seen around your spots';
    } catch (e) {
      note(`Test failed: ${firstLine(e)}`);
      return `Test failed: ${firstLine(e)}`;
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

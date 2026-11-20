// Settings and marked spots, kept in SQLite (same pattern as due) and exposed as hooks.

import * as SQLite from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import type { AiModel } from './ai';
import type { Spot } from './spots';

export type Settings = {
  /** ntfy server and topic the alerts are posted to. */
  server: string;
  topic: string;
  /** Seconds between checks. */
  interval: number;
  /** Detector confidence needed to count a vehicle (0..1). */
  minScore: number;
  /** A spot is taken when vehicles cover at least this share of it (0..1). */
  occ: number;
  /** Checks in a row before a spot changes state. */
  confirm: number;
  /** Minutes between two "free" alerts for the same spot. */
  cooldown: number;
  /** No alerts between these hours; null = off. */
  quietFrom: number | null;
  quietTo: number | null;
  /** Also alert when a free spot gets taken. */
  notifyTaken: boolean;
  /** Show the live camera image (the camera runs either way). */
  showPreview: boolean;
  /** Draw detected vehicles on the preview. */
  showBoxes: boolean;
  /** Camera fills the screen (edges cropped) instead of showing the whole frame. */
  camFill: boolean;
  /** Remember how each spot looks, to keep counting cars the detector loses behind branches. */
  memory: boolean;
  /** How alike (0..1) the spot must look to count as unchanged. */
  lookSame: number;
  /** Ask Claude to judge the spots (needs an API key) instead of the on-phone detector. */
  useAI: boolean;
  aiModel: AiModel;
  /** Seconds between AI checks, checks in a row before a change, and max AI checks per day. */
  aiInterval: number;
  aiConfirm: number;
  aiCap: number;
  /** AI checks and spend for one day (local date). */
  usage: { day: string; calls: number; cost: number };
  spots: Spot[];
};

const DEFAULTS: Settings = {
  server: 'https://ntfy.sh',
  topic: '',
  interval: 15,
  minScore: 0.25,
  occ: 0.3,
  confirm: 3,
  cooldown: 10,
  quietFrom: null,
  quietTo: null,
  notifyTaken: false,
  showPreview: true,
  showBoxes: true,
  camFill: true,
  memory: true,
  lookSame: 0.75,
  useAI: true,
  aiModel: 'claude-haiku-5-5',
  aiInterval: 60,
  aiConfirm: 2,
  aiCap: 600,
  usage: { day: '', calls: 0, cost: 0 },
  spots: [],
};

const db = SQLite.openDatabaseSync('parkwatch.db');
db.execSync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');

function load(): Settings {
  const rows = db.getAllSync<{ key: string; value: string }>('SELECT key, value FROM kv');
  const stored: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {}
  }
  return { ...DEFAULTS, ...stored } as Settings;
}

let snapshot = load();
const listeners = new Set<() => void>();

export const getSettings = () => snapshot;

export function updateSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    db.runSync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Today's AI usage (zero if the stored figures are from another day). */
export function usageToday(s: Settings = snapshot) {
  return s.usage.day === today() ? s.usage : { day: today(), calls: 0, cost: 0 };
}

export function recordAiCall(cost: number) {
  const u = usageToday();
  updateSettings({ usage: { day: u.day, calls: u.calls + 1, cost: u.cost + cost } });
}

// Settings and marked spots, kept in SQLite (same pattern as due) and exposed as hooks.

import * as SQLite from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

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
  spots: Spot[];
};

const DEFAULTS: Settings = {
  server: 'https://ntfy.sh',
  topic: '',
  interval: 15,
  minScore: 0.4,
  occ: 0.3,
  confirm: 3,
  cooldown: 10,
  quietFrom: null,
  quietTo: null,
  notifyTaken: false,
  showPreview: true,
  showBoxes: true,
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

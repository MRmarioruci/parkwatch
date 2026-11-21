// API keys live in the OS keystore, one per provider, not in the app database.

import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import type { Provider } from './ai';

// The Claude key keeps its original name so existing installs don't lose it.
const NAMES: Record<Provider, string> = { anthropic: 'anthropic-api-key', google: 'google-api-key', openai: 'openai-api-key' };

let keys: Record<Provider, string | null> = { anthropic: null, google: null, openai: null };
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadApiKeys() {
  const next = { ...keys };
  for (const p of Object.keys(NAMES) as Provider[]) {
    try {
      next[p] = await SecureStore.getItemAsync(NAMES[p]);
    } catch {
      next[p] = null;
    }
  }
  keys = next;
  loaded = true;
  emit();
}

export const getApiKey = (p: Provider) => keys[p];
const getKeys = () => keys;

export async function setApiKey(p: Provider, value: string | null) {
  const v = value?.trim() || null;
  if (v) await SecureStore.setItemAsync(NAMES[p], v);
  else await SecureStore.deleteItemAsync(NAMES[p]);
  keys = { ...keys, [p]: v };
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (!loaded) loadApiKeys();
  return () => {
    listeners.delete(l);
  };
};

/** The key for one provider (null if none). */
export function useApiKey(p: Provider): string | null {
  return useSyncExternalStore(subscribe, getKeys)[p];
}

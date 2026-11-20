// The Anthropic API key lives in the OS keystore, not in the app database.

import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

const KEY = 'anthropic-api-key';

let apiKey: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadApiKey() {
  try {
    apiKey = await SecureStore.getItemAsync(KEY);
  } catch {
    apiKey = null;
  }
  loaded = true;
  emit();
}

export const getApiKey = () => apiKey;

export async function setApiKey(value: string | null) {
  const v = value?.trim() || null;
  if (v) await SecureStore.setItemAsync(KEY, v);
  else await SecureStore.deleteItemAsync(KEY);
  apiKey = v;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (!loaded) loadApiKey();
  return () => {
    listeners.delete(l);
  };
};

export function useApiKey(): string | null {
  return useSyncExternalStore(subscribe, getApiKey);
}

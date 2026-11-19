// Alerts go to the ntfy app on your own phone: a plain HTTP POST of the message text.

import { getSettings } from './store';

export type Priority = 'min' | 'low' | 'default' | 'high' | 'max';

export async function sendAlert(message: string, priority: Priority = 'default', tags = 'car'): Promise<{ ok: boolean; error?: string }> {
  const { server, topic } = getSettings();
  if (!topic.trim()) return { ok: false, error: 'No ntfy topic set' };
  const base = (server.trim() || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${base}/${encodeURIComponent(topic.trim())}?title=${encodeURIComponent('Blue zone parking')}&priority=${priority}&tags=${encodeURIComponent(tags)}`;
  try {
    const r = await fetch(url, { method: 'POST', body: message });
    return r.ok ? { ok: true } : { ok: false, error: `ntfy answered ${r.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

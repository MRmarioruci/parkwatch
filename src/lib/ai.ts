// "AI check": send a scaled-down view of the parking strip, with the marked spaces drawn on it,
// to a vision model (Claude, Gemini or ChatGPT) and ask which spaces are free. Unlike the
// on-phone detector, a large vision model can tell a car is there from a roof or a wheel
// showing between branches.

import { Buffer } from 'buffer';
import * as jpeg from 'jpeg-js';

import type { Pt, Rect, Spot } from './spots';

// jpeg-js's encoder returns a Node Buffer, which React Native doesn't have.
const g = globalThis as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;

export type Provider = 'anthropic' | 'google' | 'openai';

export const PROVIDERS: Record<Provider, { label: string; short: string; keyHint: string; keyPlaceholder: string; console: string }> = {
  anthropic: { label: 'Claude', short: 'Claude', keyHint: 'From console.anthropic.com', keyPlaceholder: 'sk-ant-…', console: 'console.anthropic.com' },
  google: { label: 'Gemini', short: 'Gemini', keyHint: 'From aistudio.google.com', keyPlaceholder: 'AIza…', console: 'aistudio.google.com' },
  openai: { label: 'ChatGPT', short: 'ChatGPT', keyHint: 'From platform.openai.com', keyPlaceholder: 'sk-…', console: 'platform.openai.com' },
};

/**
 * Suggested models per provider, with list prices (USD per million tokens, November 2026).
 * Any other model id can be typed in Settings; its cost then shows as unknown.
 */
export const PRESETS: Record<Provider, { id: string; label: string; inPerM: number; outPerM: number }[]> = {
  anthropic: [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', inPerM: 0.1, outPerM: 0.5 },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', inPerM: 2, outPerM: 10 },
  ],
  google: [
    { id: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite', inPerM: 0.25, outPerM: 1.5 },
    { id: 'gemini-3-flash-preview', label: '3 Flash', inPerM: 0.5, outPerM: 3 },
  ],
  openai: [
    { id: 'gpt-5.4-nano', label: '5.4 nano', inPerM: 0.2, outPerM: 1.25 },
    { id: 'gpt-5.4-mini', label: '5.4 mini', inPerM: 0.75, outPerM: 4.5 },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = { anthropic: 'claude-haiku-5-5', google: 'gemini-3.1-flash-lite', openai: 'gpt-5.4-mini' };

export function priceOf(model: string): { inPerM: number; outPerM: number } | null {
  for (const list of Object.values(PRESETS)) {
    const hit = list.find((m) => m.id === model);
    if (hit) return hit;
  }
  return null;
}

export const modelLabel = (provider: Provider, model: string) => {
  const preset = PRESETS[provider].find((m) => m.id === model);
  return `${PROVIDERS[provider].label} ${preset?.label ?? model}`;
};

/** Longest side of the image sent. Big enough to judge cars, small enough that plates blur. */
export const AI_LONG_SIDE = 1064;

export type AiReading = { space: number; state: 'free' | 'taken' | 'unsure'; confidence?: number; reason?: string };
/** cost is null when the model's price isn't known. */
export type AiResult = { readings: AiReading[]; inTokens: number; outTokens: number; cost: number | null };

// ---------- drawing the spaces onto the picture ----------

// 3×5 bitmap digits.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

const OUTLINE: [number, number, number] = [255, 0, 255];

function put(rgb: Uint8Array, w: number, h: number, x: number, y: number, c: [number, number, number]) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const o = (y * w + x) * 3;
  rgb[o] = c[0];
  rgb[o + 1] = c[1];
  rgb[o + 2] = c[2];
}

function rect(rgb: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) put(rgb, w, h, x, y, c);
}

function line(rgb: Uint8Array, w: number, h: number, a: Pt, b: Pt, t: number, c: [number, number, number]) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n;
    const y = a[1] + ((b[1] - a[1]) * i) / n;
    rect(rgb, w, h, x - t / 2, y - t / 2, x + t / 2, y + t / 2, c);
  }
}

function label(rgb: Uint8Array, w: number, h: number, text: string, cx: number, cy: number) {
  const s = Math.max(3, Math.round(Math.min(w, h) / 110)); // pixel size of one font dot
  const gw = 3 * s;
  const gap = s;
  const tw = text.length * gw + (text.length - 1) * gap;
  const pad = s * 1.5;
  const x0 = Math.round(Math.min(w - tw - pad * 2, Math.max(0, cx - tw / 2 - pad)));
  const y0 = Math.round(Math.min(h - 5 * s - pad * 2, Math.max(0, cy - (5 * s) / 2 - pad)));
  rect(rgb, w, h, x0 - 2, y0 - 2, x0 + tw + pad * 2 + 2, y0 + 5 * s + pad * 2 + 2, OUTLINE);
  rect(rgb, w, h, x0, y0, x0 + tw + pad * 2, y0 + 5 * s + pad * 2, [0, 0, 0]);
  [...text].forEach((ch, k) => {
    const bits = DIGITS[Number(ch)] ?? DIGITS[0];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (bits[r * 3 + q] === '1') rect(rgb, w, h, x0 + pad + k * (gw + gap) + q * s, y0 + pad + r * s, x0 + pad + k * (gw + gap) + (q + 1) * s, y0 + pad + (r + 1) * s, [255, 255, 255]);
  });
}

/** Outlines each space in magenta and numbers it 1..n, in place. `crop` is what the image shows. */
export function annotate(rgb: Uint8Array, w: number, h: number, crop: Rect, spots: Spot[]) {
  const px = (p: Pt): Pt => [((p[0] - crop.x) / crop.w) * w, ((p[1] - crop.y) / crop.h) * h];
  const t = Math.max(2, Math.round(Math.min(w, h) / 260));
  spots.forEach((s) => {
    const pts = s.pts.map(px);
    pts.forEach((p, i) => line(rgb, w, h, p, pts[(i + 1) % pts.length], t, OUTLINE));
  });
  spots.forEach((s, k) => {
    const pts = s.pts.map(px);
    // Label near the space's top edge so it hides as little of the car as possible.
    const top = pts.reduce((a, p) => (p[1] < a[1] ? p : a), pts[0]);
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    label(rgb, w, h, String(k + 1), (cx + top[0]) / 2, top[1] + (pts.reduce((a, p) => a + p[1], 0) / pts.length - top[1]) * 0.3);
  });
}

export function toJpegBase64(rgb: Uint8Array, w: number, h: number, quality = 82): string {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i];
    rgba[j + 1] = rgb[i + 1];
    rgba[j + 2] = rgb[i + 2];
    rgba[j + 3] = 255;
  }
  const out = jpeg.encode({ width: w, height: h, data: rgba }, quality);
  return Buffer.from(out.data).toString('base64');
}

// ---------- asking the model ----------

const SYSTEM = `You watch a residential street from a balcony to find free parking spaces.
The image shows the street with parking spaces outlined in magenta and labelled with white numbers on black.
For each numbered space, decide whether a vehicle occupies it.
Cars are often partly hidden behind branches, bushes, railings or other cars. Use any visible part (roof, window, wheel, bumper, mirror, paint colour) and the context of the row of parked cars to infer a car that is only partly visible.
A space is "free" only if there is no vehicle in it and a car could park there now. A car parked across two outlined spaces makes both taken.
Use "unsure" only when the space is hidden so much that you cannot reasonably infer either way.`;

const ask = (spaces: number) => `There ${spaces === 1 ? 'is 1 numbered space' : `are ${spaces} numbered spaces (1 to ${spaces})`}. Report each one.`;

const DESCR = {
  space: 'The number shown on the space',
  confidence: '0 to 1',
  reason: 'What you see, at most 12 words',
};

/** JSON Schema of the answer (Claude tool input, OpenAI strict schema). */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    spaces: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          space: { type: 'integer', description: DESCR.space },
          state: { type: 'string', enum: ['free', 'taken', 'unsure'] },
          confidence: { type: 'number', description: DESCR.confidence },
          reason: { type: 'string', description: DESCR.reason },
        },
        required: ['space', 'state', 'confidence', 'reason'],
      },
    },
  },
  required: ['spaces'],
};

/** The same answer in Gemini's schema dialect (OpenAPI subset, upper-case types). */
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    spaces: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          space: { type: 'INTEGER', description: DESCR.space },
          state: { type: 'STRING', enum: ['free', 'taken', 'unsure'] },
          confidence: { type: 'NUMBER', description: DESCR.confidence },
          reason: { type: 'STRING', description: DESCR.reason },
        },
        required: ['space', 'state', 'reason'],
      },
    },
  },
  required: ['spaces'],
};

type Raw = { spaces: unknown; inTokens: number; outTokens: number };

async function post(url: string, headers: Record<string, string>, body: unknown, who: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message ?? (Array.isArray(json) ? json[0]?.error?.message : undefined);
      throw new Error(msg ? `${who}: ${msg}` : `${who} answered ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
}

async function askAnthropic(key: string, model: string, img: string, spaces: number): Promise<Raw> {
  const body = await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    {
      model,
      max_tokens: 200 + spaces * 60,
      system: SYSTEM,
      tools: [{ name: 'report_spaces', description: 'Report whether each numbered parking space is free or taken.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'report_spaces' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } },
            { type: 'text', text: ask(spaces) },
          ],
        },
      ],
    },
    'Claude',
  );
  const use = (body?.content ?? []).find((b: { type: string }) => b.type === 'tool_use');
  return { spaces: use?.input?.spaces, inTokens: Number(body?.usage?.input_tokens ?? 0), outTokens: Number(body?.usage?.output_tokens ?? 0) };
}

async function askGoogle(key: string, model: string, img: string, spaces: number): Promise<Raw> {
  const body = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: img } }, { text: ask(spaces) }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0.2 },
    },
    'Gemini',
  );
  const parts: { text?: string; thought?: boolean }[] = body?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  const u = body?.usageMetadata ?? {};
  // Thinking tokens are billed as output.
  return { spaces: (parseJson(text) as { spaces?: unknown } | null)?.spaces, inTokens: Number(u.promptTokenCount ?? 0), outTokens: Number(u.candidatesTokenCount ?? 0) + Number(u.thoughtsTokenCount ?? 0) };
}

async function askOpenAI(key: string, model: string, img: string, spaces: number): Promise<Raw> {
  const body = await post(
    'https://api.openai.com/v1/chat/completions',
    { authorization: `Bearer ${key}` },
    {
      model,
      max_completion_tokens: 4000,
      response_format: { type: 'json_schema', json_schema: { name: 'report_spaces', strict: true, schema: SCHEMA } },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: ask(spaces) },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}`, detail: 'high' } },
          ],
        },
      ],
    },
    'ChatGPT',
  );
  const msg = body?.choices?.[0]?.message;
  if (msg?.refusal) throw new Error(`ChatGPT: ${msg.refusal}`);
  return { spaces: (parseJson(msg?.content) as { spaces?: unknown } | null)?.spaces, inTokens: Number(body?.usage?.prompt_tokens ?? 0), outTokens: Number(body?.usage?.completion_tokens ?? 0) };
}

/** Ask the chosen provider which numbered spaces in the (annotated) image are free. */
export async function askModel(provider: Provider, apiKey: string, model: string, imageB64: string, spaces: number): Promise<AiResult> {
  const fn = provider === 'google' ? askGoogle : provider === 'openai' ? askOpenAI : askAnthropic;
  const raw = await fn(apiKey, model, imageB64, spaces);
  const readings: AiReading[] = Array.isArray(raw.spaces) ? (raw.spaces as AiReading[]) : [];
  if (!readings.length) throw new Error(`${PROVIDERS[provider].label} gave no usable answer`);
  const price = priceOf(model);
  return { readings, inTokens: raw.inTokens, outTokens: raw.outTokens, cost: price ? (raw.inTokens * price.inPerM + raw.outTokens * price.outPerM) / 1e6 : null };
}

/** Output size for a region, keeping its proportions. */
export function aiSize(w: number, h: number, long = AI_LONG_SIDE): { w: number; h: number } {
  const k = Math.min(1, long / Math.max(w, h));
  return { w: Math.max(28, Math.round(w * k)), h: Math.max(28, Math.round(h * k)) };
}

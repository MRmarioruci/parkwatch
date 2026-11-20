import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiSize, annotate, askClaude, toJpegBase64 } from './ai';

describe('aiSize', () => {
  it('keeps proportions and caps the long side', () => {
    expect(aiSize(3000, 1500)).toEqual({ w: 1064, h: 532 });
    expect(aiSize(600, 400)).toEqual({ w: 600, h: 400 });
  });
});

describe('annotate', () => {
  it('outlines and numbers the spaces', () => {
    const w = 200;
    const h = 100;
    const rgb = new Uint8Array(w * h * 3).fill(128);
    annotate(rgb, w, h, { x: 0, y: 0, w: 1, h: 1 }, [{ id: 'a', name: 'A', pts: [[0.1, 0.2], [0.5, 0.2], [0.5, 0.8], [0.1, 0.8]] }]);
    const at = (x: number, y: number) => Array.from(rgb.slice((y * w + x) * 3, (y * w + x) * 3 + 3));
    expect(at(60, 20)).toEqual([255, 0, 255]); // top edge
    expect(at(150, 50)).toEqual([128, 128, 128]); // untouched outside
    // a white label pixel exists somewhere
    let white = false;
    for (let i = 0; i < rgb.length; i += 3) if (rgb[i] === 255 && rgb[i + 1] === 255 && rgb[i + 2] === 255) white = true;
    expect(white).toBe(true);
  });

  it('encodes to a JPEG', () => {
    const b64 = toJpegBase64(new Uint8Array(16 * 8 * 3).fill(90), 16, 8);
    expect(Buffer.from(b64, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });
});

describe('askClaude', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the image with a forced tool call and reads the answer and cost', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'report_spaces', input: { spaces: [{ space: 1, state: 'taken', reason: 'silver roof behind branches' }, { space: 2, state: 'free', reason: 'empty asphalt' }] } }],
        usage: { input_tokens: 1000, output_tokens: 100 },
      }),
    }));
    vi.stubGlobal('fetch', fetch);
    const r = await askClaude('sk-test', 'claude-haiku-5-5', 'AAAA', 2);
    expect(r.readings.map((x) => x.state)).toEqual(['taken', 'free']);
    expect(r.cost).toBeCloseTo((1000 * 0.1 + 100 * 0.5) / 1e6);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_spaces' });
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  });

  it('surfaces API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) })));
    await expect(askClaude('bad', 'claude-haiku-5-5', 'AAAA', 1)).rejects.toThrow('Claude: invalid x-api-key');
  });
});

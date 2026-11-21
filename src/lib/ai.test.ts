import { Buffer } from 'buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiSize, annotate, askModel, toJpegBase64 } from './ai';

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

describe('askModel', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = { spaces: [{ space: 1, state: 'taken', confidence: 0.9, reason: 'silver roof behind branches' }, { space: 2, state: 'free', confidence: 0.8, reason: 'empty asphalt' }] };
  const stub = (json: unknown, ok = true, status = 200) => {
    const fetch = vi.fn(async (..._args: unknown[]) => ({ ok, status, json: async () => json }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const sent = (fetch: ReturnType<typeof stub>) => {
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    return { url, headers: init.headers, body: JSON.parse(init.body) };
  };

  it('Claude: forced tool call, image block, cost from usage', async () => {
    const fetch = stub({ content: [{ type: 'tool_use', name: 'report_spaces', input: answer }], usage: { input_tokens: 1000, output_tokens: 100 } });
    const r = await askModel('anthropic', 'sk-test', 'claude-haiku-5-5', 'AAAA', 2);
    expect(r.readings.map((x) => x.state)).toEqual(['taken', 'free']);
    expect(r.cost).toBeCloseTo((1000 * 0.1 + 100 * 0.5) / 1e6);
    const { url, headers, body } = sent(fetch);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-test');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_spaces' });
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  });

  it('Gemini: JSON response schema, inline image, thinking billed as output', async () => {
    const fetch = stub({
      candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(answer) }] } }],
      usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 60, thoughtsTokenCount: 40 },
    });
    const r = await askModel('google', 'AIza-test', 'gemini-3.1-flash-lite', 'AAAA', 2);
    expect(r.readings).toHaveLength(2);
    expect(r.outTokens).toBe(100);
    expect(r.cost).toBeCloseTo((800 * 0.25 + 100 * 1.5) / 1e6);
    const { url, headers, body } = sent(fetch);
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
    expect(headers['x-goog-api-key']).toBe('AIza-test');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } });
  });

  it('ChatGPT: strict JSON schema, data-URL image, bearer key', async () => {
    const fetch = stub({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 900, completion_tokens: 80 } });
    const r = await askModel('openai', 'sk-oa', 'gpt-5.4-mini', 'AAAA', 2);
    expect(r.readings[1].state).toBe('free');
    expect(r.cost).toBeCloseTo((900 * 0.75 + 80 * 4.5) / 1e6);
    const { url, headers, body } = sent(fetch);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer sk-oa');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,AAAA');
  });

  it('a model without a known price reports no cost', async () => {
    stub({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 900, completion_tokens: 80 } });
    expect((await askModel('openai', 'k', 'some-future-model', 'AAAA', 2)).cost).toBeNull();
  });

  it('surfaces API errors with the provider name', async () => {
    stub({ error: { message: 'invalid x-api-key' } }, false, 401);
    await expect(askModel('anthropic', 'bad', 'claude-haiku-5-5', 'AAAA', 1)).rejects.toThrow('Claude: invalid x-api-key');
    stub({ error: { message: 'API key not valid' } }, false, 400);
    await expect(askModel('google', 'bad', 'gemini-3.1-flash-lite', 'AAAA', 1)).rejects.toThrow('Gemini: API key not valid');
  });

  it('treats an empty answer as a failed check', async () => {
    stub({ choices: [{ message: { content: 'sorry' } }], usage: {} });
    await expect(askModel('openai', 'k', 'gpt-5.4-mini', 'AAAA', 1)).rejects.toThrow('ChatGPT gave no usable answer');
  });
});

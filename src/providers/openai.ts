import type { ChatMessage, StreamGen } from './types.js';

export async function* streamOpenAI(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  baseUrl = 'https://api.openai.com/v1',
): StreamGen {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

  yield* parseSSE(res, chunk => chunk.choices?.[0]?.delta?.content ?? '');
}

// Reusable SSE parser for OpenAI-compatible APIs
export async function* parseSSE(
  res: Response,
  extract: (chunk: any) => string,
  _signal?: AbortSignal,
): StreamGen {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const token = extract(JSON.parse(line.slice(6)));
          if (token) yield token;
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

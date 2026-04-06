import type { ChatMessage, StreamGen } from './types.js';

export async function* streamAnthropic(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): StreamGen {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 4096, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`${res.status}: ${err?.error?.message ?? res.statusText}`);
  }

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
        if (!line.startsWith('data: ')) continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === 'content_block_delta') {
            const token = chunk.delta?.text ?? '';
            if (token) yield token;
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

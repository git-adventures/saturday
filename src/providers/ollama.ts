import type { ChatMessage, StreamGen } from './types.js';

export async function* streamOllama(
  messages: ChatMessage[],
  _apiKey: string,
  model: string,
  signal?: AbortSignal,
): StreamGen {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: (m as any).content ?? '' })),
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(`${res.status}: ${err?.error ?? res.statusText}`);
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
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          const token = chunk.message?.content ?? '';
          if (token) yield token;
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

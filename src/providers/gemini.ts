import type { ChatMessage, StreamGen } from './types.js';

export async function* streamGemini(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): StreamGen {
  const contents = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}` +
    `:streamGenerateContent?alt=sse&key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
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
          const token = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          if (token) yield token;
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

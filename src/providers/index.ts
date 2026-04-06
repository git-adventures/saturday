import { streamOpenAI } from './openai.js';
import { streamAnthropic } from './anthropic.js';
import { streamGemini } from './gemini.js';
import { streamGroq } from './groq.js';
import { streamGrok } from './grok.js';
import { streamOllama } from './ollama.js';
import type { ChatMessage, StreamGen, StreamFn } from './types.js';

export type { ChatMessage };

const STREAMERS: Record<string, StreamFn> = {
  gpt:    (msgs, key, model, signal) => streamOpenAI(msgs, key, model, signal),
  claude: streamAnthropic,
  gemini: streamGemini,
  groq:   streamGroq,
  grok:   streamGrok,
  ollama: streamOllama,
};

export function getStreamer(provider: string): StreamFn {
  const fn = STREAMERS[provider];
  if (!fn) throw new Error(`Unknown provider: ${provider}`);
  return fn;
}

import { streamOpenAI } from './openai.js';
import type { ChatMessage, StreamGen } from './types.js';

// xAI Grok uses an OpenAI-compatible API
export async function* streamGrok(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): StreamGen {
  yield* streamOpenAI(messages, apiKey, model, signal, 'https://api.x.ai/v1');
}

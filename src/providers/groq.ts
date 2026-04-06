import { streamOpenAI } from './openai.js';
import type { ChatMessage, StreamGen } from './types.js';

export async function* streamGroq(
  messages: ChatMessage[],
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): StreamGen {
  yield* streamOpenAI(messages, apiKey, model, signal, 'https://api.groq.com/openai/v1');
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
}

export type StreamGen = AsyncGenerator<string, void, unknown>;
export type StreamOptions = { searchEnabled?: boolean };
export type StreamFn = (messages: ChatMessage[], apiKey: string, model: string, signal?: AbortSignal, options?: StreamOptions) => StreamGen;

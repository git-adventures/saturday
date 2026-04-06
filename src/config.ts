import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const CONFIG_DIR  = join(homedir(), '.sat');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
export const HISTORY_DIR = join(CONFIG_DIR, 'history');

export interface Config {
  keys: Record<string, string>;
  defaultProvider: string | null;
}

export const MODELS: Record<string, string> = {
  gpt:    'gpt-4o',
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-2.0-flash',
  grok:   'grok-3-latest',
  groq:   'llama-3.3-70b-versatile',
  ollama: 'qwen2.5:7b',
};

export const PROVIDERS: Record<string, string> = {
  gpt:    'OpenAI (GPT)',
  claude: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
  grok:   'xAI (Grok)',
  groq:   'Groq (free)',
  ollama: 'Ollama (local)',
};

export const PROVIDER_COLORS: Record<string, string> = {
  gpt:    'green',
  claude: 'magenta',
  gemini: 'cyan',
  grok:   'yellow',
  groq:   'yellow',
  ollama: 'white',
};

export const NO_KEY_PROVIDERS = new Set(['ollama']);

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return { keys: {}, defaultProvider: null };
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return { keys: {}, defaultProvider: null };
  }
}

export function saveConfig(cfg: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(HISTORY_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// Migrate API keys from old ~/.aix/config.json on first run
export function migrateFromAix(): Config | null {
  const aixFile = join(homedir(), '.aix', 'config.json');
  if (!existsSync(aixFile)) return null;
  try {
    const old = JSON.parse(readFileSync(aixFile, 'utf-8'));
    return {
      keys: old.keys ?? {},
      defaultProvider: old.default_provider ?? old.defaultProvider ?? null,
    };
  } catch {
    return null;
  }
}

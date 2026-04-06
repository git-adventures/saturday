#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { loadConfig, saveConfig, migrateFromAix, PROVIDERS } from './config.js';
import { setupWizard } from './setup.js';

// Ensure the terminal is always restored on any kind of exit (crash, kill, etc.)
function restoreTerminal() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch {}
  process.stdout.write('\x1b[?25h'); // restore cursor
  process.stdout.write('\x1b[0m');   // reset all attributes
}
process.on('exit', restoreTerminal);
process.on('SIGTERM', () => { restoreTerminal(); process.exit(0); });
process.on('SIGINT',  () => { restoreTerminal(); process.exit(0); });
process.on('uncaughtException', (err) => {
  restoreTerminal();
  process.stderr.write(`\n[sat] crash: ${err.message}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  // Prevent Node.js from crashing the process (and leaving the terminal in raw mode)
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (!msg.includes('abort') && !msg.includes('AbortError')) {
    process.stderr.write(`\n[sat] unhandled rejection: ${msg}\n`);
  }
});

// Fetch installed Ollama models; returns first model name or null if unreachable
async function detectOllamaModel(): Promise<string | null> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(300) });
    if (!res.ok) return null;
    const data = await res.json() as { models?: Array<{ name: string }> };
    return data.models?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function main() {
  let cfg = loadConfig();

  // First run: try to migrate keys from ~/.aix
  if (Object.keys(cfg.keys).length === 0) {
    const migrated = migrateFromAix();
    if (migrated && Object.keys(migrated.keys).length > 0) {
      cfg = migrated;
      saveConfig(cfg);
      console.log('\n  \x1b[32m✓ Migrated API keys from ~/.aix/config.json\x1b[0m\n');
    }
  }

  const available = Object.keys(PROVIDERS).filter(k => cfg.keys[k]);

  if (available.length === 0 || process.argv.includes('--setup')) {
    cfg = await setupWizard(cfg, process.argv.includes('--setup'));
    saveConfig(cfg);
  }

  // Auto-detect initial model: for ollama, query what's actually installed
  const provider = (cfg.defaultProvider && cfg.keys[cfg.defaultProvider])
    ? cfg.defaultProvider
    : Object.keys(cfg.keys)[0] ?? 'gpt';
  const initialModel = provider === 'ollama'
    ? (await detectOllamaModel()) ?? 'llama3.2'
    : undefined;

  // Clear screen once before ink takes over to prevent blank-line scroll artifact
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  while (true) {
    let needsSetup = false;
    const { waitUntilExit } = render(<App initialConfig={cfg} initialModel={initialModel} onRequestSetup={() => { needsSetup = true; }} />);
    await waitUntilExit();
    if (!needsSetup) break;
    process.stdin.resume();
    cfg = await setupWizard(cfg, true);
    saveConfig(cfg);
  }
}

main().catch(err => {
  console.error('\x1b[31m  Error:\x1b[0m', err.message ?? err);
  process.exit(1);
});

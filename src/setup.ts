import * as rlp from 'readline/promises';
import { openSync } from 'fs';
import { ReadStream } from 'tty';
import { stdout } from 'process';
import { PROVIDERS, MODELS, NO_KEY_PROVIDERS, type Config } from './config.js';

function makeTtyRl() {
  const fd = openSync('/dev/tty', 'r+');
  const input = new ReadStream(fd);
  return rlp.createInterface({ input, output: stdout, terminal: true });
}

export async function setupWizard(cfg: Config, force = false): Promise<Config> {
  const rl = makeTtyRl();

  console.log('\n  \x1b[1m\x1b[96msat\x1b[0m — Setup');
  console.log('  \x1b[2mKeys stored in ~/.sat/config.json\x1b[0m\n');

  if (!force) console.log('  \x1b[33mNo API keys found. Configure providers below.\x1b[0m\n');

  // When called from /keys: let the user pick a single provider to manage
  let providerFilter: string | null = null;
  if (force) {
    const allProviders = Object.entries(PROVIDERS).filter(([k]) => !NO_KEY_PROVIDERS.has(k));

    // Auto-detect Ollama whenever /keys is opened
    try {
      await fetch('http://localhost:11434', { signal: AbortSignal.timeout(2000) });
      cfg.keys['ollama'] = 'local';
      console.log('  \x1b[32m✓ Ollama detected and configured\x1b[0m\n');
    } catch {
      console.log('  \x1b[2mollama not running — skipping\x1b[0m\n');
    }
    console.log('  \x1b[1mWhich provider?\x1b[0m\n');
    allProviders.forEach(([k, label], i) => {
      const status = cfg.keys[k] ? '\x1b[32m✓\x1b[0m' : '\x1b[2m—\x1b[0m';
      console.log(`    \x1b[2m${i + 1}.\x1b[0m  ${status}  ${label}`);
    });
    while (true) {
      const raw = await rl.question(`\n  Choice (1-${allProviders.length}, or q to cancel): `);
      const t = raw.trim().toLowerCase();
      if (t === 'q' || t === 'quit' || t === 'exit' || t === '0') {
        rl.close();
        console.log();
        return cfg;
      }
      const idx = parseInt(raw) - 1;
      if (idx >= 0 && idx < allProviders.length) {
        providerFilter = allProviders[idx]![0];
        break;
      }
      console.log('  \x1b[31mInvalid.\x1b[0m');
    }
    console.log();
  }

  for (const [key, label] of Object.entries(PROVIDERS)) {
    if (providerFilter && key !== providerFilter) continue;
    if (NO_KEY_PROVIDERS.has(key)) {
      process.stdout.write(`  \x1b[1m${label}\x1b[0m  \x1b[2m(no key — runs locally)\x1b[0m\n`);
      try {
        await fetch('http://localhost:11434', { signal: AbortSignal.timeout(2000) });
        cfg.keys[key] = 'local';
        console.log('  \x1b[32m✓ Ollama detected\x1b[0m\n');
      } catch {
        cfg.keys[key] = 'local';
        console.log('  \x1b[33m⚠ Ollama not running\x1b[0m  \x1b[2mollama pull llama3.2 && ollama serve\x1b[0m\n');
      }
      continue;
    }

    const existing = cfg.keys[key];
    if (existing) {
      const masked = existing.slice(0, 8) + '••••';
      console.log(`  \x1b[1m${label}\x1b[0m  \x1b[32m✓ set\x1b[0m  \x1b[2m${masked}\x1b[0m`);
      const action = await rl.question('    [k]eep  [r]eplace  [d]elete  (Enter = keep):  ');
      const a = action.trim().toLowerCase();
      if (a === 'r' || a === 'replace') {
        const val = await rl.question('    New key:  ');
        if (val.trim()) { cfg.keys[key] = val.trim(); console.log('  \x1b[32m✓ updated\x1b[0m\n'); }
        else             { console.log('  \x1b[33m(unchanged)\x1b[0m\n'); }
      } else if (a === 'd' || a === 'delete') {
        delete cfg.keys[key];
        console.log('  \x1b[31m✗ removed\x1b[0m\n');
      } else {
        console.log('  \x1b[2m(kept)\x1b[0m\n');
      }
    } else {
      const val = await rl.question(`  \x1b[1m${label}\x1b[0m key  \x1b[2m(Enter to skip)\x1b[0m:  `);
      if (val.trim()) {
        cfg.keys[key] = val.trim();
        console.log('  \x1b[32m✓ Saved\x1b[0m');
      } else {
        console.log();
      }
    }
  }

  rl.close();

  const available = Object.keys(PROVIDERS).filter(k => cfg.keys[k]);
  if (available.length === 0) {
    console.error('  \x1b[31mNo providers configured. Exiting.\x1b[0m\n');
    process.exit(1);
  }

  if (!cfg.defaultProvider || !available.includes(cfg.defaultProvider)) {
    const rl2 = makeTtyRl();
    console.log('  \x1b[1mPick your default provider:\x1b[0m');
    available.forEach((k, i) => {
      console.log(`    \x1b[2m${i + 1}.\x1b[0m  ${PROVIDERS[k]}  \x1b[2m${MODELS[k]}\x1b[0m`);
    });
    while (true) {
      const raw = await rl2.question(`\n  Choice (1-${available.length}): `);
      const idx = parseInt(raw) - 1;
      if (idx >= 0 && idx < available.length) {
        cfg.defaultProvider = available[idx]!;
        break;
      }
      console.log('  \x1b[31mInvalid.\x1b[0m');
    }
    rl2.close();
  }

  console.log();
  return cfg;
}

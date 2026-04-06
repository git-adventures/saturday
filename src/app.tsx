import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { Header } from './components/Header.js';
import { ChatInput } from './components/ChatInput.js';
import { Message, StreamingMessage } from './components/Message.js';
import { Thinking } from './components/Thinking.js';
import { getStreamer, type ChatMessage } from './providers/index.js';
import {
  MODELS, PROVIDERS, HISTORY_DIR,
  saveConfig, type Config,
} from './config.js';
import { webSearch } from './search.js';

interface AppProps {
  initialConfig: Config;
  onRequestSetup: () => void;
  initialModel?: string;
}

type Phase = 'input' | 'streaming';

interface TocEntry {
  title: string;
  page: number;
  endPage: number;
}

interface DocContext {
  name: string;
  path?: string;        // file path on disk (for on-demand page extraction)
  totalPages?: number;  // total PDF pages
  toc?: TocEntry[];     // parsed TOC (PDF only, when large enough)
  content: string;      // full text or TOC preview text
  mode: 'full' | 'toc'; // 'toc' = only first pages loaded, chapters on demand
  pageOffset?: number;  // physical PDF page = printed page + offset (front matter pages)
  loadedChapter?: string; // title of the currently loaded chapter (for passage extraction)
}

// ── TOC helpers ─────────────────────────────────────────────────────────────
function parseToc(text: string): Array<{ title: string; page: number }> {
  const lines = text.split('\n');

  // Pass 1 — "Chapter N: Title  .  .  .  .  page" (numbered chapter format, high confidence)
  // Uses (?:\.\s*){3,} which correctly handles spaced dot leaders: ". . . . ."
  const chapEntries: Array<{ title: string; page: number }> = [];
  const chapPages = new Set<number>();
  for (const line of lines) {
    const m = line.trim().match(/^(Chapter\s+\d+[:\s]+.+?)\s+(?:\.\s*){3,}(\d{1,4})\s*$/i);
    if (!m) continue;
    const page = parseInt(m[2]!);
    if (page > 0 && !chapPages.has(page)) {
      chapPages.add(page);
      chapEntries.push({ title: m[1]!.trim(), page });
    }
  }
  if (chapEntries.length >= 2) return chapEntries;

  // Pass 2 — General dot-leader, any length line (no length cap)
  const genEntries: Array<{ title: string; page: number }> = [];
  const genPages = new Set<number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 4) continue;
    const m = trimmed.match(/^(.+?)\s+(?:\.\s*){4,}(\d{1,4})\s*$/);
    if (!m) continue;
    const title = m[1]!.trim().replace(/^[\d.]+\s+/, '');
    const page  = parseInt(m[2]!);
    if (page > 0 && page < 5000 && title.length >= 3 && !genPages.has(page)) {
      genPages.add(page);
      genEntries.push({ title, page });
    }
  }
  return genEntries;
}

function buildToc(raw: Array<{ title: string; page: number }>, totalPages: number): TocEntry[] {
  const sorted = [...raw].sort((a, b) => a.page - b.page);
  return sorted.map((e, i) => ({
    title:   e.title,
    page:    e.page,
    endPage: sorted[i + 1] ? Math.max(e.page, sorted[i + 1]!.page - 1) : totalPages,
  }));
}

// Extract the most relevant paragraphs from a document for a given query.
// Uses both query words and chapter topic words so vague queries like
// "teach me how to use it" still find the right passages.
const PASSAGE_STOPWORDS = new Set([
  'teach', 'show', 'tell', 'give', 'help', 'make', 'what', 'that', 'this', 'about',
  'have', 'will', 'would', 'could', 'should', 'with', 'from', 'just', 'also', 'like',
  'more', 'some', 'them', 'they', 'then', 'when', 'here', 'there', 'been', 'were',
  'your', 'each', 'does', 'very', 'into', 'much', 'step', 'shortly', 'briefly',
  'please', 'using', 'explain', 'describe', 'provide', 'briefly', 'quickly',
]);

function extractRelevantPassages(content: string, query: string, topic = '', maxChars = 3500): string {
  const qWords = query.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !PASSAGE_STOPWORDS.has(w));
  const tWords = topic.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !PASSAGE_STOPWORDS.has(w));

  // If no meaningful keywords at all, return the beginning of the chapter
  if (qWords.length === 0 && tWords.length === 0) return content.slice(0, maxChars);

  const paragraphs = content.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 40);

  const scored = paragraphs.map(p => {
    const lower = p.toLowerCase();
    // Query words: 1 point each; topic/chapter-title words: 2 points each (more specific)
    const score =
      qWords.reduce((s, w) => s + (lower.includes(w) ? 1 : 0), 0) +
      tWords.reduce((s, w) => s + (lower.includes(w) ? 2 : 0), 0);
    return { p, score };
  });

  const topMatches = scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.p);

  if (topMatches.length === 0) return content.slice(0, maxChars);

  // Restore document order
  const matchSet = new Set(topMatches);
  const ordered = paragraphs.filter(p => matchSet.has(p));
  const result = ordered.join('\n\n');
  return result.length > maxChars ? result.slice(0, maxChars) : result;
}

// Detect how many physical PDF pages precede printed page 1 (front matter offset).
// Extracts a batch of pages after the TOC section and finds which physical page
// contains the first chapter's title text.
function detectPageOffset(
  pdfPath: string,
  toc: TocEntry[],
  tocPages: number,
  totalPages: number,
): number {
  if (toc.length === 0) return 0;
  const firstEntry = toc[0]!;
  const keyword = firstEntry.title.replace(/^Chapter\s+\d+[:\s]+/i, '').trim().toLowerCase().slice(0, 25);
  if (!keyword) return 0;
  try {
    const { execSync } = require('child_process');
    const scanFrom = tocPages;
    const scanTo   = Math.min(tocPages + 50, totalPages);
    const batch    = execSync(`pdftotext -f ${scanFrom} -l ${scanTo} "${pdfPath}" - 2>/dev/null`, { encoding: 'utf-8' }) as string;
    const pages    = batch.split('\f');
    for (let i = 0; i < pages.length; i++) {
      if (pages[i]!.toLowerCase().includes(keyword)) {
        return (scanFrom + i) - firstEntry.page;
      }
    }
  } catch {}
  return 0;
}


export function App({ initialConfig, onRequestSetup, initialModel }: AppProps) {
  const { exit } = useApp();
  const [cfg, setCfg]             = useState(initialConfig);
  const initialProvider = (initialConfig.defaultProvider && initialConfig.keys[initialConfig.defaultProvider])
    ? initialConfig.defaultProvider
    : Object.keys(initialConfig.keys)[0] ?? 'gpt';
  const [provider, setProvider]   = useState(initialProvider);
  const [model, setModel]         = useState(initialModel ?? MODELS[initialProvider] ?? 'gpt-4o');
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [streaming, setStreaming]  = useState('');
  const [phase, setPhase]         = useState<Phase>('input');
  const [error, setError]         = useState('');
  const [info, setInfo]           = useState('');
  const [searchOn, setSearchOn]   = useState(false);
  const [docContext, setDocContext] = useState<DocContext | null>(null);
  const [dirListing, setDirListing] = useState<{ dir: string; files: string[] } | null>(null);

  const [scrollHide, setScrollHide] = useState(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const abortRef    = useRef<(() => void) | null>(null);
  const pendingMsg  = useRef('');
  const [pendingDisplay, setPendingDisplay] = useState('');

  // ── command handler ─────────────────────────────────────────────────────────
  const handleCommand = useCallback(async (raw: string) => {
    const parts = raw.trim().split(/\s+/);
    const cmd   = parts[0]!.toLowerCase();
    const sub   = parts[1]?.toLowerCase();

    setError('');
    setInfo('');

    switch (cmd) {
      case '/exit':
        exit();
        break;

      case '/clear':
        process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
        setMessages([]);
        setDocContext(null);
        break;

      case '/info':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: [
            '**sat** — a terminal AI client built on a Saturday, hence the name.',
            '',
            'No browser, no Electron, no nonsense — just a fast terminal UI that talks directly to AI APIs over HTTP.',
            '',
            '**What it can do:**',
            '- Chat with GPT, Claude, Gemini, Grok, Groq, or Ollama (local)',
            '- Stream responses token by token',
            '- Switch providers mid-conversation (`/model`)',
            '- Save & restore conversations (`/save`, `/load`)',
            '- Tab autocomplete, input history, markdown rendering',
            '- Web search toggle (`/search`)',
            '- Load documents & PDFs for Q&A (`/read`)',
            '',
            'Built with TypeScript + ink (React for terminals).',
          ].join('\n'),
        }]);
        break;

      case '/help':
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: [
            '**Commands**',
            '',
            '`/model [name]`        switch provider — gpt · claude · gemini · grok · groq · ollama',
            '`/search on|off|auto`  toggle web search',
            '`/read <path>`         load a file/PDF as context (ask questions about it)',
            '`/read <n>.`           load chapter n from PDF table of contents (dot required)',
            '`/read <n>`            pick file n from directory listing',
            '`/read clear`          remove loaded document',
            '`/clear`               clear conversation',
            '`/save`                save conversation to `~/.sat/history/`',
            '`/load [n]`            list or restore a saved session',
            '`/keys`                re-run API key setup',
            '`/info`                about sat',
            '`/help`                show this',
            '`/exit`                quit',
          ].join('\n'),
        }]);
        break;

      case '/model': {
        const available = Object.keys(PROVIDERS).filter(k => cfg.keys[k]);
        if (!sub) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: [
              `**Active:** \`${provider}\` — ${PROVIDERS[provider]}  model: \`${model}\``,
              '',
              '**Available providers:**',
              ...Object.keys(PROVIDERS)
                .filter(k => cfg.keys[k] || k === 'ollama')
                .map(k => {
                  const label = PROVIDERS[k];
                  const m     = k === provider ? model : MODELS[k];
                  if (k === provider) return `- \`${k}\`  ${label}  *(${m})*  ← active`;
                  return `- \`/model ${k}\`  ${label}  *(${m})*`;
                }),
              '',
              'Run `/keys` to add more providers.',
              'To use a specific model: `/model gpt gpt-4-turbo`',
            ].join('\n'),
          }]);
        } else if (!cfg.keys[sub] && sub !== 'ollama') {
          setError(`No key for "${sub}" — run /keys to add one. Available: ${available.join(', ')}`);
        } else {
          const customModel = parts.slice(2).join(' ') || MODELS[sub]!;
          const newCfg = { ...cfg, defaultProvider: sub };
          saveConfig(newCfg);
          setCfg(newCfg);
          setProvider(sub);
          setModel(customModel);
          setInfo(`Switched to ${PROVIDERS[sub]} — ${customModel}`);
        }
        break;
      }

      case '/search':
        if (sub === 'on' || sub === 'auto') {
          setSearchOn(true);
          setMessages(prev => [...prev, { role: 'assistant', content: `Web search **enabled**${sub === 'auto' ? ' (auto)' : ''}.` }]);
        } else if (sub === 'off') {
          setSearchOn(false);
          setMessages(prev => [...prev, { role: 'assistant', content: 'Web search **disabled**.' }]);
        } else {
          setError('Usage: /search on | off | auto');
        }
        break;

      case '/read': {
        const arg = parts.slice(1).join(' ');

        // /read clear
        if (!arg || arg === 'clear') {
          setDocContext(null);
          setDirListing(null);
          setInfo(arg === 'clear' ? 'Document cleared.' : 'Usage: /read <path>');
          break;
        }

        // /read <n>.  — load chapter n from loaded PDF's TOC (dot suffix required)
        const chapterMatch = arg.match(/^(\d+)\.$/)
        if (chapterMatch) {
          const pick = parseInt(chapterMatch[1]!);
          if (docContext?.toc && docContext.toc.length > 0) {
            const entry = docContext.toc[pick - 1];
            if (!entry) { setError(`Invalid. Pick 1–${docContext.toc.length}.`); break; }
            if (!docContext.path) { setError('No PDF path stored.'); break; }
            const offset   = docContext.pageOffset ?? 0;
            const physStart = String(entry.page + offset);
            const physEnd   = String(entry.endPage + offset);
            setPhase('streaming');
            setStreaming('');
            try {
              const { execFile } = await import('child_process');
              const text = await new Promise<string>((resolve, reject) =>
                execFile('pdftotext', ['-f', physStart, '-l', physEnd, docContext.path!, '-'], { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) =>
                  err ? reject(err) : resolve(stdout)
                )
              );
              process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
              setDocContext({ ...docContext, content: text, mode: 'full', loadedChapter: entry.title });

              // Typewriter animation for the confirmation message
              const fullMsg = `**Loaded:** ${entry.title}  ·  pages ${entry.page}–${entry.endPage}  ·  ~${Math.round(text.length / 4).toLocaleString()} tokens\n\nAsk me anything about it.`;
              setPhase('streaming');
              setStreaming('');
              let typed = '';
              for (const ch of fullMsg) {
                typed += ch;
                setStreaming(typed);
                await new Promise(r => setTimeout(r, 18));
              }
              setStreaming('');
              setPhase('input');
              setMessages(prev => [...prev, { role: 'assistant', content: fullMsg }]);
            } catch (e: any) {
              setPhase('input');
              setError(`Could not extract pages: ${e.message}`);
            }
          } else {
            setError('No PDF with table of contents loaded. Use /read <path> first.');
          }
          break;
        }

        // /read <n>  — pick file n from directory listing
        const pick = parseInt(arg);
        if (!isNaN(pick)) {
          if (dirListing) {
            const picked = dirListing.files[pick - 1];
            if (!picked) { setError(`Invalid. Pick 1–${dirListing.files.length}.`); break; }
            handleCommandRef.current(`/read ${dirListing.dir}/${picked}`);
            break;
          }
          setError('No directory listing active. Use /read <path> to list a directory first.');
          break;
        }

        if (!existsSync(arg)) { setError(`Not found: ${arg}`); break; }

        try {
          const stat = statSync(arg);

          // Directory — list readable files
          if (stat.isDirectory()) {
            const all = readdirSync(arg);
            const readable = all.filter(f => {
              try {
                const s = statSync(`${arg}/${f}`);
                return s.isFile() && s.size < 50 * 1024 * 1024;
              } catch { return false; }
            });
            if (readable.length === 0) { setError('No readable files found in that directory.'); break; }
            setDirListing({ dir: arg, files: readable });
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: [
                `**${arg}**  (${readable.length} files)`,
                '',
                ...readable.map((f, i) => `\`${i + 1}.\`  ${f}`),
                '',
                'Type `/read <number>` to load one. (For TOC chapters use `/read <n>.` with a dot)',
              ].join('\n'),
            }]);
            break;
          }

          // File
          const MB = stat.size / 1024 / 1024;
          if (MB > 200) { setError(`File too large (${MB.toFixed(1)} MB). Max 200 MB.`); break; }

          const name  = arg.split('/').pop() ?? arg;
          const isPDF = name.toLowerCase().endsWith('.pdf');

          if (isPDF) {
            const { execSync } = await import('child_process');

            // Get page count
            let totalPages = 1;
            try {
              const pdfInfo = execSync(`pdfinfo "${arg}" 2>/dev/null`, { encoding: 'utf-8' });
              const m = pdfInfo.match(/Pages:\s+(\d+)/);
              if (m) totalPages = parseInt(m[1]!);
            } catch {}

            const TOC_PAGES = Math.min(24, totalPages);
            const LARGE_PDF = totalPages > 40;

            if (LARGE_PDF) {
              // Large PDF: extract only first TOC_PAGES pages, parse TOC
              const tocPages: string[] = [];
              for (let i = 1; i <= TOC_PAGES; i++) {
                const page = execSync(`pdftotext -f ${i} -l ${i} "${arg}" - 2>/dev/null`, { encoding: 'utf-8' });
                tocPages.push(page);
              }
              const tocText = tocPages.join('\n');

              const rawEntries = parseToc(tocText);
              const toc = rawEntries.length >= 3 ? buildToc(rawEntries, totalPages) : [];

              // Detect front-matter offset so physical page = printed page + offset
              const pageOffset = toc.length >= 3
                ? detectPageOffset(arg, toc, TOC_PAGES, totalPages)
                : 0;

              process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
              setDocContext({ name, path: arg, totalPages, toc, content: tocText, mode: 'toc', pageOffset });
              setDirListing(null);

              setMessages(prev => [...prev, {
                role: 'assistant',
                content: toc.length >= 3
                  ? [
                      `**${name}**  ·  ${totalPages} pages`,
                      '',
                      '**Table of Contents:**',
                      ...toc.map((e, i) => `\`${i + 1}.\`  ${e.title}  — p. ${e.page}`),
                      '',
                      'Type `/read <n>.` (with dot) to load a chapter, or just ask a question and I\'ll find the right section.',
                    ].join('\n')
                  : [
                      `**${name}**  ·  ${totalPages} pages  ·  TOC not detected`,
                      '',
                      'Ask a question — I\'ll search the relevant section on demand.',
                    ].join('\n'),
              }]);
            } else {
              // Small PDF: load all pages
              const pages: string[] = [];
              for (let i = 1; i <= totalPages; i++) {
                const page = execSync(`pdftotext -f ${i} -l ${i} "${arg}" - 2>/dev/null`, { encoding: 'utf-8' });
                pages.push(page);
              }
              const raw = pages.join('\n');
              const estTokens = Math.round(raw.length / 4);
              setDocContext({ name, path: arg, totalPages, content: raw, mode: 'full' });
              setDirListing(null);
              autoSwitchModel(estTokens, name);
            }
          } else {
            // Text file
            const raw = readFileSync(arg, 'utf-8');
            const estTokens = Math.round(raw.length / 4);
            setDocContext({ name, content: raw, mode: 'full' });
            setDirListing(null);
            autoSwitchModel(estTokens, name);
          }
        } catch (e: any) {
          setError(`Could not read: ${e.message}`);
        }
        break;
      }

      case '/keys':
        onRequestSetup();
        exit();
        break;

      case '/load': {
        if (!existsSync(HISTORY_DIR)) { setError('No saved sessions yet.'); break; }
        const files = readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort().reverse();
        if (files.length === 0) { setError('No saved sessions yet.'); break; }
        const third = parts[2]?.toLowerCase();
        if (!sub) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: [
              '**Saved sessions:**',
              ...files.map((f, i) => `\`${i + 1}.\`  ${f.replace('.json', '')}`),
              '',
              '`/load <n>`           restore session',
              '`/load delete <n>`    delete session',
              '`/load delete all`    delete all sessions',
            ].join('\n'),
          }]);
        } else if (sub === 'delete') {
          if (third === 'all') {
            files.forEach(f => unlinkSync(join(HISTORY_DIR, f)));
            setInfo(`Deleted all ${files.length} sessions`);
          } else {
            const idx = parseInt(third ?? '') - 1;
            if (isNaN(idx) || idx < 0 || idx >= files.length) {
              setError('Usage: /load delete <n>  or  /load delete all');
              break;
            }
            const file = files[idx]!;
            unlinkSync(join(HISTORY_DIR, file));
            setInfo(`Deleted '${file.replace('.json', '')}'`);
          }
        } else {
          const idx = parseInt(sub) - 1;
          if (isNaN(idx) || idx < 0 || idx >= files.length) {
            setError(`Invalid number. Run /load to see available sessions.`);
            break;
          }
          const file = files[idx]!;
          const loaded = JSON.parse(readFileSync(join(HISTORY_DIR, file), 'utf-8')) as ChatMessage[];
          const providerKey = file.split('_')[0]!;
          if (MODELS[providerKey] && cfg.keys[providerKey]) {
            setProvider(providerKey);
            setModel(MODELS[providerKey]!);
          }
          setMessages([
            { role: 'system', content: `restored: ${file.replace('.json', '')}` },
            ...loaded,
          ]);
          setInfo(`Loaded '${file.replace('.json', '')}' — ${loaded.length} messages`);
        }
        break;
      }

      case '/save': {
        const msgs = messagesRef.current;
        if (msgs.length === 0) { setError('Nothing to save.'); break; }
        mkdirSync(HISTORY_DIR, { recursive: true });
        const ts   = new Date().toISOString().replace(/[:.]/g, '-');
        const path = `${HISTORY_DIR}/${provider}_${ts}.json`;
        writeFileSync(path, JSON.stringify(msgs, null, 2));
        setInfo(`Saved to '${path}'`);
        break;
      }

      default:
        setError(`Unknown command: ${cmd}  (Tab to see commands)`);
    }
  }, [cfg, exit, onRequestSetup, provider, dirListing, model, docContext]);

  const handleCommandRef = useRef(handleCommand);
  handleCommandRef.current = handleCommand;

  // ── auto model switch helper ─────────────────────────────────────────────
  function autoSwitchModel(estTokens: number, name: string) {
    const CONTEXT: Record<string, number> = {
      gemini: 1_000_000, claude: 200_000, gpt: 128_000,
      grok: 128_000, groq: 128_000, ollama: 32_000,
    };
    const currentCtx = CONTEXT[provider] ?? 128_000;
    let switchNote = '';

    if (estTokens > currentCtx * 0.8) {
      const best = ['gemini', 'claude', 'gpt', 'groq', 'grok']
        .find(p => cfg.keys[p] && (CONTEXT[p] ?? 0) > estTokens);
      if (best) {
        setProvider(best);
        setModel(MODELS[best]!);
        switchNote = `\n\n⚠ ~${estTokens.toLocaleString()} tokens — too large for current model. Auto-switched to \`${best}\` (${(CONTEXT[best]! / 1000).toFixed(0)}k context).`;
      } else {
        switchNote = `\n\n⚠ ~${estTokens.toLocaleString()} tokens — may exceed context. Add Gemini/Groq key (\`/keys\`) for better results.`;
      }
    }

    setMessages(prev => {
      const filtered = prev.filter(m => !(m.role === 'assistant' && m.content.startsWith('_Reading')));
      return [...filtered, {
        role: 'assistant',
        content: `**Loaded:** \`${name}\`  ·  ${(estTokens * 4 / 1024).toFixed(0)} KB  ·  ~${estTokens.toLocaleString()} tokens${switchNote}\n\nAsk me anything about it.`,
      }];
    });
  }

  // ── message submit ──────────────────────────────────────────────────────────
  const HOT_COMMANDS: Record<string, string> = {
    'exit': '/exit', 'quit': '/exit', 'q': '/exit',
    'clear': '/clear',
    'help': '/help',
  };

  const handleSubmitRef = useRef<(t: string) => void>(() => {});

  const handleSubmit = useCallback(async (text: string) => {
    if (phase === 'streaming') {
      pendingMsg.current = text;
      setPendingDisplay(text);
      return;
    }

    if (text.startsWith('/')) {
      setMessages(prev => [...prev, { role: 'user', content: text }]);
      handleCommandRef.current(text);
      return;
    }
    const hot = HOT_COMMANDS[text.toLowerCase()];
    if (hot) { handleCommandRef.current(hot); return; }

    const userMsg: ChatMessage = { role: 'user', content: text };
    const history = [...messagesRef.current, userMsg];
    setMessages(history);
    setScrollHide(0);
    setPhase('streaming');
    setStreaming('');
    setError('');
    setInfo('');

    const controller = new AbortController();
    let userAborted = false;
    abortRef.current = () => { userAborted = true; controller.abort(); };

    const docTokens = docContext ? Math.round(docContext.content.length / 4) : 0;
    const initTimeout = docTokens > 0
      ? Math.min(600_000, 120_000 + docTokens * 2)
      : Math.min(120_000, 60_000 + text.length * 10);
    let silenceTimer = setTimeout(() => controller.abort(), initTimeout);
    let full = '';

    try {
      const streamer  = getStreamer(provider);
      const apiKey    = cfg.keys[provider] ?? '';
      let lastRender  = 0;

      // Strip system messages and slash-commands from what we send to the AI
      const apiHistory = history.filter(m =>
        m.role !== 'system' && !(m.role === 'user' && m.content.startsWith('/'))
      );

      // Inject document context
      if (docContext) {
        if (docContext.mode === 'toc') {
          // TOC mode: inject only the compact parsed chapter list, not the raw 24-page text.
          // This keeps the context tiny enough for local models (llama3.2 default = 4096 tokens).
          const tocLines = docContext.toc && docContext.toc.length > 0
            ? docContext.toc.map((e, i) => `${i + 1}. ${e.title} — page ${e.page}`).join('\n')
            : docContext.content.slice(0, 2000); // fallback: first 2000 chars
          apiHistory.unshift({
            role: 'system',
            content: `Document loaded: ${docContext.name}${docContext.totalPages ? ` (${docContext.totalPages} pages)` : ''}\n\nTable of Contents:\n${tocLines}\n\nOnly the TOC is loaded. If asked about a chapter's content, tell the user to type /read <n>. (with dot) to load it.`,
          });
        } else {
          // Full content mode — inject the whole chapter every time.
          // Per-query extraction was unreliable: vague follow-ups ("shorter", "again")
          // caused different passages to be injected each turn, confusing the model.
          // Chapters are ~4k tokens — well within qwen/llama context limits.
          const topic = docContext.loadedChapter ?? docContext.name;
          const recent = apiHistory.slice(-2);
          apiHistory.length = 0;
          apiHistory.push(...recent);
          apiHistory.unshift({
            role: 'system',
            content: `You are answering questions about the following document. Answer in ENGLISH ONLY. Use ONLY information from the document. Do NOT reference topics from other chapters or your training data.\n\nDocument: ${topic}\n\n${docContext.content}\n\n--- END OF DOCUMENT ---`,
          });
        }
      }

      if (searchOn && text.length < 500) {
        try {
          const q = text.length > 150 ? (text.split('\n').find(l => l.trim().length > 10) ?? text).slice(0, 150) : text;
          const results = await webSearch(q, 3, controller.signal);
          if (results) apiHistory.unshift({ role: 'system', content: `${results}\n\nUse these search results to answer. Do NOT say you lack current information.` });
        } catch { /* aborted */ }
      }

      // When a document is loaded the response can be very long.
      // Streaming the display while re-rendering the large message history
      // on every tick causes a Yoga layout spin-loop at 100% CPU.
      // Solution: only stream the display for plain conversations; for
      // document-context sessions show the spinner and render all at once.
      const liveStream = !docContext;
      const MAX_FULL = 16_000;
      for await (const token of streamer(apiHistory, apiKey, model, controller.signal, { searchEnabled: searchOn })) {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => controller.abort(), docContext ? 120_000 : 60_000);
        if (full.length >= MAX_FULL) break; // close connection — stops the model from generating more
        full += token;
        if (liveStream) {
          const now = Date.now();
          if (now - lastRender >= 200) { setStreaming(full); lastRender = now; }
        }
      }
    } catch (err) {
      const e = err as any;
      if (e?.name === 'AbortError' || e?.message?.includes('abort'))
        setError(userAborted ? 'Interrupted' : 'Timed out — no response for 60 s.');
      else if (e?.message?.includes('429'))
        setError('Rate limited — wait a moment and try again.');
      else if (e?.message?.includes('401') || e?.message?.includes('403'))
        setError('Invalid API key — run /keys to update it.');
      else
        setError(e?.message ?? String(err));
    } finally {
      clearTimeout(silenceTimer);
      abortRef.current = null;
      setInfo('');
      setStreaming('');
      setPhase('input');
      setPendingDisplay('');
      if (full) { setError(''); setMessages(prev => [...prev, { role: 'assistant', content: full }]); }
      if (pendingMsg.current) {
        const next = pendingMsg.current;
        pendingMsg.current = '';
        setTimeout(() => handleSubmitRef.current(next), 0);
      }
    }
  }, [provider, cfg, model, phase, searchOn, docContext]);

  handleSubmitRef.current = handleSubmit;

  // ── render ───────────────────────────────────────────────────────────────────
  const PAGE = 5;
  const visibleEnd  = scrollHide === 0 ? messages.length : messages.length - scrollHide;
  const visibleMsgs = messages.slice(0, Math.max(0, visibleEnd));
  const hiddenBelow = messages.length - visibleMsgs.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header provider={provider} model={model} searchOn={searchOn} docName={docContext?.name} />

      {scrollHide > 0 && (
        <Box marginBottom={1}>
          <Text color="#6c7086">  ↓ {hiddenBelow} newer message{hiddenBelow !== 1 ? 's' : ''} hidden  (PgDn to return)</Text>
        </Box>
      )}

      {visibleMsgs.map((msg, i) => <Message key={i} message={msg} />)}

      {scrollHide === 0 && phase === 'streaming' && !streaming && <Thinking />}
      {scrollHide === 0 && phase === 'streaming' && streaming && <StreamingMessage content={streaming} />}

      {pendingDisplay && phase === 'streaming' && (
        <Box marginBottom={1}>
          <Text color="#555565">{'  ↑ '}</Text>
          <Text color="#585b70" bold>{'> '}</Text>
          <Text color="#585b70">{pendingDisplay.length > 120 ? pendingDisplay.slice(0, 120) + '…' : pendingDisplay}</Text>
          <Text color="#45475a">{'  (queued)'}</Text>
        </Box>
      )}

      {info  && <Box marginBottom={1}><Text color="green">  ✓ {info}</Text></Box>}
      {error && <Box marginBottom={1}><Text color="red">  ✗ {error}</Text></Box>}

      <ChatInput
        onSubmit={handleSubmit}
        onAbort={() => abortRef.current?.()}
        onScrollUp={() => setScrollHide(h => Math.min(h + PAGE, Math.max(0, messages.length - 1)))}
        onScrollDown={() => setScrollHide(h => Math.max(0, h - PAGE))}
        disabled={phase === 'streaming'}
        providers={PROVIDERS}
        configuredProviders={new Set(Object.keys(PROVIDERS).filter(k => cfg.keys[k]))}
        currentProvider={provider}
        sessions={existsSync(HISTORY_DIR) ? readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json')).sort().reverse() : []}
        pendingText={pendingDisplay}
        onCancelPending={() => { pendingMsg.current = ''; setPendingDisplay(''); }}
      />
    </Box>
  );
}

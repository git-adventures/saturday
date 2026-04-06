import React, { useState, useCallback, useEffect, useRef } from 'react';

// Word-jump helpers
function wordLeft(text: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && text[i - 1] === ' ') i--;
  while (i > 0 && text[i - 1] !== ' ') i--;
  return Math.max(0, i);
}
function wordRight(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && text[i] === ' ') i++;
  while (i < text.length && text[i] !== ' ') i++;
  return i;
}
import { Box, Text, useInput, useStdin } from 'ink';

interface Command {
  name: string;
  desc: string;
}

const BASE_COMMANDS: Command[] = [
  { name: '/model',      desc: 'switch provider' },
  { name: '/search',     desc: 'toggle web search' },
  { name: '/read',       desc: 'load file/PDF as context' },
  { name: '/read clear', desc: 'remove loaded document'  },
  { name: '/search on',  desc: 'enable web search' },
  { name: '/search off', desc: 'disable web search' },
  { name: '/search auto',desc: 'search without asking' },
  { name: '/clear',      desc: 'clear conversation' },
  { name: '/save',       desc: 'save to ~/.sat/history/' },
  { name: '/load',       desc: 'restore a saved session' },
  { name: '/keys',       desc: 're-run setup' },
  { name: '/info',       desc: 'about sat' },
  { name: '/help',       desc: 'show all commands' },
  { name: '/exit',       desc: 'quit sat' },
];

// Common model variants per provider for autocomplete
const PROVIDER_MODEL_VARIANTS: Record<string, string[]> = {
  ollama: ['qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5-coder:7b', 'llama3.2', 'llama3.2:1b', 'llama3.1:8b', 'mistral', 'gemma2:9b', 'phi4'],
  gpt:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
  claude: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001', 'claude-3-5-haiku-latest'],
  gemini: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  groq:   ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  grok:   ['grok-3-latest', 'grok-3-mini', 'grok-2-1212'],
};

const inputHistory: string[] = [];

interface ChatInputProps {
  onSubmit: (value: string) => void;
  onAbort?: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  disabled?: boolean;
  providers?: Record<string, string>;
  configuredProviders?: Set<string>;
  currentProvider?: string;
  sessions?: string[];
  pendingText?: string;
  onCancelPending?: () => void;
}

export function ChatInput({ onSubmit, onAbort, onScrollUp, onScrollDown, disabled = false, providers = {}, configuredProviders = new Set(), currentProvider = '', sessions = [], pendingText = '', onCancelPending }: ChatInputProps) {
  const [value, setValue]           = useState('');
  const [cursor, setCursor]         = useState(0);
  const [acIndex, setAcIndex]       = useState(-1);
  const [acNav, setAcNav]           = useState(false);
  const [histIndex, setHistIndex]   = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const lastEscRef = useRef(0);

  const COMMANDS = [
    ...BASE_COMMANDS,
    ...Object.entries(providers)
      .map(([k, label]) => ({
        name: `/model ${k}`,
        desc: k === currentProvider
          ? `${label}  ← active`
          : configuredProviders.has(k) ? label : `${label}  (no key — /keys to add)`,
      })),
    // Model version variants — only for configured providers
    ...Object.entries(PROVIDER_MODEL_VARIANTS)
      .filter(([p]) => configuredProviders.has(p) || p === 'ollama')
      .flatMap(([p, models]) =>
        models.map(m => ({
          name: `/model ${p} ${m}`,
          desc: `use ${m}`,
        }))
      ),
    ...sessions.map((f, i) => ({ name: `/load ${i + 1}`,        desc: f.replace('.json', '') })),
    ...sessions.map((f, i) => ({ name: `/load delete ${i + 1}`, desc: f.replace('.json', '') })),
  ];

  const suggestions = value.startsWith('/')
    ? COMMANDS.filter(c => {
        if (!c.name.startsWith(value) || c.name === value) return false;
        if (c.name.split(' ').length > value.split(' ').length + 1) return false;
        if (c.name.includes(' ') && !value.includes(' ')) return false;
        return true;
      })
    : [];
  const showAC = suggestions.length > 0;

  const setValueEnd = (v: string) => { setValue(v); setCursor(v.length); };

  // ink v5 eats Home/End (clears `input` to '' for them, no key.home/key.end property).
  // Hook into ink's internal_eventEmitter to see raw sequences before they're cleared.
  const { internal_eventEmitter } = useStdin() as any;
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!internal_eventEmitter) return;
    const HOME = new Set(['\x1b[H', '\x1b[1~', '\x1bOH', '\x1b[7~']);
    const END  = new Set(['\x1b[F', '\x1b[4~', '\x1bOF', '\x1b[8~']);
    const handler = (data: string) => {
      if (HOME.has(data)) { setCursor(0); setAcIndex(-1); setAcNav(false); }
      if (END.has(data))  { setCursor(valueRef.current.length); setAcIndex(-1); setAcNav(false); }
    };
    internal_eventEmitter.on('input', handler);
    return () => internal_eventEmitter.off('input', handler);
  }, [internal_eventEmitter]);

  const submit = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (inputHistory[inputHistory.length - 1] !== trimmed) inputHistory.push(trimmed);
    setHistIndex(-1);
    setSavedDraft('');
    setValue('');
    setCursor(0);
    setAcIndex(-1);
    setAcNav(false);
    onSubmit(trimmed);
  }, [onSubmit]);

  useInput((input, key) => {
    // Escape: abort generation, dismiss autocomplete, or double-press to clear input
    if (key.escape) {
      if (disabled) { onAbort?.(); return; }
      const now = Date.now();
      const doubleTap = now - lastEscRef.current < 400;
      lastEscRef.current = now;
      if (doubleTap && value) {
        setValue(''); setCursor(0); setAcIndex(-1); setAcNav(false); setHistIndex(-1);
        return;
      }
      setAcIndex(-1); setAcNav(false);
      return;
    }

    // During generation: allow composing and editing freely
    if (disabled) {
      if (key.return) { submit(value); return; }
      // ↑ when input is empty and there's a pending queued message: restore it
      if (key.upArrow && !value.trim() && pendingText) {
        setValue(pendingText); setCursor(pendingText.length);
        onCancelPending?.();
        return;
      }
      if (key.upArrow || key.downArrow || key.tab) return;
      // fall through to cursor/edit handling below
    } else {
      // Autocomplete navigation
      if (showAC) {
        if (key.upArrow)   { setAcIndex(i => Math.max(-1, i - 1)); setAcNav(true); return; }
        if (key.downArrow) { setAcIndex(i => Math.min(suggestions.length - 1, i + 1)); setAcNav(true); return; }
        if (key.tab) {
          const sel = suggestions[acIndex >= 0 ? acIndex : 0];
          if (sel) { setValueEnd(sel.name + ' '); setAcIndex(-1); setAcNav(false); }
          return;
        }
        if (key.return) {
          submit(acIndex >= 0 ? (suggestions[acIndex]?.name ?? value) : value);
          setAcIndex(-1); setAcNav(false);
          return;
        }
      }

      // History navigation (↑↓ step, PgUp/PgDn jump to oldest/newest)
      if (!showAC) {
        if (key.upArrow && inputHistory.length > 0) {
          const newIdx = histIndex === -1 ? inputHistory.length - 1 : Math.max(0, histIndex - 1);
          if (histIndex === -1) setSavedDraft(value);
          setHistIndex(newIdx);
          setValueEnd(inputHistory[newIdx]!);
          return;
        }
        if (key.downArrow && histIndex !== -1) {
          const newIdx = histIndex + 1;
          if (newIdx >= inputHistory.length) { setHistIndex(-1); setValueEnd(savedDraft); }
          else { setHistIndex(newIdx); setValueEnd(inputHistory[newIdx]!); }
          return;
        }
        if (key.pageUp) {
          if (value === '') { onScrollUp?.(); return; }
          if (inputHistory.length > 0) {
            if (histIndex === -1) setSavedDraft(value);
            setHistIndex(0);
            setValueEnd(inputHistory[0]!);
          }
          return;
        }
        if (key.pageDown) {
          if (value === '') { onScrollDown?.(); return; }
          setHistIndex(-1);
          setValueEnd(histIndex === -1 ? value : savedDraft);
          return;
        }
      }

      if (key.return) { submit(value); return; }
    }

    // ── cursor movement (always active) ─────────────────────────────────────
    // Word jump: Ctrl+Left / Ctrl+Right (sequence varies by terminal)
    const isWordLeft  = (key.ctrl && key.leftArrow)  || input === '\x1b[1;5D' || input === '\x1bOd';
    const isWordRight = (key.ctrl && key.rightArrow) || input === '\x1b[1;5C' || input === '\x1bOc';

    if (key.ctrl && input === 'a')  { setCursor(0); return; }
    if (key.ctrl && input === 'e')  { setCursor(value.length); return; }
    if (key.ctrl && input === 'u')  { setValue(''); setCursor(0); setAcIndex(-1); setAcNav(false); setHistIndex(-1); return; }
    if (key.ctrl && input === 'k')  { setValue(value.slice(0, cursor)); setAcIndex(-1); setAcNav(false); setHistIndex(-1); return; }
    if (isWordLeft)  { setCursor(wordLeft(value, cursor));  setAcIndex(-1); setAcNav(false); return; }
    if (isWordRight) { setCursor(wordRight(value, cursor)); setAcIndex(-1); setAcNav(false); return; }
    if (key.leftArrow  && !key.ctrl) { setCursor(c => Math.max(0, c - 1));          setAcIndex(-1); setAcNav(false); return; }
    if (key.rightArrow && !key.ctrl) { setCursor(c => Math.min(value.length, c + 1)); setAcIndex(-1); setAcNav(false); return; }

    // ── editing ─────────────────────────────────────────────────────────────
    if (key.backspace) {
      if (cursor === 0) return;
      setValue(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(c => c - 1);
      setAcIndex(-1); setAcNav(false); setHistIndex(-1);
      return;
    }
    if (key.delete) {
      if (cursor >= value.length) return;
      setValue(value.slice(0, cursor) + value.slice(cursor + 1));
      setAcIndex(-1); setAcNav(false); setHistIndex(-1);
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(c => c + input.length);
      setAcIndex(-1); setAcNav(false); setHistIndex(-1);
    }
  }, { isActive: true });

  const width = (process.stdout.columns || 80) - 2;
  const hasTyped = value.trim().length > 0;

  // Collapse multi-line or very long input — show cursor context, not first line
  const valueLines = value.split('\n');
  const isLongInput = valueLines.length > 1 || value.length > width - 4;
  const inputDisplay = (() => {
    if (!isLongInput) return null;
    // Show text around the cursor so the user can see what they're typing
    const TAIL = Math.max(10, width - 28);
    const beforeCursor = value.slice(Math.max(0, cursor - TAIL), cursor).replace(/\n/g, '↵');
    const atCursor     = cursor < value.length ? (value[cursor] === '\n' ? '↵' : value[cursor]!) : ' ';
    const afterCursor  = value.slice(cursor + 1, cursor + 12).replace(/\n/g, '↵');
    const badge        = `[+${value.length}ch] `;
    return (
      <Text>
        <Text color="white" bold>{'> '}</Text>
        <Text color="#555565">{badge}</Text>
        {cursor > TAIL && <Text color="#6c7086">{'…'}</Text>}
        <Text>{beforeCursor}</Text>
        <Text backgroundColor={disabled ? '#555565' : 'white'} color="#1e1e2e">{atCursor}</Text>
        {afterCursor ? <Text>{afterCursor}</Text> : null}
        {disabled
          ? <Text color="#6c7086">{'  (↵ queue · Esc stop)'}</Text>
          : <Text color="#6c7086">{'  Esc×2 clear'}</Text>
        }
      </Text>
    );
  })();

  return (
    <Box flexDirection="column">
      <Text color="#555565">{'─'.repeat(width)}</Text>

      {inputDisplay ?? (
      <Text>
        <Text color="white" bold>{'> '}</Text>
        <Text>{value.slice(0, cursor)}</Text>
        <Text backgroundColor={disabled ? '#555565' : 'white'} color="#1e1e2e">
          {cursor < value.length ? value[cursor] : ' '}
        </Text>
        {cursor < value.length && <Text>{value.slice(cursor + 1)}</Text>}
        {disabled && <Text color="#6c7086">{hasTyped ? '  (↵ queue · Esc stop)' : '  (responding…  Esc to stop)'}</Text>}
      </Text>
      )}

      <Text color="#555565">{'─'.repeat(width)}</Text>

      {!showAC && <Text color="#6c7086">{'? for shortcuts  ·  Tab to autocomplete  ·  ↑↓ history  ·  Esc×2 clear'}</Text>}

      {showAC && (() => {
        const PAGE = 7;
        const clampedIndex = Math.max(0, acIndex);
        const start = Math.max(0, Math.min(clampedIndex - Math.floor(PAGE / 2), suggestions.length - PAGE));
        const visible = suggestions.slice(start, start + PAGE);
        return (
          <Box flexDirection="column" marginTop={1}>
            {start > 0 && <Text color="#6c7086">{'  '}↑ {start} more</Text>}
            {visible.map((cmd, vi) => {
              const i = start + vi;
              return (
                <Text key={cmd.name}>
                  <Text
                    color={i === acIndex && acIndex >= 0 ? 'white' : '#cdd6f4'}
                    backgroundColor={i === acIndex && acIndex >= 0 ? '#313244' : undefined}
                    bold={i === acIndex && acIndex >= 0}
                  >
                    {'  '}{cmd.name.padEnd(22)}
                  </Text>
                  <Text
                    color="#6c7086"
                    backgroundColor={i === acIndex && acIndex >= 0 ? '#313244' : undefined}
                  >
                    {cmd.desc}
                  </Text>
                </Text>
              );
            })}
            {start + PAGE < suggestions.length && (
              <Text color="#6c7086">{'  '}↓ {suggestions.length - start - PAGE} more</Text>
            )}
          </Box>
        );
      })()}
    </Box>
  );
}

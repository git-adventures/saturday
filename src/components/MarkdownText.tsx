import React from 'react';
import { Box, Text } from 'ink';

// ── Inline parser ─────────────────────────────────────────────────────────────

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
}

function parseInline(raw: string): Segment[] {
  const segs: Segment[] = [];
  let s = raw;

  while (s.length > 0) {
    // bold+italic
    const bi = s.match(/^\*\*\*(.+?)\*\*\*/);
    if (bi) { segs.push({ text: bi[1]!, bold: true, italic: true }); s = s.slice(bi[0].length); continue; }

    // bold
    const b = s.match(/^\*\*(.+?)\*\*/);
    if (b) { segs.push({ text: b[1]!, bold: true }); s = s.slice(b[0].length); continue; }

    // italic
    const it = s.match(/^\*(.+?)\*/);
    if (it) { segs.push({ text: it[1]!, italic: true }); s = s.slice(it[0].length); continue; }

    // inline code
    const ic = s.match(/^`([^`]+)`/);
    if (ic) { segs.push({ text: ` ${ic[1]!} `, code: true }); s = s.slice(ic[0].length); continue; }

    // strikethrough
    const st = s.match(/^~~(.+?)~~/);
    if (st) { segs.push({ text: st[1]!, strike: true }); s = s.slice(st[0].length); continue; }

    // plain text up to next marker
    const next = s.search(/\*\*\*|\*\*|\*(?!\s)|`|~~/);
    if (next === -1) { segs.push({ text: s }); break; }
    if (next > 0) segs.push({ text: s.slice(0, next) });
    s = s.slice(next);
  }

  return segs.filter(seg => seg.text.length > 0);
}

function InlineText({ text }: { text: string }) {
  const segs = parseInline(text);
  return (
    <Text>
      {segs.map((seg, i) => (
        <Text
          key={i}
          bold={seg.bold}
          italic={seg.italic}
          dimColor={seg.strike}
          color={seg.code ? 'cyan' : undefined}
          backgroundColor={seg.code ? '#1e1e2e' : undefined}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

// ── Block parser ──────────────────────────────────────────────────────────────

type BlockKind =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'bullet'; text: string; level: number }
  | { kind: 'numbered'; text: string; num: number }
  | { kind: 'blockquote'; text: string }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'hr' }
  | { kind: 'text'; text: string };

function parseBlocks(markdown: string): BlockKind[] {
  const lines = markdown.split('\n');
  const blocks: BlockKind[] = [];
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (const line of lines) {
    if (inCode) {
      if (line.trimEnd() === '```') {
        blocks.push({ kind: 'code', text: codeLines.join('\n'), lang: codeLang });
        inCode = false; codeLines = []; codeLang = '';
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const fence = line.match(/^```(\w*)/);
    if (fence) { inCode = true; codeLang = fence[1] ?? ''; continue; }

    const h1 = line.match(/^# (.+)/);
    if (h1) { blocks.push({ kind: 'h1', text: h1[1]! }); continue; }

    const h2 = line.match(/^## (.+)/);
    if (h2) { blocks.push({ kind: 'h2', text: h2[1]! }); continue; }

    const h3 = line.match(/^### (.+)/);
    if (h3) { blocks.push({ kind: 'h3', text: h3[1]! }); continue; }

    if (/^[-*_]{3,}$/.test(line.trim())) { blocks.push({ kind: 'hr' }); continue; }

    const bullet = line.match(/^(\s*)([-*+]) (.+)/);
    if (bullet) {
      blocks.push({ kind: 'bullet', text: bullet[3]!, level: Math.floor(bullet[1]!.length / 2) });
      continue;
    }

    const numbered = line.match(/^(\s*)(\d+)\. (.+)/);
    if (numbered) {
      blocks.push({ kind: 'numbered', text: numbered[3]!, num: parseInt(numbered[2]!) });
      continue;
    }

    const bq = line.match(/^> (.+)/);
    if (bq) { blocks.push({ kind: 'blockquote', text: bq[1]! }); continue; }

    blocks.push({ kind: 'text', text: line });
  }

  // unclosed code block
  if (inCode && codeLines.length > 0) {
    blocks.push({ kind: 'code', text: codeLines.join('\n'), lang: codeLang });
  }

  return blocks;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

export function MarkdownText({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'h1':
            return (
              <Box key={i} flexDirection="column" marginTop={1}>
                <Text bold color="white">{block.text}</Text>
                <Text dimColor>{'═'.repeat(Math.min(block.text.length, 52))}</Text>
              </Box>
            );
          case 'h2':
            return (
              <Box key={i} flexDirection="column" marginTop={1}>
                <Text bold color="white">{block.text}</Text>
                <Text dimColor>{'─'.repeat(Math.min(block.text.length, 52))}</Text>
              </Box>
            );
          case 'h3':
            return <Text key={i} bold marginTop={1}>{block.text}</Text>;

          case 'bullet': {
            const markers = ['  •', '    ◦', '      ▪'];
            const marker = markers[Math.min(block.level, 2)]!;
            return (
              <Box key={i}>
                <Text dimColor>{marker} </Text>
                <InlineText text={block.text} />
              </Box>
            );
          }
          case 'numbered':
            return (
              <Box key={i}>
                <Text bold>  {block.num}. </Text>
                <InlineText text={block.text} />
              </Box>
            );

          case 'blockquote':
            return (
              <Box key={i}>
                <Text color="gray">▌ </Text>
                <Text dimColor italic><InlineText text={block.text} /></Text>
              </Box>
            );

          case 'code': {
            const codeLines = block.text.split('\n');
            const width = Math.max(...codeLines.map(l => l.length), block.lang.length + 4, 20);
            return (
              <Box key={i} flexDirection="column" marginY={1}>
                <Text dimColor>  ┌─ <Text color="cyan" dimColor>{block.lang || 'code'}</Text> {'─'.repeat(Math.max(0, width - block.lang.length - 4))}┐</Text>
                {codeLines.map((line, j) => (
                  <Box key={j}>
                    <Text dimColor>  │ </Text>
                    <Text color="cyan">{line}</Text>
                  </Box>
                ))}
                <Text dimColor>  └{'─'.repeat(width + 1)}┘</Text>
              </Box>
            );
          }

          case 'hr':
            return <Text key={i} dimColor>{'─'.repeat(52)}</Text>;

          case 'text':
            return block.text
              ? <InlineText key={i} text={block.text} />
              : <Text key={i}> </Text>;
        }
      })}
    </Box>
  );
}

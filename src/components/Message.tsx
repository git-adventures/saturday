import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { MarkdownText } from './MarkdownText.js';
import type { ChatMessage } from '../providers/index.js';

interface MessageProps {
  message: ChatMessage;
}

export const Message = memo(function Message({ message }: MessageProps) {
  // subtract paddingX={2}*2=4 from app container
  const width = (process.stdout.columns || 80) - 2;

  if (message.role === 'system') {
    const line = '─'.repeat(Math.floor((width - message.content.length - 2) / 2));
    return (
      <Box marginBottom={1}>
        <Text color="#555565">{line} </Text>
        <Text color="#6c7086">{message.content}</Text>
        <Text color="#555565"> {line}</Text>
      </Box>
    );
  }

  if (message.role === 'user') {
    const lines = message.content.split('\n');
    const isLong = lines.length > 3 || message.content.length > 300;

    if (isLong) {
      const preview = lines[0]!.slice(0, width - 28) + (lines[0]!.length > width - 28 ? '…' : '');
      const extraLines = lines.length > 1 ? lines.length - 1 : Math.ceil(message.content.length / (width - 4)) - 1;
      return (
        <Box marginBottom={1}>
          <Text backgroundColor="#2a2a3f">
            <Text color="white" bold backgroundColor="#2a2a3f">{'> '}</Text>
            <Text color="#a6adc8" backgroundColor="#2a2a3f">{preview}</Text>
            <Text color="#6c7086" backgroundColor="#2a2a3f">{`  [+${extraLines} lines]`}</Text>
          </Text>
        </Box>
      );
    }

    const content = message.content.padEnd(Math.max(0, width - 2));
    return (
      <Box marginBottom={1}>
        <Text backgroundColor="#2a2a3f">
          <Text color="white" bold backgroundColor="#2a2a3f">{'> '}</Text>
          <Text color="white" backgroundColor="#2a2a3f">{content}</Text>
        </Text>
      </Box>
    );
  }

  // AI response
  const MAX_CHARS = 6000;
  const isTruncated = message.content.length > MAX_CHARS;
  const displayContent = isTruncated ? message.content.slice(0, MAX_CHARS) : message.content;
  return (
    <Box flexDirection="row" marginBottom={1} alignItems="flex-start">
      <Text color="white">{'● '}</Text>
      <Box flexShrink={1} flexDirection="column">
        <MarkdownText content={displayContent} />
        {isTruncated && (
          <Text color="#6c7086">  ↓ response truncated ({Math.round(message.content.length / 1000)}k chars) — use /save to keep it</Text>
        )}
      </Box>
    </Box>
  );
});

export function StreamingMessage({ content }: { content: string }) {
  const MAX_LINES = 30;
  const lines = content.split('\n');
  const visible = lines.length > MAX_LINES ? lines.slice(-MAX_LINES).join('\n') : content;

  return (
    <Box flexDirection="row" marginBottom={1} alignItems="flex-start">
      <Text color="white">{'● '}</Text>
      <Box flexShrink={1} flexDirection="column">
        <Text>{visible}</Text>
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';
import { PROVIDERS } from '../config.js';

interface HeaderProps {
  provider: string;
  model: string;
  searchOn?: boolean;
  docName?: string;
}

export function Header({ provider, model, searchOn, docName }: HeaderProps) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text bold color="white">sat</Text>
        <Text color="#6c7086">{'  '}{PROVIDERS[provider] ?? provider}{'  ·  '}{model}</Text>
        {searchOn && <Text color="#a6e3a1">{'  search:on'}</Text>}
        {docName && <Text color="#cba6f7">{'  doc:'}{docName}</Text>}
      </Text>
    </Box>
  );
}

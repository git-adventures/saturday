import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const FRAMES = ['thinking.', 'thinking..', 'thinking...'];

export function Thinking() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % 3);
    }, 400);
    return () => clearInterval(timer);
  }, []);

  return <Text color="#6c7086">{FRAMES[frame]}</Text>;
}

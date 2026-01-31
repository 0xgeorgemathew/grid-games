'use client';

import { useEffect, useRef } from 'react';
import { Game } from 'phaser';
import { GridScene } from '@/game/scenes/GridScene';
import { createPhaserConfig, DEFAULT_GRID } from '@/game/config';

export default function GameCanvasClient() {
  const gameInstanceRef = useRef<Game | null>(null);

  useEffect(() => {
    const scene = new GridScene('GridScene', DEFAULT_GRID);
    gameInstanceRef.current = new Game(createPhaserConfig(scene));

    return () => {
      gameInstanceRef.current?.destroy(true);
    };
  }, []);

  return (
    <div
      id="phaser-game"
      className="rounded-lg overflow-hidden border border-accent"
    />
  );
}

'use client';

import { useEffect, useRef } from 'react';
import { Game } from 'phaser';
import { GridScene } from '@/game/scenes/GridScene';
import { TradingScene } from '@/game/scenes/TradingScene';
import { createPhaserConfig, createTradingPhaserConfig, DEFAULT_GRID } from '@/game/config';

export type SceneType = 'GridScene' | 'TradingScene';

interface GameCanvasClientProps {
  scene?: SceneType;
}

export default function GameCanvasClient({ scene = 'GridScene' }: GameCanvasClientProps) {
  const gameInstanceRef = useRef<Game | null>(null);

  useEffect(() => {
    // Create appropriate scene based on prop
    const sceneInstance = scene === 'TradingScene'
      ? new TradingScene()
      : new GridScene('GridScene', DEFAULT_GRID);

    // Use appropriate config factory
    const config = scene === 'TradingScene'
      ? createTradingPhaserConfig(sceneInstance)
      : createPhaserConfig(sceneInstance);

    gameInstanceRef.current = new Game(config);

    return () => {
      gameInstanceRef.current?.destroy(true);
    };
  }, [scene]);

  return (
    <div
      id="phaser-game"
      className="rounded-lg overflow-hidden border border-accent"
    />
  );
}

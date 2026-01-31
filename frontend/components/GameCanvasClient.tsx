'use client';

import { useEffect, useRef } from 'react';
import { Game } from 'phaser';
import { GridScene } from '@/game/scenes/GridScene';
import { TradingScene } from '@/game/scenes/TradingScene';
import { createGridPhaserConfig, createTradingPhaserConfig, DEFAULT_GRID } from '@/game/config';

export type SceneType = 'GridScene' | 'TradingScene';

interface GameCanvasClientProps {
  scene?: SceneType;
}

// Scene type → (scene instance, config factory) mapping
function createSceneAndConfig(type: SceneType) {
  if (type === 'TradingScene') {
    const sceneInstance = new TradingScene();
    return { sceneInstance, config: createTradingPhaserConfig(sceneInstance) };
  }

  const sceneInstance = new GridScene('GridScene', DEFAULT_GRID);
  return { sceneInstance, config: createGridPhaserConfig(sceneInstance) };
}

export default function GameCanvasClient({ scene = 'GridScene' }: GameCanvasClientProps) {
  const gameInstanceRef = useRef<Game | null>(null);

  useEffect(() => {
    const { config } = createSceneAndConfig(scene);
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

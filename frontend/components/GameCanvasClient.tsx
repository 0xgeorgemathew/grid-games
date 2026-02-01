'use client'

import { useEffect, useRef } from 'react'
import { Game } from 'phaser'
import { GridScene } from '@/game/scenes/GridScene'
import { TradingScene } from '@/game/scenes/TradingScene'
import { createGridPhaserConfig, createTradingPhaserConfig, DEFAULT_GRID } from '@/game/config'

export type SceneType = 'GridScene' | 'TradingScene'

interface GameCanvasClientProps {
  scene?: SceneType
}

// Scene type → config factory mapping (pass scene classes, not instances)
function createConfigForScene(type: SceneType) {
  if (type === 'TradingScene') {
    return createTradingPhaserConfig(TradingScene)
  }

  return createGridPhaserConfig(GridScene, DEFAULT_GRID)
}

// Module-level singleton to prevent duplicate game instances from React StrictMode
let globalGameInstance: Game | null = null

export default function GameCanvasClient({ scene = 'GridScene' }: GameCanvasClientProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Module-level check survives StrictMode unmount/remount
    if (globalGameInstance) {
      return
    }

    const config = createConfigForScene(scene)
    // Ensure parent element exists before creating game
    if (!parentRef.current) {
      console.error('[GameCanvasClient] Parent ref not available')
      return
    }

    console.log('[GameCanvasClient] Creating Phaser game')
    globalGameInstance = new Game(config)

    return () => {
      if (globalGameInstance) {
        console.log('[GameCanvasClient] Destroying Phaser game')
        globalGameInstance.destroy(true)
        globalGameInstance = null
      }
    }
  }, [scene])

  return (
    <div
      ref={parentRef}
      id="phaser-game"
      className="absolute inset-0 z-1"
      style={{
        touchAction: 'none',
      }}
      suppressHydrationWarning={true}
    />
  )
}

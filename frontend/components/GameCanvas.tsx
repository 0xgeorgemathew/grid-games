'use client'

import dynamic from 'next/dynamic'
import type { SceneType } from './GameCanvasClient'

// Dynamic import with SSR disabled for Phaser (client-only)
const GameCanvasClient = dynamic(() => import('./GameCanvasClient').then((mod) => mod.default), {
  ssr: false,
})

export interface GameCanvasProps {
  scene?: SceneType
}

export default function GameCanvas({ scene }: GameCanvasProps) {
  return <GameCanvasClient scene={scene} />
}

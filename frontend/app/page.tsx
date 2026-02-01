'use client'

import { useTradingStore } from '@/game/stores/trading-store'
import { MatchmakingScreen } from '@/components/MatchmakingScreen'
import { GameHUD } from '@/components/GameHUD'
import { SettlementFeed } from '@/components/SettlementFeed'
import { PendingOrdersBar } from '@/components/PendingOrdersBar'
import { PositionIndicator } from '@/components/PositionIndicator'
import { GameCanvasBackground } from '@/components/GameCanvasBackground'
import GameCanvas from '@/components/GameCanvas'
import { useEffect } from 'react'

export default function Home() {
  const { isPlaying, connect, resetGame, disconnectPriceFeed } = useTradingStore()

  useEffect(() => {
    // Connect to socket on mount
    connect()

    // Cleanup on unmount
    return () => {
      resetGame()
      disconnectPriceFeed()
    }
  }, [connect, resetGame, disconnectPriceFeed])

  if (!isPlaying) {
    return <MatchmakingScreen />
  }

  return (
    <div className="h-dvh w-screen bg-tron-black relative overflow-hidden">
      {/* Background - Grid with candlesticks */}
      <GameCanvasBackground />

      {/* Top UI Layer */}
      <GameHUD />

      {/* Game Canvas - Phaser Scene */}
      <GameCanvas scene="TradingScene" />

      {/* Bottom UI Layer */}
      <PendingOrdersBar />
      <PositionIndicator />
      <SettlementFeed />
    </div>
  )
}
